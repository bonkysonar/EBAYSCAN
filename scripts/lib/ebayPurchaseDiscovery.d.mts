export type EbayPurchaseQueryLane = {
  id: string;
  maxAllInPrice?: number | null;
  maxItemPrice?: number | null;
  minAllInPrice?: number | null;
  minItemPrice?: number | null;
  query: string;
  requiredTitleTokens?: string[];
  sort?: "price" | "-price" | "newlyListed" | "distance";
};

export type EbayPurchaseCandidate = {
  artist: string;
  available: true;
  condition: "new/sealed";
  costs: { inboundShipping: 0 };
  discoveredByLanes: string[];
  ebayItemId: string;
  id: string;
  purchasePrice: number;
  purchasePriceIncludesShipping: true;
  purchasePriceScope: "item_plus_listed_shipping_before_tax";
  productIdentityEvidence: string[];
  productIdentityVerification: "detail_aspects" | "summary_only";
  shippingDestinationPostalCode: string | null;
  shippingQuoteType: "fixed";
  sellerAccountType: string | null;
  sellerFeedbackPercentage: number;
  sellerFeedbackScore: number;
  sellerName: string | null;
  sourceCountry: string;
  sourceCurrency: string;
  sourceId: "ebay-purchase";
  sourceItemPrice: number;
  sourceListingTitle: string;
  sourceName: "eBay";
  sourceShippingPrice: number;
  sourceUrl: string;
  title: string;
};

export type EbayPurchaseRejectionReason =
  | "above_lane_price_ceiling"
  | "below_lane_price_floor"
  | "currency_mismatch"
  | "cross_border_origin"
  | "invalid_item"
  | "item_origin_unknown"
  | "lane_token_mismatch"
  | "missing_item_price"
  | "missing_item_url"
  | "missing_title"
  | "non_record_title"
  | "not_fixed_price"
  | "not_new"
  | "record_signal_missing"
  | "seller_reputation_below_threshold"
  | "seller_reputation_missing"
  | "shipping_quote_not_fixed"
  | "shipping_unknown"
  | "unavailable"
  | "wrong_category";

export type EbayPurchaseLaneReport = {
  acceptedCount: number;
  complete: boolean;
  coverageRate: number | null;
  duplicateCount: number;
  errors: string[];
  id: string;
  pagesAttempted: number;
  pagesSucceeded: number;
  query: string;
  rawItemCount: number;
  rejectedByReason: Partial<Record<EbayPurchaseRejectionReason, number>>;
  stopReason:
    | "authentication_error"
    | "candidate_cap"
    | "exhausted"
    | "http_error"
    | "invalid_response"
    | "page_cap"
    | "rate_limited"
    | "request_error";
  totalReported: number | null;
};

export type EbayPurchasePageReport = {
  error: string | null;
  failureKind:
    | "authentication_error"
    | "http_error"
    | "invalid_response"
    | "rate_limited"
    | "request_error"
    | null;
  httpStatus: number | null;
  laneId: string;
  offset: number;
  pageNumber: number;
  rawItemCount: number;
  requestedUrl: string;
  resolvedUrl: string | null;
  status: "available" | "error";
  totalReported: number | null;
};

export type EbayPurchaseDiscoveryResult = {
  candidates: EbayPurchaseCandidate[];
  complete: boolean;
  diagnostics: {
    adapter: "ebay-browse-purchase-discovery";
    buyingOptions: ["FIXED_PRICE"];
    categoryId: string;
    coverageClaim: "all_configured_lanes_exhausted" | "bounded_api_window_not_exhaustive";
    conditionIds: ["1000"];
    conditions: ["NEW"];
    currency: string;
    deliveryCountry: string;
    deliveryPostalCodeConfigured: boolean;
    detailVerification: {
      attemptedCandidateCount: number;
      errors: Array<{ itemId: string; message: string; status: number | null }>;
      maxDetailRequests: number;
      rateLimited: boolean;
      rejectedCount: number;
      requestsMade: number;
      retryAfterMs: number | null;
      selectedCandidateCount: number;
      selectedLaneCount: number;
      selectionMode: "lane_round_robin";
      skippedCount: number;
      stopReason: "authentication_error" | "disabled" | "exhausted" | "rate_limited" | "request_cap" | "request_errors";
      unknownCount: number;
      verifiedCount: number;
    };
    duplicateCount: number;
    errors: Array<{ laneId: string; message: string; status: number | null }>;
    laneReports: EbayPurchaseLaneReport[];
    lanesProcessed: number;
    lanesRequested: number;
    lanesTruncated: boolean;
    limits: {
      maxCandidates: number;
      maxDetailRequests: number;
      maxLanes: number;
      maxPagesPerLane: number;
      pageSize: number;
    };
    pageReports: EbayPurchasePageReport[];
    rawItemsSeen: number;
    rejectedByReason: Partial<Record<EbayPurchaseRejectionReason, number>>;
    requestMode: "serial";
    requestsMade: number;
    stopReason:
      | "authentication_error"
      | "candidate_cap"
      | "exhausted"
      | "http_error"
      | "incomplete"
      | "invalid_response"
      | "lane_cap"
      | "page_cap"
      | "rate_limited"
      | "request_cap"
      | "request_errors"
      | "request_error";
  };
  evidenceScope: "active_purchase_listings_only";
  rateLimited: boolean;
  retryAfterMs: number | null;
  soldDataIncluded: false;
};

export type EbayPurchaseDiscoveryOptions = {
  categoryId?: string;
  currency?: string;
  deliveryCountry?: string;
  deliveryPostalCode?: string;
  endpointRoot?: string;
  fetchImpl?: typeof fetch;
  lanes?: EbayPurchaseQueryLane[];
  marketplaceId?: string;
  maxCandidates?: number;
  maxDetailRequests?: number;
  maxLanes?: number;
  maxPagesPerLane?: number;
  minSellerFeedbackPercentage?: number;
  minSellerFeedbackScore?: number;
  pageSize?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  token: string;
};

export type EbayApplicationTokenResult =
  | {
      available: true;
      credentialSource: "client_credentials" | "static_application_token";
      expiresInSeconds: number | null;
      status: "available";
      token: string;
    }
  | {
      available: false;
      credentialSource: "client_credentials" | null;
      expiresInSeconds: null;
      httpStatus?: number;
      reason: string;
      status: "failed" | "unavailable";
      token: null;
    };

export const EBAY_VINYL_CATEGORY_ID: "176985";
export const EBAY_PURCHASE_SOURCE_ID: "ebay-purchase";
export const DEFAULT_EBAY_MIN_SELLER_FEEDBACK_PERCENTAGE: 97;
export const DEFAULT_EBAY_MIN_SELLER_FEEDBACK_SCORE: 25;
export function ebayPurchaseOfferVerification(candidate: {
  productIdentityVerification?: string | null;
  shippingDestinationPostalCode?: string | null;
}): "discovery_lead" | "official_api";
export function assessEbayPurchaseDetail(detail: unknown): {
  evidence: string[];
  reason: "detail_identifies_accessory" | "detail_missing" | "record_format_aspects_missing" | null;
  status: "rejected" | "unknown" | "verified";
};
export const DEFAULT_EBAY_PURCHASE_LANES: readonly Readonly<EbayPurchaseQueryLane>[];

export function getEbayApplicationToken(options?: {
  endpointRoot?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<EbayApplicationTokenResult>;
export function discoverEbayPurchases(options: EbayPurchaseDiscoveryOptions): Promise<EbayPurchaseDiscoveryResult>;
export function buildEbayPurchaseSearchUrl(
  lane: EbayPurchaseQueryLane,
  options?: {
    categoryId?: string;
    currency?: string;
    deliveryCountry?: string;
    deliveryPostalCode?: string;
    endpointRoot?: string;
    offset?: number;
    pageSize?: number;
  },
): URL;
export function assessEbayPurchaseItem(
  item: unknown,
  lane?: EbayPurchaseQueryLane,
  options?: {
    categoryId?: string;
    currency?: string;
    deliveryCountry?: string;
    minSellerFeedbackPercentage?: number;
    minSellerFeedbackScore?: number;
    requireTitleRecordSignal?: boolean;
  },
):
  | { accepted: true; candidate: Omit<EbayPurchaseCandidate, "discoveredByLanes"> }
  | { accepted: false; reason: EbayPurchaseRejectionReason };
