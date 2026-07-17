export type RecordCandidateSource = {
  crawlType?: string;
  displayName?: string;
  group?: string;
  id?: string;
  name?: string;
  noiseLevel?: string;
  priority?: number;
  saleLikelihood?: string;
  sourceNoiseLevel?: string;
  sourcePriority?: number;
  sourceSaleLikelihood?: string;
  sourceType?: string;
  url?: string;
};

export type RecordCandidateAssessment = {
  accepted: boolean;
  reasons: string[];
  score: number;
};

export type RankableCandidate = RecordCandidateSource & {
  activeListingCount?: number | null;
  artist?: string | null;
  artistSoldUnits365Days?: number | null;
  available?: boolean | null;
  averageSoldPrice?: number | null;
  averageSoldShipping?: number | null;
  availableVariantCount?: number | null;
  barcode?: string | null;
  candidateQualityScore?: number;
  condition?: string | null;
  discoveryUrl?: string | null;
  id?: string;
  purchasePrice?: number;
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
export function isHighSignalProductFind(find: HighSignalProductFind): boolean;
export function rankAndSelectCandidates<T extends RankableCandidate>(
  candidates: T[],
  options?: {
    dedupePressings?: boolean;
    explorationShare?: number;
    familyExploration?: boolean;
    familyKey?: (candidate: T) => string | null | undefined;
    limit?: number;
    maxPerFamily?: number;
    maxPerSource?: number;
    perFamilyShare?: number;
    perSourceShare?: number;
  },
): T[];
export function sourceMetadataScore(source: RecordCandidateSource): number;
