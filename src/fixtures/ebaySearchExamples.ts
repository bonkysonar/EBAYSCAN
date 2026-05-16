import type { CandidateListing, SearchInput } from "../lib/ebay/types";

const lowValueListings: CandidateListing[] = [
  "Fleetwood Mac Rumours LP common reissue",
  "Fleetwood Mac Rumours vinyl LP used",
  "Fleetwood Mac Rumours record common pressing",
  "Rumours Fleetwood Mac LP vintage vinyl",
  "Fleetwood Mac Rumours album record"
].map((title, index) => ({
  id: `low-${index + 1}`,
  title,
  price: [2.99, 3.5, 3.99, 4.25, 4.5][index],
  shippingPrice: 0,
  totalPrice: [2.99, 3.5, 3.99, 4.25, 4.5][index],
  currency: "USD",
  condition: "Used",
  source: "ebay-mock",
  itemUrl: "https://example.invalid/low",
  matchSignals: { titleSimilarity: 0.9, sameAlbumCluster: "fleetwood-mac-rumours" },
}));

const highValueListings: CandidateListing[] = [
  "Blue Note mono original jazz LP",
  "Blue Note original pressing vinyl LP",
  "Rare Blue Note mono record original",
  "Blue Note first press jazz vinyl"
].map((title, index) => ({
  id: `high-${index + 1}`,
  title,
  price: [42, 55, 61, 70][index],
  shippingPrice: [5, 5, 6, 6][index],
  totalPrice: [47, 60, 67, 76][index],
  currency: "USD",
  condition: "Used",
  source: "ebay-mock",
  itemUrl: "https://example.invalid/high",
  matchSignals: { titleSimilarity: 0.86, sameAlbumCluster: "blue-note-original" },
}));

const ambiguousListings: CandidateListing[] = [
  {
    id: "amb-1",
    title: "Unknown artist vinyl LP",
    price: 2,
    shippingPrice: 4,
    totalPrice: 6,
    currency: "USD",
    condition: "Used",
    source: "ebay-mock",
    matchSignals: { titleSimilarity: 0.42, sameAlbumCluster: "unknown" },
  },
  {
    id: "amb-2",
    title: "Similar title sealed import LP",
    price: 34,
    shippingPrice: 5,
    totalPrice: 39,
    currency: "USD",
    condition: "Used",
    source: "ebay-mock",
    matchSignals: { titleSimilarity: 0.48, sameAlbumCluster: "similar-import" },
  },
  {
    id: "amb-3",
    title: "Different album same artist record",
    price: 8,
    shippingPrice: 4,
    totalPrice: 12,
    currency: "USD",
    condition: "Used",
    source: "ebay-mock",
    matchSignals: { titleSimilarity: 0.35, sameAlbumCluster: "different" },
  },
];

const catalogNumberListings: CandidateListing[] = [
  {
    id: "cat-1",
    title: "The Cars Heartbeat City LP 60296-1 common club copy",
    price: 4,
    shippingPrice: 0,
    totalPrice: 4,
    currency: "USD",
    condition: "Used",
    source: "ebay-mock",
    itemUrl: "https://example.invalid/catalog",
    matchSignals: { titleSimilarity: 0.78, catalogNumberMatch: true, sameAlbumCluster: "catalog-60296-1" },
  },
  {
    id: "cat-2",
    title: "The Cars Heartbeat City vinyl 60296-1",
    price: 4.5,
    shippingPrice: 0,
    totalPrice: 4.5,
    currency: "USD",
    condition: "Used",
    source: "ebay-mock",
    itemUrl: "https://example.invalid/catalog",
    matchSignals: { titleSimilarity: 0.8, catalogNumberMatch: true, sameAlbumCluster: "catalog-60296-1" },
  },
  {
    id: "cat-3",
    title: "Different artist 60296-1 cassette listing",
    price: 18,
    shippingPrice: 4,
    totalPrice: 22,
    currency: "USD",
    condition: "Used",
    source: "ebay-mock",
    itemUrl: "https://example.invalid/catalog-overlap",
    matchSignals: { titleSimilarity: 0.31, catalogNumberMatch: true, sameAlbumCluster: "catalog-overlap" },
  },
];

const riskLowListings: CandidateListing[] = lowValueListings.slice(0, 4).map((listing, index) => ({
  ...listing,
  id: `risk-${index + 1}`,
  title: `${listing.title} promo white label`,
}));

export function fixtureForInput(input: SearchInput): CandidateListing[] {
  const text =
    input.type === "barcode"
      ? input.barcode
      : input.type === "catalog"
        ? input.catalogNumber
        : input.type === "manual"
          ? input.query
          : input.fileName ?? "image";
  const normalized = text.toLowerCase();

  if (input.type === "catalog" || normalized.includes("60296")) {
    return catalogNumberListings;
  }

  if (normalized.includes("rare") || normalized.includes("blue note") || normalized.includes("original")) {
    return highValueListings;
  }

  if (normalized.includes("mixed") || normalized.includes("ambiguous") || input.type === "image") {
    return ambiguousListings;
  }

  if (normalized.includes("promo") || normalized.includes("white label")) {
    return riskLowListings;
  }

  return lowValueListings;
}

export const ebaySearchExamples = {
  lowValueListings,
  highValueListings,
  ambiguousListings,
  catalogNumberListings,
  riskLowListings,
};
