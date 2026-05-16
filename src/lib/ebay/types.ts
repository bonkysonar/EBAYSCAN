export type SearchInput =
  | { type: "barcode"; barcode: string }
  | { type: "catalog"; catalogNumber: string }
  | { type: "manual"; query: string }
  | { type: "image"; imageBase64: string; fileName?: string };

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
