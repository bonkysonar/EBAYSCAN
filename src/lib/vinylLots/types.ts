export type VinylLotTargetGenre =
  | "hip-hop"
  | "classic-rock"
  | "1990s-rock"
  | "instrumental-jazz";

export type VinylLotClassificationStatus = "qualifying" | "near-match" | "review" | "rejected";

export type VinylLotArtistSignalMode = "always-review" | "priority";

export type VinylLotPriorityArtistInput = {
  genre: VinylLotTargetGenre;
  mode: VinylLotArtistSignalMode;
  name: string;
};

export type VinylLotReviewReason = {
  code: string;
  message: string;
};

export type VinylLotQuantityAssessment = {
  confidence: "high" | "medium" | "low";
  count: number | null;
  evidence: string | null;
  meetsMinimum: boolean;
  nearMatch: boolean;
  source: "description" | "title" | "unknown";
};

export type VinylLotGenreAssessment = {
  confidence: "high" | "medium" | "low";
  matchesTarget: boolean;
  primary: VinylLotTargetGenre | null;
  searchGenre: VinylLotTargetGenre | null;
  signals: string[];
};

export type VinylLotConditionAssessment = {
  confidence: "high" | "medium" | "low";
  evidence: string | null;
  level: "supported-vg-plus" | "below-target" | "unknown";
};

export type VinylLotCollectionAssessment = {
  confidence: "high" | "medium" | "low";
  evidence: string | null;
  isCollection: boolean;
};

export type VinylLotClassification = {
  collection: VinylLotCollectionAssessment;
  condition: VinylLotConditionAssessment;
  flags: string[];
  genre: VinylLotGenreAssessment;
  priorityArtistMatches: string[];
  quantity: VinylLotQuantityAssessment;
  reviewReasons: VinylLotReviewReason[];
  status: VinylLotClassificationStatus;
};

export type ClassifyVinylLotInput = {
  conditionText?: string | null;
  excludeSinglesAndFortyFives?: boolean;
  includeUnknownCount?: boolean;
  minimumRecords?: number;
  priorityArtists?: VinylLotPriorityArtistInput[];
  searchGenre?: VinylLotTargetGenre | null;
  shortDescription?: string | null;
  title: string;
};

export const VINYL_LOT_GENRE_LABELS: Record<VinylLotTargetGenre, string> = {
  "hip-hop": "Hip-hop",
  "classic-rock": "Classic rock",
  "1990s-rock": "1990s rock",
  "instrumental-jazz": "Instrumental jazz",
};
