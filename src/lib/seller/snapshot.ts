import type { AnalyzerRow } from "./queue";
import type { SellerListing, SellerPricingAnalysis, SellerPricingStatus } from "./types";

export function rowsFromSnapshotCsv(csv: string, current: AnalyzerRow[]): AnalyzerRow[] {
  const records = parseCsv(csv);
  const currentById = new Map(current.map((row) => [row.listing.id, row]));

  return records.map((record) => {
    const id = itemIdFromSnapshot(record);
    const title = record.title || "Untitled eBay listing";
    const existing = id ? currentById.get(id) : undefined;
    const listing: SellerListing = {
      availableQuantity: existing?.listing.availableQuantity,
      condition: record.condition || conditionFromMeta(record.meta) || existing?.listing.condition,
      currency: record.currency || existing?.listing.currency || "USD",
      currentPrice: parseMoney(record.your_price ?? record.current_price ?? record.current_item_price) ?? existing?.listing.currentPrice ?? 0,
      customLabel: record.custom_label || existing?.listing.customLabel,
      id: id || existing?.listing.id || crypto.randomUUID(),
      imageUrl: existing?.listing.imageUrl,
      itemUrl: record.item_url || existing?.listing.itemUrl,
      quantitySold: existing?.listing.quantitySold,
      sku: record.sku || existing?.listing.sku,
      title,
    };
    const status = statusFromRecommendation(record.recommendation);
    const benchmarkPrice = parseMoney(record.matched_item_median ?? record.cheapest_10_average ?? record.benchmark_item_price);
    const activeComparableCount = parseInteger(record.active_comps ?? record.active_comparable_count);
    const deltaPercent = parsePercent(record.delta ?? record.delta_percent);
    const deltaValue = benchmarkPrice !== null ? roundMoney(listing.currentPrice - benchmarkPrice) : null;
    const analysis: SellerPricingAnalysis = {
      activeComparableCount,
      benchmarkPrice,
      benchmarkSource: benchmarkPrice === null ? "insufficient-comps" : "ebay-cheapest-10",
      deltaPercent,
      deltaValue,
      listing,
      reasons: record.reason ? [record.reason] : ["Imported from browser snapshot CSV."],
      status,
    };

    return {
      ...existing,
      proposedPrice: parseMoney(record.proposed_price ?? record.draft_item_price) ?? existing?.proposedPrice,
      isTaggedForChange: record.tagged_for_change === "yes" || existing?.isTaggedForChange,
      changeNote: record.change_note || existing?.changeNote,
      analysis,
      error: undefined,
      listing,
      searchResult: existing?.searchResult,
      state: "done" as const,
    };
  });
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.length > 0)) rows.push(row);

  if (inQuotes) throw new Error("CSV has an unterminated quoted field.");
  const headers = rows.shift()?.map((header) => header.replace(/^\uFEFF/, "").trim()) ?? [];
  if (!headers.includes("title")) throw new Error("CSV must contain a title column.");
  return rows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
  );
}

function itemIdFromSnapshot(record: Record<string, string>): string {
  const fromMeta = record.meta?.match(/(\d{9,})\s*$/)?.[1];
  const fromUrl = record.item_url?.match(/\/(\d{9,})(?:[/?#]|$)/)?.[1];
  return record.item_id || fromMeta || fromUrl || "";
}

function conditionFromMeta(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [condition] = value.split(/[|\u00b7\u2022]/);
  const normalized = condition.trim();
  return normalized || undefined;
}

function statusFromRecommendation(value: string | undefined): SellerPricingStatus {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("very crowded")) return "VERY_CROWDED_PRICE_HIGH";
  if (normalized.includes("crowded")) return "CROWDED_PRICE_HIGH";
  if (normalized.includes("priced high")) return "PRICE_HIGH";
  if (normalized.includes("low")) return "PRICE_LOW";
  if (normalized.includes("okay")) return "OK";
  return "NEEDS_REVIEW";
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function parsePercent(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
