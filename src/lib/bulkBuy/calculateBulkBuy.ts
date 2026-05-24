import type { DiscogsMarketSnapshot, ListingConditionFilter, SearchInput, SearchResult } from "../ebay/types";
import type { PriceSummary } from "../scoring/types";

export type BulkBuyMath = {
  bestCaseSalePrice: number;
  category: BulkBuyCategory;
  estimatedFees: number;
  estimatedProfit: number;
  estimatedTaxes: number;
  medianPrice: number;
  purchasePrice: number;
  shippingSupplies: number;
};

export type BulkBuyRow = {
  artistTitle: string;
  condition: ListingConditionFilter;
  currency: string;
  discogsReleaseId?: number;
  discogsReleaseUrl?: string;
  id: string;
  inputLabel: string;
  math: BulkBuyMath | null;
  order: number;
  scannedAt: string;
  searchResult?: SearchResult;
  statsStatus: "cheapest-ten" | "estimated-from-market" | "missing" | "sales-stats";
  warnings: string[];
};

export type BulkBuyCategory = "high-end" | "low-end bulk" | "sellable";

export const BULK_BUY_FEE_RATE = 0.1325;
export const BULK_BUY_AD_FEE_RATE = 0.05;
export const BULK_BUY_LOW_MEDIAN_FLAT_PURCHASE_PRICE = 0.5;
export const BULK_BUY_LOW_MEDIAN_THRESHOLD = 5;
export const BULK_BUY_HIGH_END_THRESHOLD = 25;
export const BULK_BUY_PURCHASE_RATE = 0.4;
export const BULK_BUY_SHIPPING_SUPPLIES = 1;
export const BULK_BUY_SALE_RATE = 1.1;
export const BULK_BUY_SELF_EMPLOYMENT_TAX_RATE = 0.153;

export function createBulkBuyRow({
  discogs,
  input,
  now = new Date().toISOString(),
  order,
  priceSummary,
  searchResult,
}: {
  discogs?: DiscogsMarketSnapshot;
  input: SearchInput;
  now?: string;
  order: number;
  priceSummary?: PriceSummary;
  searchResult?: SearchResult;
}): BulkBuyRow {
  const median = bulkBuyReferencePrice(discogs, priceSummary);
  const saleInputs = bulkBuySaleInputs(discogs, priceSummary);
  const title = discogs?.matchedTitle ?? inputLabel(input);

  return {
    artistTitle: title || "Unknown record",
    condition: input.conditionFilter ?? "used",
    currency: median?.currency ?? "USD",
    discogsReleaseId: discogs?.releaseId,
    discogsReleaseUrl: discogs?.releaseUrl,
    id: crypto.randomUUID(),
    inputLabel: inputLabel(input),
    math: median ? calculateBulkBuyMath(median.value, saleInputs) : null,
    order,
    scannedAt: now,
    searchResult,
    statsStatus: median?.source ?? "missing",
    warnings: discogs?.warnings ?? [],
  };
}

export function updateBulkBuyRowFromDiscogs(row: BulkBuyRow, discogs: DiscogsMarketSnapshot, priceSummary?: PriceSummary): BulkBuyRow {
  const median = bulkBuyReferencePrice(discogs, priceSummary);
  const saleInputs = bulkBuySaleInputs(discogs, priceSummary);

  return {
    ...row,
    artistTitle: discogs.matchedTitle ?? row.artistTitle,
    currency: median?.currency ?? row.currency,
    discogsReleaseId: discogs.releaseId ?? row.discogsReleaseId,
    discogsReleaseUrl: discogs.releaseUrl ?? row.discogsReleaseUrl,
    math: median ? calculateBulkBuyMath(median.value, saleInputs) : row.math,
    statsStatus: median?.source ?? "missing",
    warnings: discogs.warnings,
  };
}

export function calculateBulkBuyMath(
  medianPrice: number,
  options: {
    averageCheapestTenTotalPrice?: number | null;
    discogsMedianPrice?: number | null;
    titleMatchCount?: number;
  } = {},
): BulkBuyMath {
  const purchasePrice =
    medianPrice < BULK_BUY_LOW_MEDIAN_THRESHOLD
      ? BULK_BUY_LOW_MEDIAN_FLAT_PURCHASE_PRICE
      : roundDownToHalfDollar(medianPrice * BULK_BUY_PURCHASE_RATE);
  const bestCaseSalePrice = soldPrice(medianPrice, options);
  const estimatedFees = roundDownToHalfDollar(bestCaseSalePrice * (BULK_BUY_FEE_RATE + BULK_BUY_AD_FEE_RATE));
  const preTaxProfit = bestCaseSalePrice - purchasePrice - estimatedFees - BULK_BUY_SHIPPING_SUPPLIES;
  const estimatedTaxes = roundDownToHalfDollar(Math.max(0, preTaxProfit) * BULK_BUY_SELF_EMPLOYMENT_TAX_RATE);

  return {
    bestCaseSalePrice,
    category: bulkBuyCategory(medianPrice),
    estimatedFees,
    estimatedProfit: roundDownToHalfDollar(preTaxProfit - estimatedTaxes),
    estimatedTaxes,
    medianPrice: roundDownToHalfDollar(medianPrice),
    purchasePrice,
    shippingSupplies: BULK_BUY_SHIPPING_SUPPLIES,
  };
}

function soldPrice(
  medianPrice: number,
  {
    averageCheapestTenTotalPrice,
    discogsMedianPrice,
    titleMatchCount = 0,
  }: {
    averageCheapestTenTotalPrice?: number | null;
    discogsMedianPrice?: number | null;
    titleMatchCount?: number;
  },
): number {
  if (titleMatchCount > 50 && averageCheapestTenTotalPrice !== null && averageCheapestTenTotalPrice !== undefined) {
    return roundDownToHalfDollar(averageCheapestTenTotalPrice * 0.7);
  }

  if (titleMatchCount > 10) {
    return roundDownToHalfDollar((discogsMedianPrice ?? medianPrice) * 0.8);
  }

  return roundDownToHalfDollar(medianPrice * BULK_BUY_SALE_RATE);
}

export function bulkBuyCategory(referencePrice: number): BulkBuyCategory {
  if (referencePrice < BULK_BUY_LOW_MEDIAN_THRESHOLD) return "low-end bulk";
  if (referencePrice > BULK_BUY_HIGH_END_THRESHOLD) return "high-end";
  return "sellable";
}

export function bulkBuyRowMatchesDiscogs(row: BulkBuyRow, discogs: DiscogsMarketSnapshot): boolean {
  return Boolean(
    (row.discogsReleaseId && discogs.releaseId && row.discogsReleaseId === discogs.releaseId) ||
      (row.discogsReleaseUrl && discogs.releaseUrl && row.discogsReleaseUrl === discogs.releaseUrl),
  );
}

function bulkBuyReferencePrice(
  discogs: DiscogsMarketSnapshot | undefined,
  priceSummary: PriceSummary | undefined,
): { currency: string; source: BulkBuyRow["statsStatus"]; value: number } | null {
  const candidates: Array<{ currency: string; source: BulkBuyRow["statsStatus"]; value: number }> = [];
  const salesMedian = discogs?.salesStats?.medianPrice;
  if (salesMedian) candidates.push({ ...salesMedian, source: "sales-stats" });

  const marketMedian = discogs?.medianPrice;
  if (marketMedian) candidates.push({ ...marketMedian, source: "estimated-from-market" });

  if (priceSummary?.averageCheapestTenTotalPrice !== null && priceSummary?.averageCheapestTenTotalPrice !== undefined) {
    candidates.push({
      currency: "USD",
      source: "cheapest-ten",
      value: priceSummary.averageCheapestTenTotalPrice,
    });
  }

  return candidates.sort((left, right) => left.value - right.value)[0] ?? null;
}

function bulkBuySaleInputs(
  discogs: DiscogsMarketSnapshot | undefined,
  priceSummary: PriceSummary | undefined,
): {
  averageCheapestTenTotalPrice?: number | null;
  discogsMedianPrice?: number | null;
  titleMatchCount?: number;
} {
  return {
    averageCheapestTenTotalPrice: priceSummary?.averageCheapestTenTotalPrice,
    discogsMedianPrice: discogs?.salesStats?.medianPrice?.value ?? discogs?.medianPrice?.value,
    titleMatchCount: priceSummary?.relevantResultCount ?? 0,
  };
}

function inputLabel(input: SearchInput): string {
  if (input.type === "barcode") return input.barcode;
  if (input.type === "catalog") return input.catalogNumber;
  if (input.type === "manual") return input.query;
  return input.fileName ? `Image: ${input.fileName}` : "Image lookup";
}

export function roundDownToHalfDollar(value: number): number {
  return Math.floor(value * 2) / 2;
}
