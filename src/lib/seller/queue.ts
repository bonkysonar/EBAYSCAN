import type { SearchInput, SearchResult } from "../ebay/types";
import { analyzeSellerPrice, SELLER_EVIDENCE_TTL_MS, SELLER_PRICING_VERSION } from "./analyzeSellerPrice";
import { sellerSearchInput } from "./search";
import { sellerListingBlocker } from "./matching";
import type { SellerListing, SellerPricingAnalysis } from "./types";

export type AnalyzerRow = {
  listing: SellerListing;
  analysis?: SellerPricingAnalysis;
  changeNote?: string;
  error?: string;
  isTaggedForChange?: boolean;
  proposedPrice?: number;
  searchResult?: SearchResult;
  state: "pending" | "analyzing" | "done" | "error";
};

export function hasFreshAnalysis(row: AnalyzerRow, now = Date.now()): boolean {
  const at = Date.parse(row.analysis?.analyzedAt ?? "");
  return row.state === "done" && row.analysis?.pricingVersion === SELLER_PRICING_VERSION && at <= now + 60_000 && now - at <= SELLER_EVIDENCE_TTL_MS;
}

export function restoreRows(rows: AnalyzerRow[]): AnalyzerRow[] {
  const ownIds = rows.map(row => row.listing.id);
  return rows.map(original => {
    // Earlier queues retained genuine row-level observations. Recheck that sample
    // without inventing replacement comparisons or refreshing timestamps.
    const row = original.state === "done" && [2, 3].includes(original.analysis?.pricingVersion ?? 0) && original.searchResult
      ? { ...original, analysis: analyzeSellerPrice(original.listing, original.searchResult, {}, ownIds) } : original;
    return hasFreshAnalysis(row) ? row : { ...row, state: "pending", analysis: undefined, searchResult: undefined, error: undefined };
  });
}

export function mergeSellerListings(listings: SellerListing[], current: AnalyzerRow[]): AnalyzerRow[] {
  const byId = new Map(current.map(row => [row.listing.id, row]));
  return listings.map(listing => {
    const old = byId.get(listing.id);
    const unchanged = old && JSON.stringify(old.listing) === JSON.stringify(listing);
    return unchanged ? restoreRows([old])[0] : { listing, state: "pending", changeNote: old?.changeNote,
      proposedPrice: old?.proposedPrice, isTaggedForChange: old?.isTaggedForChange };
  });
}

export async function runSellerAnalysis(options: {
  rows: AnalyzerRow[];
  search: (input: SearchInput) => Promise<SearchResult>;
  onRow: (row: AnalyzerRow) => void;
  shouldPause?: () => boolean;
  concurrency?: number;
  delayMs?: number;
}): Promise<{ stopReason?: string; completed: number; total: number }> {
  const pending = options.rows.filter(row => !hasFreshAnalysis(row));
  const ownIds = options.rows.map(row => row.listing.id);
  const queries = new Map<string, Promise<SearchResult>>();
  let cursor = 0, completed = 0, consecutiveErrors = 0;
  let stopReason: string | undefined;
  async function worker() {
    while (cursor < pending.length && !stopReason && !options.shouldPause?.()) {
      const row = pending[cursor++];
      options.onRow({ ...row, state: "analyzing", error: undefined });
      try {
        const input = sellerSearchInput(row.listing);
        const key = JSON.stringify(input);
        let request = queries.get(key);
        if (sellerListingBlocker(row.listing)) request = Promise.resolve({ input, listings: [], source: "unsupported-seller-item", timestamp: new Date().toISOString(), warnings: [] });
        if (!request) { request = options.search(input); queries.set(key, request); }
        const result = await request;
        const analysis = analyzeSellerPrice(row.listing, result, {}, ownIds);
        const retained = new Set(analysis.comparableIds);
        // Keep only the evidence used in the benchmark; never store raw API payloads in the UI queue.
        const searchResult = { ...result, listings: result.listings.filter(comp => retained.has(comp.id)).map(({ raw: _raw, ...comp }) => comp) };
        options.onRow({ ...row, state: "done", analysis, searchResult, error: undefined });
        completed++; consecutiveErrors = 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Analysis failed";
        const globalFailure = /429|rate.limit|too many requests|401|403|token|credential/i.test(message);
        consecutiveErrors++;
        if (globalFailure || consecutiveErrors >= 3) stopReason = message;
        options.onRow({ ...row, state: globalFailure ? "pending" : "error", analysis: undefined, searchResult: undefined, error: message });
      }
      if (!stopReason && !options.shouldPause?.() && cursor < pending.length) await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 250));
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, Math.max(1, options.concurrency ?? 2)) }, worker));
  return { stopReason, completed, total: pending.length };
}

// A review draft, never an instruction to send a live revision. Unknown costs remain unknown.
export function draftSellerPrice(row: AnalyzerRow, maximumPercent = 20): number | null {
  if (!hasFreshAnalysis(row) || !["PRICE_HIGH", "OK"].includes(row.analysis!.status) || !row.analysis?.benchmarkPrice) return null;
  if (!Number.isFinite(maximumPercent) || maximumPercent <= 0 || maximumPercent > 20) return null;
  const current = row.listing.currentPrice;
  // Faster-sales drafts are reductions only; require at least a 5% gap to avoid churn.
  if (row.analysis.benchmarkPrice >= current * 0.95) return null;
  const cap = Math.min(maximumPercent, row.analysis.maximumDraftReductionPercent ?? 0);
  if (cap <= 0) return null;
  const minimum = Math.ceil(current * (1 - cap / 100) * 100 - 1e-8) / 100;
  const draft = Math.max(minimum, Math.round(row.analysis.benchmarkPrice * 100) / 100);
  return draft < current ? draft : null;
}
