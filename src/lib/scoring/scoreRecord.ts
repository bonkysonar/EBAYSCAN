import type { CandidateListing, SearchResult } from "../ebay/types";
import { extractConsensus } from "../normalization/extractConsensus";
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

function summarizePrices(listings: CandidateListing[], threshold: number, sameTitleClusterCount: number): PriceSummary {
  const totals = listings.map((listing) => listing.totalPrice).filter((price) => Number.isFinite(price));
  const lowest = totals.length ? Math.min(...totals) : null;
  const highest = totals.length ? Math.max(...totals) : null;
  const medianTotalPrice = median(totals);
  const trimmedMedianTotalPrice = trimmedMedian(totals);
  const highOutlierCount = totals.filter((price) => price >= threshold * 3).length;

  return {
    lowestTotalPrice: lowest,
    medianTotalPrice,
    trimmedMedianTotalPrice,
    resultCount: listings.length,
    sameTitleClusterCount,
    highOutlierCount,
    priceSpread: lowest === null || highest === null ? null : highest - lowest,
  };
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
  const consensus = extractConsensus(listings);
  const riskFlags = findRiskFlags(listings);
  const priceSummary = summarizePrices(listings, threshold, consensus.clusterCount);
  const confidence = confidenceFor({
    resultCount: listings.length,
    clusterRatio: consensus.clusterRatio,
    riskCount: riskFlags.length,
    priceSpread: priceSummary.priceSpread,
    threshold,
  });

  const reasons: string[] = [];
  const warnings = [...searchResult.warnings];
  const trimmed = priceSummary.trimmedMedianTotalPrice ?? priceSummary.medianTotalPrice;
  const enoughResults = listings.length >= resolvedSettings.minimumResultsForSkip;
  const goodConsensus = consensus.clusterRatio >= 0.7;
  const wideSpread = priceSummary.priceSpread !== null && priceSummary.priceSpread > threshold * resolvedSettings.wideSpreadMultiplier;
  const hasHighOutliers = priceSummary.highOutlierCount > 0;
  const hasRiskFlags = riskFlags.length > 0;

  if (!enoughResults) reasons.push("Too few candidate listings for a confident decision.");
  if (!goodConsensus) reasons.push("Candidate listings do not strongly agree on the same record.");
  if (wideSpread) reasons.push("Price spread is wide, so the record needs manual judgment.");
  if (hasHighOutliers) reasons.push("One or more listings are high outliers above the threshold.");
  if (hasRiskFlags) reasons.push(`Risk keywords found: ${[...new Set(riskFlags.map((flag) => flag.keyword))].join(", ")}.`);

  if (trimmed === null) {
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

  if (trimmed > threshold && goodConsensus && listings.length >= 3) {
    reasons.unshift(`Comparable listings cluster above the $${threshold.toFixed(2)} threshold.`);
    return {
      decision: "GREEN",
      confidence: Math.max(confidence, 0.72),
      threshold,
      priceSummary,
      reasons,
      warnings,
      topListings: listings.slice(0, 5),
      suggestedAction: "Worth processing or listing. Do not skip casually.",
    };
  }

  if (
    enoughResults &&
    goodConsensus &&
    !wideSpread &&
    !hasHighOutliers &&
    !hasRiskFlags &&
    trimmed <= threshold &&
    confidence >= resolvedSettings.minimumConfidenceForSkip
  ) {
    reasons.unshift(`Low-price cluster is at or below the $${threshold.toFixed(2)} threshold.`);
    reasons.push("Enough similar listings were found to support a conservative skip.");
    return {
      decision: "RED",
      confidence,
      threshold,
      priceSummary,
      reasons,
      warnings,
      topListings: listings.slice(0, 5),
      suggestedAction: "Likely safe to skip or move to bulk pile.",
    };
  }

  if (trimmed > threshold) {
    reasons.unshift(`Median pricing is above the $${threshold.toFixed(2)} threshold, but confidence is not clean enough to auto-green.`);
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
    topListings: listings.slice(0, 5),
    suggestedAction: "Manual check needed before skipping or listing.",
  };
}

