export type RecordCandidateSource = {
  crawlType?: string | null;
  displayName?: string | null;
  group?: string | null;
  id?: string | null;
  name?: string | null;
  noiseLevel?: string | null;
  priority?: number | null;
  retailSourceType?: string | null;
  saleLikelihood?: string | null;
  sourceNoiseLevel?: string | null;
  sourcePriority?: number | null;
  sourceSaleLikelihood?: string | null;
  sourceType?: string | null;
  url?: string | null;
};

export type RecordCandidateAssessment = {
  accepted: boolean;
  reasons: string[];
  score: number;
};

export type RankableCandidate = RecordCandidateSource & {
  activeListingCount?: number | null;
  appliedSaleCampaignId?: string | null;
  appliedSaleCode?: string | null;
  appliedSaleDiscountPercent?: number | null;
  appliedSaleEvidence?: string | null;
  appliedSaleScope?: string | null;
  appliedSaleUrl?: string | null;
  artist?: string | null;
  artistSoldUnits365Days?: number | null;
  available?: boolean | null;
  averageSoldPrice?: number | null;
  averageSoldShipping?: number | null;
  availableVariantCount?: number | null;
  barcode?: string | null;
  candidateQualityScore?: number;
  condition?: string | null;
  collectionContext?: string | null;
  collectionContexts?: string[];
  discoveryUrl?: string | null;
  discoveryUrls?: string[];
  id?: string;
  listPrice?: number | null;
  purchasePrice?: number;
  purchaseOfferVerification?: "campaign_advertised" | "direct_retailer" | "discovery_lead" | "official_api";
  retailerBestSeller?: boolean;
  retailerCustomerPick?: boolean;
  retailerReviewCount?: number | null;
  retailerSoldBySource?: boolean | null;
  sku?: string | null;
  sourceCrawlType?: string | null;
  sourceGroup?: string | null;
  soldEvidence?: {
    status?: string | null;
    unitsSold90Days?: number | null;
  } | null;
  sourceId?: string;
  sourceListingTitle?: string | null;
  sourceName?: string;
  sourceOriginalPrice?: number | null;
  sourceRetailType?: string | null;
  sourceUrl?: string | null;
  shopifyVariantTitle?: string | null;
  stockStatus?: string | null;
  title?: string;
  totalSoldCount?: number | null;
  upc?: string | null;
  gtin?: string | null;
  gtin8?: string | null;
  gtin12?: string | null;
  gtin13?: string | null;
  gtin14?: string | null;
  variantTitle?: string | null;
};

export type VerifiedSaleCampaign = {
  campaignId?: string | null;
  code?: string | null;
  couponCode?: string | null;
  discountPercent?: number | null;
  evidence?: string | null;
  fingerprint?: string | null;
  id?: string | null;
  promoCode?: string | null;
  saleCampaignId?: string | null;
  saleCode?: string | null;
  saleDiscountPercent?: number | null;
  saleEvidence?: string | null;
  saleScope?: string | null;
  saleSignal?: string | null;
  saleVerification?: string | null;
  scope?: string | null;
  signal?: string | null;
  sourceId?: string | null;
  sourceListingTitle?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  verification?: string | null;
};

export type CandidateSelectionPhase =
  | "protected_quality"
  | "family_representation"
  | "source_representation"
  | "ranked_fill"
  | "family_cap_relaxation";

export type CandidateSelectionExclusionReason =
  | "duplicate_pressing"
  | "duplicate_candidate_identity"
  | "source_cap"
  | "family_cap"
  | "selection_limit";

export type CandidateSourceSelectionDiagnostics = {
  bestCandidateRank: number | null;
  bestCandidateScore: number | null;
  bestSelectedRank: number | null;
  eligibleCandidateCount: number;
  excludedByReason: Record<CandidateSelectionExclusionReason, number>;
  excludedCandidateCount: number;
  inputCandidateCount: number;
  primaryExclusionReason: CandidateSelectionExclusionReason | null;
  selectedByPhase: Record<CandidateSelectionPhase, number>;
  selectedCandidateCount: number;
  selectedShare: number;
  selectionStatus: "selected" | "not_selected" | CandidateSelectionExclusionReason;
  sourceId: string;
};

export type CandidateSelectionDiagnostics = {
  duplicatePressingCandidateCount: number;
  effectiveLimit: number;
  eligibleCandidateCount: number;
  eligibleSourceCount: number;
  excludedByReason: Record<CandidateSelectionExclusionReason, number>;
  inputCandidateCount: number;
  largestSourceSelectedCount: number;
  largestSourceShare: number;
  limitApplied: boolean;
  maxPerFamily: number | null;
  maxPerSource: number | null;
  representedSourceCount: number;
  requestedLimit: number | null;
  selectedByPhase: Record<CandidateSelectionPhase, number>;
  selectedCandidateCount: number;
  sourceConcentrationHhi: number;
  sources: CandidateSourceSelectionDiagnostics[];
  unrepresentedEligibleSourceCount: number;
};

export type CandidateSelectionOptions<T extends RankableCandidate> = {
  compareCandidates?: (left: T, right: T) => number;
  dedupePressings?: boolean;
  explorationShare?: number;
  familyExploration?: boolean;
  familyKey?: (candidate: T) => string | null | undefined;
  limit?: number;
  maxPerFamily?: number;
  maxPerSource?: number;
  perFamilyShare?: number;
  perSourceShare?: number;
  preserveTopCount?: number;
  preserveTopShare?: number;
  scoreCandidate?: (candidate: T) => number;
};

export type HighSignalProductFind = {
  averageSoldPrice?: number | null;
  averageSoldShipping?: number | null;
  available?: boolean | null;
  candidateQualityScore?: number | null;
  collectionContext?: string | null;
  condition?: string | null;
  crawlType?: string | null;
  discoveryUrl?: string | null;
  purchasePrice: number;
  retailerSellerName?: string | null;
  retailerSoldBySource?: boolean | null;
  sourceCountry?: string | null;
  sourceCrawlType?: string | null;
  sourceCurrency?: string | null;
  sourceDefaultDiscountThreshold?: number | null;
  sourceDiscountPercent?: number | null;
  sourceDomain?: string | null;
  sourceGroup?: string | null;
  sourceId?: string;
  sourceListingTitle?: string;
  sourceName?: string;
  sourceNoiseLevel?: string | null;
  sourceOriginalPrice?: number | null;
  sourceRetailType?: string | null;
  sourceType?: string | null;
  sourceUrl?: string;
  stockStatus?: string | null;
  totalSoldCount?: number | null;
  verification?: string | null;
  walmartStockStatus?: string | null;
};

export function assessRecordCandidate(input?: {
  context?: string;
  productType?: string;
  source?: RecordCandidateSource;
  tags?: string;
  title?: string;
  url?: string;
}): RecordCandidateAssessment;
export function candidateQualityScore(candidate: RankableCandidate): number;
export function applyVerifiedSaleCampaigns<T extends RankableCandidate>(
  candidates: T[],
  campaigns: VerifiedSaleCampaign[],
): Array<T & RankableCandidate>;
export function purchaseOfferVerificationForSource(
  candidate?: Pick<RankableCandidate, "purchaseOfferVerification" | "retailerSoldBySource">,
  source?: RecordCandidateSource,
): "campaign_advertised" | "direct_retailer" | "discovery_lead" | "official_api";
export function isHighSignalProductFind(find: HighSignalProductFind): boolean;
export function rankAndSelectCandidates<T extends RankableCandidate>(
  candidates: T[],
  options?: CandidateSelectionOptions<T>,
): T[];
export function rankAndSelectCandidatesWithDiagnostics<T extends RankableCandidate>(
  candidates: T[],
  options?: CandidateSelectionOptions<T>,
): { diagnostics: CandidateSelectionDiagnostics; selected: T[] };
export function sourceMetadataScore(source: RecordCandidateSource): number;
