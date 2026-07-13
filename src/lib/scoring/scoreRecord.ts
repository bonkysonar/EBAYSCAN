import type { CandidateListing, SearchResult } from "../ebay/types";
import { extractConsensus } from "../normalization/extractConsensus";
import { normalizeTitle } from "../normalization/normalizeTitle";
import { findRiskFlags } from "./rules";
import { defaultScoringSettings, type PriceSummary, type ScoringSettings, type TriageDecision } from "./types";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function trimmedMedian(values: number[]): number | null {
  if (values.length <= 2) return median(values);
  const sorted = [...values].sort((a, b) => a - b);
  return median(sorted.slice(1, -1));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizePrices(params: {
  allListings: CandidateListing[];
  relevantListings: CandidateListing[];
  sameTitleClusterCount: number;
  threshold: number;
}): PriceSummary {
  const totals = params.relevantListings.map((listing) => listing.totalPrice).filter((price) => Number.isFinite(price));
  const lowest = totals.length ? Math.min(...totals) : null;
  const highest = totals.length ? Math.max(...totals) : null;
  const medianTotalPrice = median(totals);
  const trimmedMedianTotalPrice = trimmedMedian(totals);
  const cheapestTen = [...totals].sort((a, b) => a - b).slice(0, 10);
  const highOutlierCount = totals.filter((price) => price >= params.threshold * 3).length;

  return {
    lowestTotalPrice: lowest,
    averageCheapestTenTotalPrice: average(cheapestTen),
    cheapestTenCount: cheapestTen.length,
    medianTotalPrice,
    trimmedMedianTotalPrice,
    resultCount: params.allListings.length,
    relevantResultCount: params.relevantListings.length,
    sameTitleClusterCount: params.sameTitleClusterCount,
    highOutlierCount,
    priceSpread: lowest === null || highest === null ? null : highest - lowest,
  };
}

function relevantListingsForSearch(searchResult: SearchResult, listings: CandidateListing[]): CandidateListing[] {
  if (searchResult.input.type !== "manual") return listings;

  const queryTokens = meaningfulTokens(searchResult.input.query);
  if (queryTokens.length < 2) return listings;

  const relevant = listings.filter((listing) => {
    const titleTokens = new Set(meaningfulTokens(listing.title));
    return queryTokens.every((token) => titleTokens.has(token));
  });

  return relevant.length >= 3 ? relevant : listings;
}

function meaningfulTokens(value: string): string[] {
  const noise = new Set(["album", "and", "lp", "record", "records", "stereo", "the", "vinyl"]);
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !noise.has(token));
}

function cheapestListings(listings: CandidateListing[], count = 12): CandidateListing[] {
  return [...listings]
    .filter((listing) => Number.isFinite(listing.totalPrice))
    .sort((a, b) => a.totalPrice - b.totalPrice)
    .slice(0, count);
}

function confidenceFor(params: {
  resultCount: number;
  clusterRatio: number;
  riskCount: number;
  priceSpread: number | null;
  threshold: number;
}): number {
  const resultScore = Math.min(params.resultCount / 6, 1) * 0.35;
  const consensusScore = params.clusterRatio * 0.35;
  const riskPenalty = Math.min(params.riskCount * 0.08, 0.24);
  const spreadPenalty = params.priceSpread !== null && params.priceSpread > params.threshold * 4 ? 0.2 : 0;
  return Math.max(0, Math.min(1, resultScore + consensusScore + 0.25 - riskPenalty - spreadPenalty));
}

export function scoreRecord(searchResult: SearchResult, settings: Partial<ScoringSettings> = {}): TriageDecision {
  const resolvedSettings = { ...defaultScoringSettings, ...settings };
  const { threshold } = resolvedSettings;
  const listings = searchResult.listings;
  const relevantListings = relevantListingsForSearch(searchResult, listings);
  const consensus = extractConsensus(listings);
  const riskFlags = findRiskFlags(listings);
  const priceSummary = summarizePrices({
    allListings: listings,
    relevantListings,
    sameTitleClusterCount: consensus.clusterCount,
    threshold,
  });
  const confidence = confidenceFor({
    resultCount: relevantListings.length,
    clusterRatio: consensus.clusterRatio,
    riskCount: riskFlags.length,
    priceSpread: priceSummary.priceSpread,
    threshold,
  });

  const reasons: string[] = [];
  const warnings = [...searchResult.warnings];
  const lowEndAverage = priceSummary.averageCheapestTenTotalPrice;
  const benchmark = lowEndAverage ?? priceSummary.trimmedMedianTotalPrice ?? priceSummary.medianTotalPrice;
  const discogsSalesStats = searchResult.marketSnapshot?.discogs?.salesStats;
  const discogsSalesMedian = discogsSalesStats?.medianPrice?.value;
  const discogsPriceGuide = searchResult.marketSnapshot?.discogs?.suggestedPrice;
  const discogsSuggestedPrice = discogsPriceGuide?.value;
  const discogsSuggestedCondition = searchResult.marketSnapshot?.discogs?.suggestedPriceCondition ?? "used-condition";
  const topListings = cheapestListings(relevantListings);
  const enoughResults = relevantListings.length >= resolvedSettings.minimumResultsForSkip;
  const goodConsensus = consensus.clusterRatio >= 0.7;
  const wideSpread = priceSummary.priceSpread !== null && priceSummary.priceSpread > threshold * resolvedSettings.wideSpreadMultiplier;
  const hasHighOutliers = priceSummary.highOutlierCount > 0;
  const hasRiskFlags = riskFlags.length > 0;

  if (!enoughResults) reasons.push("Too few title-matching candidate listings for a confident decision.");
  if (!goodConsensus) reasons.push("Candidate listings do not strongly agree on the same record.");
  if (relevantListings.length !== listings.length) {
    reasons.push(`Price check used ${relevantListings.length} title-matching listings out of ${listings.length} returned results.`);
  }
  if (wideSpread) reasons.push("Price spread is wide, so the record needs manual judgment.");
  if (hasHighOutliers) reasons.push("One or more listings are high outliers above the threshold.");
  if (hasRiskFlags) reasons.push(`Risk keywords found: ${[...new Set(riskFlags.map((flag) => flag.keyword))].join(", ")}.`);

  if (discogsSalesMedian !== undefined && discogsSalesStats?.source === "browser_extension") {
    const medianReason = `Discogs browser helper median is $${discogsSalesMedian.toFixed(2)} against the $${threshold.toFixed(2)} threshold.`;
    return {
      decision: discogsSalesMedian > threshold ? "GREEN" : "RED",
      confidence: 1,
      threshold,
      priceSummary,
      reasons: [
        medianReason,
        discogsSalesMedian > threshold
          ? "Discogs median is above threshold, so this is worth processing/listing."
          : "Discogs median is at or below threshold, so this is likely safe to skip.",
      ],
      warnings,
      topListings,
      suggestedAction:
        discogsSalesMedian > threshold
          ? "Worth processing or listing based on Discogs median."
          : "Likely safe to skip based on Discogs median.",
    };
  }

  if (benchmark === null) {
    return {
      decision: "YELLOW",
      confidence: 0,
      threshold,
      priceSummary,
      reasons: ["No usable prices were returned."],
      warnings,
      topListings: [],
      suggestedAction: "Manual check required.",
    };
  }

  if (discogsSalesMedian !== undefined && discogsSalesMedian <= threshold && benchmark > threshold) {
    reasons.unshift(
      `Discogs sales median is $${discogsSalesMedian.toFixed(2)}, at or below the $${threshold.toFixed(2)} threshold.`,
    );
    return {
      decision: "YELLOW",
      confidence: Math.min(confidence, 0.68),
      threshold,
      priceSummary,
      reasons,
      warnings,
      topListings,
      suggestedAction: "Manual check needed; Discogs sales history is weaker than active eBay listings.",
    };
  }

  if (
    discogsSalesMedian === undefined &&
    discogsSuggestedPrice !== undefined &&
    discogsSuggestedPrice <= threshold &&
    benchmark > threshold
  ) {
    reasons.unshift(
      `Discogs ${discogsSuggestedCondition} price guide is $${discogsSuggestedPrice.toFixed(2)}, at or below the $${threshold.toFixed(2)} threshold.`,
    );
    return {
      decision: "YELLOW",
      confidence: Math.min(confidence, 0.68),
      threshold,
      priceSummary,
      reasons,
      warnings,
      topListings,
      suggestedAction: "Manual check needed; the Discogs price guide is weaker than active eBay listings.",
    };
  }

  if (benchmark > threshold && enoughResults) {
    reasons.unshift(`Cheapest comparable listings average above the $${threshold.toFixed(2)} threshold.`);
    if (discogsSalesMedian !== undefined) {
      reasons.push(`Discogs sales median is $${discogsSalesMedian.toFixed(2)}, also above the threshold.`);
    } else if (discogsSuggestedPrice !== undefined) {
      reasons.push(
        `Discogs ${discogsSuggestedCondition} price guide is $${discogsSuggestedPrice.toFixed(2)}, also above the threshold.`,
      );
    }
    if (!goodConsensus) {
      reasons.push("Consensus is imperfect, but the low-end comparable average is strong enough to avoid skipping.");
    }
    return {
      decision: "GREEN",
      confidence: Math.max(confidence, goodConsensus ? 0.72 : 0.62),
      threshold,
      priceSummary,
      reasons,
      warnings,
      topListings,
      suggestedAction: "Worth processing or listing. Do not skip casually.",
    };
  }

  if (
    enoughResults &&
    goodConsensus &&
    !wideSpread &&
    !hasHighOutliers &&
    !hasRiskFlags &&
    benchmark <= threshold &&
    confidence >= resolvedSettings.minimumConfidenceForSkip
  ) {
    reasons.unshift(`Cheapest comparable listings average at or below the $${threshold.toFixed(2)} threshold.`);
    reasons.push("Enough similar listings were found to support a conservative skip.");
    return {
      decision: "RED",
      confidence,
      threshold,
      priceSummary,
      reasons,
      warnings,
      topListings,
      suggestedAction: "Likely safe to skip or move to bulk pile.",
    };
  }

  if (benchmark > threshold) {
    reasons.unshift(`Low-end comparable pricing is above the $${threshold.toFixed(2)} threshold, but confidence is not clean enough to auto-green.`);
  } else {
    reasons.unshift("Low prices were found, but risk or ambiguity prevents an automatic skip.");
  }

  return {
    decision: "YELLOW",
    confidence,
    threshold,
    priceSummary,
    reasons,
    warnings,
    topListings,
    suggestedAction: "Manual check needed before skipping or listing.",
  };
}
