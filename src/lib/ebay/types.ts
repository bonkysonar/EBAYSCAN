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

export type SearchResult = {
  input: SearchInput;
  listings: CandidateListing[];
  source: string;
  timestamp: string;
  warnings: string[];
  rawSummary?: string;
};

export interface MarketplaceClient {
  search(input: SearchInput): Promise<SearchResult>;
}
