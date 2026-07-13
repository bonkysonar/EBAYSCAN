import type { ArbitrageFind, ArbitrageScoredFind, ArbitrageSettings } from "./types";

export const defaultArbitrageSettings: ArbitrageSettings = {
  maxActiveListingsForScarceSingle: 3,
  minAverageSoldPrice: 10,
  minMarginDollars: 7,
  minMarginRatio: 0.25,
  minOneSellerSoldCount: 10,
  minTotalSoldCount: 10,
  sourceTaxRatePercent: 9.5,
};

export function scoreArbitrageFind(find: ArbitrageFind, settings: ArbitrageSettings): ArbitrageScoredFind {
  if (find.opportunityType === "sitewide_sale") {
    return {
      ...find,
      allInCost: 0,
      decision: find.status ?? "WATCH",
      estimatedMargin: null,
      marginRatio: null,
      reasons: [
        find.saleSignal ? `Sale signal: ${find.saleSignal}` : "Site-wide or broad sale detected.",
        "Review the source page manually; no per-record eBay API check was run.",
      ],
    };
  }

  const allInCost = roundMoney(find.purchasePrice * (1 + settings.sourceTaxRatePercent / 100));
  const averageSale = soldTotal(find);
  const activeLow = find.lowestActivePrice ?? null;
  const estimatedMargin = activeLow === null ? null : roundMoney(activeLow - allInCost);
  const marginRatio = estimatedMargin === null || activeLow === null || activeLow <= 0 ? null : roundMoney(estimatedMargin / activeLow);
  const totalSold = find.totalSoldCount ?? 0;
  const oneSellerSold = find.oneSellerSoldCount ?? 0;
  const activeListings = find.activeListingCount;
  const reasons: string[] = [];

  if (activeLow !== null) {
    reasons.push(`Cheapest active new vinyl listing is ${money(activeLow)}.`);
  } else if (find.ebayActiveSearchStatus === "no_results") {
    reasons.push("No active new vinyl listings found for the normalized query.");
  } else if (find.ebayActiveSearchStatus === "failed") {
    reasons.push("Active eBay search failed.");
  } else {
    reasons.push("Active eBay low has not been searched yet.");
  }

  if (averageSale !== null) {
    reasons.push("Sold/Product Research evidence is retained for manual validation, but active eBay low drives this score.");
  }

  if (averageSale !== null && averageSale < settings.minAverageSoldPrice) {
    reasons.push(`Average sold total is below $${settings.minAverageSoldPrice.toFixed(2)}.`);
  }

  if (estimatedMargin === null) {
    reasons.push("Spread cannot be calculated until an active eBay low is known.");
  } else if (estimatedMargin < settings.minMarginDollars) {
    reasons.push(`Spread is below the $${settings.minMarginDollars.toFixed(2)} floor.`);
  }

  if (marginRatio !== null && marginRatio < settings.minMarginRatio) {
    reasons.push(`Spread ratio is below ${(settings.minMarginRatio * 100).toFixed(0)}%.`);
  }

  if (oneSellerSold >= settings.minOneSellerSoldCount) {
    reasons.push(`One seller sold ${oneSellerSold}, meeting the repeat-seller proof rule.`);
  } else if (totalSold >= settings.minTotalSoldCount) {
    reasons.push(`${totalSold} total sold in 3 years, but repeat-seller proof is weaker.`);
  } else if (totalSold > 1) {
    reasons.push(`Only ${totalSold} sold in 3 years.`);
  } else if (totalSold === 1) {
    reasons.push("Single-copy sold history; route to scarcity review.");
  } else {
    reasons.push("No sold-count proof yet.");
  }

  if (activeListings !== null && activeListings !== undefined) {
    if (totalSold <= 1 && activeListings <= settings.maxActiveListingsForScarceSingle) {
      reasons.push(`${activeListings} active listings found, so scarcity may matter.`);
    } else if (totalSold <= 1 && activeListings > settings.maxActiveListingsForScarceSingle) {
      reasons.push(`${activeListings} active listings with thin sales history is usually a reject.`);
    }
  }

  const decision = decide({
    activeListings,
    activeLow,
    estimatedMargin,
    marginRatio,
    settings,
  });

  return {
    ...find,
    allInCost,
    decision,
    estimatedMargin,
    marginRatio,
    reasons,
  };
}

function decide({
  activeListings,
  activeLow,
  estimatedMargin,
  marginRatio,
  settings,
}: {
  activeListings?: number | null;
  activeLow: number | null;
  estimatedMargin: number | null;
  marginRatio: number | null;
  settings: ArbitrageSettings;
}): "BUY" | "WATCH" | "REVIEW" | "REJECT" {
  const hasMargin =
    estimatedMargin !== null &&
    estimatedMargin >= settings.minMarginDollars &&
    marginRatio !== null &&
    marginRatio >= settings.minMarginRatio;

  if (!activeLow) return "REVIEW";
  if (hasMargin) return "BUY";
  if (estimatedMargin !== null && estimatedMargin >= 5) return "WATCH";
  if ((activeListings ?? Number.POSITIVE_INFINITY) <= settings.maxActiveListingsForScarceSingle) return "REVIEW";
  return "REJECT";
}

function soldTotal(find: ArbitrageFind): number | null {
  if (find.averageSoldPrice === null || find.averageSoldPrice === undefined) return null;
  return roundMoney(find.averageSoldPrice + (find.averageSoldShipping ?? 0));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}
