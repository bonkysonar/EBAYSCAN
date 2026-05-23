import type { SearchResult } from "../ebay/types";
import { scoreRecord } from "../scoring/scoreRecord";
import type {
  SellerListing,
  SellerPricingAnalysis,
  SellerPricingSettings,
  SellerPricingStatus,
} from "./types";
import { defaultSellerPricingSettings } from "./types";

export function analyzeSellerPrice(
  listing: SellerListing,
  searchResult: SearchResult,
  settings: Partial<SellerPricingSettings> = {},
): SellerPricingAnalysis {
  const resolved = { ...defaultSellerPricingSettings, ...settings };
  const decision = scoreRecord(searchResult);
  const benchmarkPrice = decision.priceSummary.averageCheapestTenTotalPrice;
  const compCount = decision.priceSummary.cheapestTenCount;
  const activeComparableCount = bestActiveComparableCount(searchResult);
  const reasons: string[] = [];

  if (benchmarkPrice === null || compCount < resolved.minimumWeakComps) {
    return {
      activeComparableCount,
      benchmarkPrice,
      benchmarkSource: "insufficient-comps",
      deltaPercent: null,
      deltaValue: null,
      listing,
      reasons: ["Too few comparable active eBay prices to make a pricing call."],
      status: "NEEDS_REVIEW",
    };
  }

  const deltaValue = roundMoney(listing.currentPrice - benchmarkPrice);
  const deltaPercent = roundMoney((deltaValue / benchmarkPrice) * 100);
  const isStrongCompSet = compCount >= resolved.minimumStrongComps;
  const isHigh = deltaPercent > resolved.highPercent;
  const isLow = deltaPercent < -resolved.lowPercent;
  const isCrowded = activeComparableCount !== null && activeComparableCount >= resolved.crowdedCount;
  const isVeryCrowded = activeComparableCount !== null && activeComparableCount >= resolved.veryCrowdedCount;
  let status: SellerPricingStatus = "OK";

  if (!isStrongCompSet) {
    status = "NEEDS_REVIEW";
    reasons.push(`Only ${compCount} comparable prices were available; treat the benchmark as directional.`);
  } else if (isHigh && isVeryCrowded) {
    status = "VERY_CROWDED_PRICE_HIGH";
    reasons.push("Your price is above the cheapest-10 average in a very crowded active market.");
  } else if (isHigh && isCrowded) {
    status = "CROWDED_PRICE_HIGH";
    reasons.push("Your price is above the cheapest-10 average in a crowded active market.");
  } else if (isHigh) {
    status = "PRICE_HIGH";
    reasons.push("Your price is significantly above the cheapest-10 active eBay average.");
  } else if (isLow) {
    status = "PRICE_LOW";
    reasons.push("Your price is significantly below the cheapest-10 active eBay average.");
  } else {
    reasons.push("Your price is within the configured range of the cheapest-10 active eBay average.");
  }

  if (activeComparableCount !== null) {
    reasons.push(`${activeComparableCount} active eBay matches were reported for the best comparable query.`);
  }

  return {
    activeComparableCount,
    benchmarkPrice,
    benchmarkSource: "ebay-cheapest-10",
    deltaPercent,
    deltaValue,
    listing,
    reasons,
    status,
  };
}

export function bestActiveComparableCount(searchResult: SearchResult): number | null {
  const pages = searchResult.marketSnapshot?.ebaySearchPages ?? [];
  const preferred = pages.find((page) => page.label === "expanded artist/title" || page.label === "discogs artist/title");
  const fallback = pages[0];
  return preferred?.total ?? fallback?.total ?? null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
