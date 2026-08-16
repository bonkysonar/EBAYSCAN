import type { NormalizedVinylLotScanRequest } from "./scanOptions";
import type { VinylLotClassificationStatus, VinylLotTargetGenre } from "./types";

export const VINYL_LOT_FEEDBACK_REASON_TAGS = [
  "useful-lead",
  "not-a-lot",
  "too-few-records",
  "single-or-45",
  "wrong-genre",
  "condition-risk",
  "duplicate-noise",
  "count-missing",
  "other",
] as const;

export type VinylLotFeedbackReasonTag = typeof VINYL_LOT_FEEDBACK_REASON_TAGS[number];

export const VINYL_LOT_FEEDBACK_REASON_LABELS: Record<VinylLotFeedbackReasonTag, string> = {
  "condition-risk": "Condition risk",
  "count-missing": "Count missing",
  "duplicate-noise": "Duplicate / noisy",
  "not-a-lot": "Not really a lot",
  "other": "Other",
  "single-or-45": "Single / 45",
  "too-few-records": "Too few records",
  "useful-lead": "Useful lead",
  "wrong-genre": "Wrong genre",
};

export type VinylLotListingFeedbackInput = {
  classificationFlags: string[];
  classificationStatus: VinylLotClassificationStatus;
  conditionLevel: "below-target" | "supported-vg-plus" | "unknown";
  genre: VinylLotTargetGenre | null;
  itemId: string;
  note: string;
  priorityArtistMatched: boolean;
  quantityBucket: "12-19" | "20-plus" | "unknown";
  reasonTags: VinylLotFeedbackReasonTag[];
  score: number;
};

export type VinylLotFeedbackSubmission = {
  expectedListingCount: number;
  expiresAt: string;
  laneCoverage: Array<{
    displayedCount: number;
    genre: VinylLotTargetGenre;
    retainedCount: number;
    status: "ok" | "shortfall";
  }>;
  listings: VinylLotListingFeedbackInput[];
  overall: {
    note: string;
    score: number;
  };
  scanObservedAt: string;
  scanOptions: NormalizedVinylLotScanRequest;
  scanSchemaVersion: number;
  schemaVersion: 1;
};

export type VinylLotFeedbackSaveResult = {
  codexPrompt: string;
  codexUrl: string;
  feedbackId: string;
  feedbackPath: string;
  message: string;
  storage: "browser-local" | "local-device";
};
