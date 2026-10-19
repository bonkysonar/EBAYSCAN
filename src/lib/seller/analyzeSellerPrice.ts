import type { CandidateListing, SearchResult } from "../ebay/types";
import { mediaGradeFromListing, sellerCondition } from "./search";
import { diagnoseSellerComparables, sellerListingBlocker } from "./matching";
import { defaultSellerPricingSettings, type SellerListing, type SellerPricingAnalysis, type SellerPricingSettings, type SellerPricingStatus } from "./types";

export const SELLER_PRICING_VERSION = 4;
export const SELLER_EVIDENCE_TTL_MS = 6 * 60 * 60 * 1000;

export function analyzeSellerPrice(listing: SellerListing, result: SearchResult, settings: Partial<SellerPricingSettings> = {}, ownIds: Iterable<string> = []): SellerPricingAnalysis {
  const resolved = { ...defaultSellerPricingSettings, ...settings };
  const diagnostic = diagnoseSellerComparables(listing, result, ownIds);
  const comps = diagnostic.comparables.slice(0, 10);
  const prices = comps.map(comp => comp.price);
  // The median is less sensitive to one unusually cheap listing than a mean.
  const benchmarkPrice = prices.length ? roundMoney(median(prices)) : null;
  const sellerCount = new Set(comps.map(comp => comp.sellerId).filter(Boolean)).size;
  const broadSpread = prices.length >= 3 && percentile(prices, 0.75) > percentile(prices, 0.25) * 2;
  const reasons = ["Compares item prices before shipping. Active asking prices are not completed sales or proven market value."];
  const age = Date.now() - Date.parse(result.timestamp);
  const grade = mediaGradeFromListing({ ...listing, condition: listing.condition ?? "" });
  const blocker = sellerListingBlocker(listing);
  const sufficient = comps.length >= resolved.minimumWeakComps && benchmarkPrice !== null && benchmarkPrice > 0;
  const fresh = Number.isFinite(age) && age >= -60_000 && age <= SELLER_EVIDENCE_TTL_MS;
  const knownCondition = grade !== "Unknown" && sellerCondition(listing) !== "both";
  const usable = sufficient && fresh && !blocker && knownCondition && Number.isFinite(listing.currentPrice) && listing.currentPrice > 0;
  const confidence = !usable ? "insufficient" : comps.length >= resolved.minimumStrongComps && sellerCount >= 2 && !broadSpread ? "supported" : "indicative";
  const deltaValue = benchmarkPrice && sufficient ? roundMoney(listing.currentPrice - benchmarkPrice) : null;
  const deltaPercent = deltaValue !== null && benchmarkPrice ? roundMoney(deltaValue / benchmarkPrice * 100) : null;
  let status: SellerPricingStatus = "NEEDS_REVIEW";
  if (usable) status = deltaPercent! > resolved.highPercent ? "PRICE_HIGH" : deltaPercent! < -resolved.lowPercent ? "PRICE_LOW" : "OK";
  if (!fresh) reasons.push("Comparable evidence is expired or has an invalid timestamp; refresh before reviewing a price change.");
  if (blocker) reasons.push(blocker);
  if (!knownCondition) reasons.push("Your media grade or condition is unknown; confirm it before comparing prices.");
  reasons.push(`${comps.length} distinct title/condition/grade-matched prices retained. Benchmark is the median of up to ten lowest matched item prices.`);
  if (!sufficient) reasons.push("Fewer than three matched prices: insufficient evidence for a price recommendation.");
  if (confidence === "indicative") reasons.push("Tentative recommendation: smaller sample, unknown/concentrated seller coverage, or wide price spread. Review drafts are capped at 10%.");
  if (confidence === "supported") reasons.push(`Supported sample: at least five matches from ${sellerCount} sellers with a bounded price spread. Review drafts are capped at 20%.`);
  if (broadSpread) reasons.push("Matched prices have a wide spread; pressing and sleeve differences may still affect value.");
  if (Object.keys(diagnostic.rejected).length) reasons.push(`Excluded results: ${Object.entries(diagnostic.rejected).map(([reason, count]) => `${reason.replaceAll("_", " ")} ${count}`).join(", ")}.`);
  const queryTotal = bestActiveComparableCount(result);
  if (queryTotal !== null) reasons.push(`${queryTotal} search hits reported by eBay; not a verified count of equivalent copies or evidence of sales demand.`);
  reasons.push("Confirm pressing, sleeve condition, shipping, promotions and your minimum margin before applying any draft.");
  return { listing, status, benchmarkPrice, benchmarkSource: sufficient ? "ebay-matched-median" : "insufficient-comps", deltaValue, deltaPercent,
    activeComparableCount: null, matchedCount: comps.length, comparableIds: comps.map(comp => comp.id), reasons,
    pricingVersion: SELLER_PRICING_VERSION, analyzedAt: result.timestamp, comparisonBasis: "item-price", confidence,
    maximumDraftReductionPercent: confidence === "supported" ? 20 : confidence === "indicative" ? 10 : 0,
    sellerCount, matchDiagnostics: { returnedCount: diagnostic.returnedCount, eligibleCount: diagnostic.comparables.length, rejected: diagnostic.rejected } };
}

export function sellerComparables(listing: SellerListing, result: SearchResult, ownIds: Iterable<string> = []): CandidateListing[] {
  return diagnoseSellerComparables(listing, result, ownIds).comparables;
}
export function bestActiveComparableCount(result: SearchResult): number | null {
  const pages = result.marketSnapshot?.ebaySearchPages ?? [];
  return (pages.find(page => page.label === "expanded artist/title" || page.label === "discogs artist/title") ?? pages[0])?.total ?? null;
}
function median(values: number[]): number { const i = Math.floor(values.length / 2); return values.length % 2 ? values[i] : (values[i - 1] + values[i]) / 2; }
function percentile(values: number[], fraction: number): number { return values[Math.floor((values.length - 1) * fraction)]; }
function roundMoney(value: number): number { return Math.round(value * 100) / 100; }
