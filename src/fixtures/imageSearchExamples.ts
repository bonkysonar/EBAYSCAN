import type { CandidateListing } from "../lib/ebay/types";

export const imageSearchExamples: CandidateListing[] = [
  {
    id: "img-1",
    title: "Image match possible common LP",
    price: 4,
    shippingPrice: 4,
    totalPrice: 8,
    currency: "USD",
    condition: "Used",
    source: "ebay-mock",
    matchSignals: { imageSimilarity: 0.52, sameAlbumCluster: "weak-image" },
  },
];
