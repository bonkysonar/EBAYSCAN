export type ListingConditionFilter = "used" | "new" | "both";

type SearchInputOptions = {
  conditionFilter?: ListingConditionFilter;
};

export type SearchInput =
  | ({ type: "barcode"; barcode: string } & SearchInputOptions)
  | ({ type: "catalog"; catalogNumber: string } & SearchInputOptions)
  | ({ type: "manual"; query: string } & SearchInputOptions)
  | ({ type: "image"; imageBase64: string; fileName?: string } & SearchInputOptions);

export type MatchSignals = {
  titleSimilarity?: number;
  imageSimilarity?: number;
  barcodeExact?: boolean;
  catalogNumberMatch?: boolean;
  sameAlbumCluster?: string;
};

export type CandidateListing = {
  id: string;
  title: string;
  price: number;
  shippingPrice: number;
  totalPrice: number;
  currency: string;
  condition: string;
  imageUrl?: string;
  itemUrl?: string;
  source: "ebay-mock" | "ebay" | "discogs-mock";
  matchSignals: MatchSignals;
  raw?: unknown;
};

export type MoneyValue = {
  currency: string;
  value: number;
};

export type DiscogsSalesStats = {
  highPrice?: MoneyValue;
  importedAt: string;
  lastSold?: string;
  lowPrice?: MoneyValue;
  medianPrice?: MoneyValue;
  source: "browser_extension" | "manual_import" | "page_fetch";
};

export type DiscogsMarketSnapshot = {
  catno?: string;
  confidence: "high" | "medium" | "low";
  have?: number;
  lowestPrice?: MoneyValue;
  matchedTitle?: string;
  medianPrice?: MoneyValue;
  numForSale?: number;
  releaseId?: number;
  releaseUrl?: string;
  salesStats?: DiscogsSalesStats;
  status: "available" | "unavailable" | "not_configured";
  warnings: string[];
  want?: number;
  year?: number;
};

export type MarketSnapshot = {
  discogs?: DiscogsMarketSnapshot;
  ebayResearchKeywords?: string;
  ebayResearchUrl?: string;
};

export type SearchResult = {
  input: SearchInput;
  listings: CandidateListing[];
  marketSnapshot?: MarketSnapshot;
  source: string;
  timestamp: string;
  warnings: string[];
  rawSummary?: string;
};

export interface MarketplaceClient {
  search(input: SearchInput): Promise<SearchResult>;
}
