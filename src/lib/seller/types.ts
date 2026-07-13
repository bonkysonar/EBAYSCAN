export type SellerListing = {
  availableQuantity?: number;
  condition?: string;
  currency: string;
  currentPrice: number;
  customLabel?: string;
  endTime?: string;
  id: string;
  imageUrl?: string;
  itemUrl?: string;
  quantitySold?: number;
  sku?: string;
  startTime?: string;
  title: string;
};

export type SellerListingsResult = {
  hasMore?: boolean;
  listings: SellerListing[];
  nextPageNumber?: number;
  pageCount?: number;
  source: "ebay-trading";
  timestamp: string;
  total: number;
  warnings: string[];
};

export type SellerPricingStatus =
  | "PRICE_HIGH"
  | "PRICE_LOW"
  | "CROWDED_PRICE_HIGH"
  | "VERY_CROWDED_PRICE_HIGH"
  | "OK"
  | "NEEDS_REVIEW";

export type SellerPricingAnalysis = {
  activeComparableCount: number | null;
  benchmarkPrice: number | null;
  benchmarkSource: "ebay-cheapest-10" | "insufficient-comps";
  deltaPercent: number | null;
  deltaValue: number | null;
  listing: SellerListing;
  reasons: string[];
  status: SellerPricingStatus;
};

export type SellerPricingSettings = {
  crowdedCount: number;
  highPercent: number;
  lowPercent: number;
  minimumStrongComps: number;
  minimumWeakComps: number;
  veryCrowdedCount: number;
};

export const defaultSellerPricingSettings: SellerPricingSettings = {
  crowdedCount: 50,
  highPercent: 25,
  lowPercent: 20,
  minimumStrongComps: 10,
  minimumWeakComps: 4,
  veryCrowdedCount: 150,
};
