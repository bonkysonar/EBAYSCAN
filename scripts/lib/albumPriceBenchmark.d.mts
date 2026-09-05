export type AlbumPriceBenchmark = {
  version: 1; status: "observed"; source: "ebay-product-research";
  scope: "provisional_album_across_pressings"; currency: "USD";
  lowPrice: number; highPrice: number; weightedMeanPrice: number; weightedMedianPrice: number;
  unitsSold1095Days: number; listingCount: number; capturedAt: string; query: string; url: string;
  observedWindow: { startDate: string; endDate: string };
  sampleComplete: boolean; unitCountBasis: "matched_captured_rows";
  priceBasis: "observed_listing_averages"; shippingIncluded: false;
  volumeSupported: boolean; sampleStatus: "volume_supported" | "thin_sample";
};
export function createAlbumPriceBenchmarkIndex(captures?: Record<string, any>, now?: Date | string | number): { match(candidate?: Record<string, any>): AlbumPriceBenchmark | undefined };
export function normalizeAlbumPriceBenchmark(value: unknown, now?: Date | string | number): AlbumPriceBenchmark | undefined;
