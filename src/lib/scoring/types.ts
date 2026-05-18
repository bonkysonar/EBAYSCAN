import type { CandidateListing } from "../ebay/types";

export type DecisionColor = "GREEN" | "YELLOW" | "RED";

export type PriceSummary = {
  lowestTotalPrice: number | null;
  averageCheapestTenTotalPrice: number | null;
  cheapestTenCount: number;
  medianTotalPrice: number | null;
  trimmedMedianTotalPrice: number | null;
  resultCount: number;
  relevantResultCount: number;
  sameTitleClusterCount: number;
  highOutlierCount: number;
  priceSpread: number | null;
};

export type ScoringSettings = {
  threshold: number;
  minimumResultsForSkip: number;
  minimumConfidenceForSkip: number;
  highOutlierMultiplier: number;
  wideSpreadMultiplier: number;
};

export type TriageDecision = {
  decision: DecisionColor;
  confidence: number;
  threshold: number;
  priceSummary: PriceSummary;
  reasons: string[];
  warnings: string[];
  topListings: CandidateListing[];
  suggestedAction: string;
};

export const defaultScoringSettings: ScoringSettings = {
  threshold: 5,
  minimumResultsForSkip: 4,
  minimumConfidenceForSkip: 0.72,
  highOutlierMultiplier: 3,
  wideSpreadMultiplier: 4,
};
