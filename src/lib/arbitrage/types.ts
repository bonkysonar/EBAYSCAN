import type { VinylShopSource } from "./vinylShopSources";

export type ArbitrageDecision = "BUY" | "WATCH" | "REVIEW" | "REJECT";
export type ArbitrageOpportunityType = "product_deal" | "sitewide_sale";

export type ArbitrageSettings = {
  maxActiveListingsForScarceSingle: number;
  minAverageSoldPrice: number;
  minMarginDollars: number;
  minMarginRatio: number;
  minOneSellerSoldCount: number;
  minTotalSoldCount: number;
  sourceTaxRatePercent: number;
};

export type ArbitrageFind = {
  activeListingCount?: number | null;
  artist: string;
  averageSoldPrice?: number | null;
  averageSoldShipping?: number | null;
  capturedAt: string;
  condition?: string;
  dismissedAt?: string;
  discoveryUrl?: string | null;
  ebayResearchKeyword?: string;
  ebayResearchKeywordVariants?: string[];
  ebayResearchLatestSaleDate?: string | null;
  ebayResearchRows?: Array<{
    avgShipping?: number | null;
    avgSoldPrice?: number | null;
    dateLastSold?: string | null;
    itemSales?: number | null;
    title: string;
    totalSold: number;
  }>;
  ebayResearchStatus?: "failed" | "no_rows" | "pending" | "validated";
  ebayResearchUpdatedAt?: string;
  ebayResearchUrl?: string;
  ebayActiveListings?: Array<{
    condition?: string;
    currency?: string;
    id?: string;
    itemUrl?: string;
    price: number;
    shippingPrice: number;
    title: string;
    totalPrice: number;
  }>;
  ebayActiveSearchError?: string;
  ebayActiveSearchKeyword?: string;
  ebayActiveSearchStatus?: "available" | "failed" | "no_results";
  ebayActiveSearchUpdatedAt?: string;
  ebayActiveSearchUrl?: string;
  ebayActiveSearchVariants?: string[];
  id: string;
  lowestActiveItemPrice?: number | null;
  lowestActivePrice?: number | null;
  lowestActiveShippingPrice?: number | null;
  lowestActiveTitle?: string;
  lowestActiveUrl?: string;
  notes?: string[];
  oneSellerSoldCount?: number | null;
  opportunityType?: ArbitrageOpportunityType;
  purchasePrice: number;
  quantityAvailable?: number | null;
  saleScope?: string;
  saleSignal?: string;
  saleDiscountPercent?: number | null;
  saleEvidence?: string;
  saleFingerprint?: string;
  saleScanCount?: number;
  saleStatus?: "changed" | "new" | "ongoing";
  saleVerification?: "discovery-lead" | "retailer-page";
  firstSeenAt?: string;
  sourceId: VinylShopSource["id"] | string;
  sourceDiscountPercent?: number | null;
  sourceName: string;
  sourceListingTitle?: string;
  sourceOriginalPrice?: number | null;
  sourcePublishedAt?: string | null;
  sourceUrl: string;
  status?: ArbitrageDecision;
  title: string;
  totalSoldCount?: number | null;
};

export type ArbitrageScoredFind = ArbitrageFind & {
  allInCost: number;
  decision: ArbitrageDecision;
  estimatedMargin: number | null;
  marginRatio: number | null;
  reasons: string[];
};

export type ArbitrageImportPayload = {
  createdAt: string;
  finds: ArbitrageFind[];
  saleEvents?: ArbitrageFind[];
  source?: string;
};
