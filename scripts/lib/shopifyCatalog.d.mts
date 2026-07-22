import type { RecordCandidateAssessment, RecordCandidateSource } from "./candidatePipeline.mjs";

export type ShopifyCatalogDescriptor = {
  collectionContext: string | null;
  url: string;
};

export type ShopifyCollectionLaneSelection = {
  candidateCount: number;
  configuredExcluded: boolean;
  eligibleCount: number;
  excludedCount: number;
  omitted: Array<{
    context: string;
    reason: "excluded_non_record_collection" | "lane_limit_reached" | "not_sale_relevant";
    url: string;
  }>;
  omittedCount: number;
  selected: Array<{
    context: string;
    url: string;
  }>;
  stopReason: "configured_collection_excluded" | "lane_limit_reached" | "no_sale_relevant_collections" | null;
};

export type NormalizedShopifyProduct = {
  availableVariantCount: number;
  barcode: string | null;
  candidateQualityReasons: string[];
  candidateQualityScore: number;
  collectionContext: string | null;
  compareAtPrice: number | null;
  currency: string | null;
  handle: string;
  inventoryQuantity: number | null;
  listingTitle: string;
  price: number;
  product: any;
  productUrl: string;
  sku: string | null;
  variantId: string | number | null;
  variantTitle: string | null;
};

export function shopifyCatalogUrls(
  source: { baseUrl?: string; url?: string },
  page: number,
  limit?: number,
  options?: { includeRootCatalog?: boolean },
): ShopifyCatalogDescriptor[];
export function selectShopifyCollectionLanes(
  values: unknown[],
  configuredUrl: string,
  limit?: number,
): ShopifyCollectionLaneSelection;
export function normalizeShopifyProducts(input: {
  assessment: (input: {
    context?: string;
    productType?: string;
    source?: RecordCandidateSource;
    tags?: string;
    title?: string;
    url?: string;
  }) => RecordCandidateAssessment;
  collectionContext?: string | null;
  currency?: string | null;
  origin: string;
  products?: any[];
  source: RecordCandidateSource;
}): NormalizedShopifyProduct[];
export function extractShopifyCurrency(htmlPages: unknown[]): string | null;
