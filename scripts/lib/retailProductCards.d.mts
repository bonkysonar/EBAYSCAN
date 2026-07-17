export type RetailProductCard = {
  available: boolean | null;
  availability: "out_of_stock" | "unknown";
  canonicalUrl: string;
  currency: string | null;
  currentPrice: number;
  imageUrl: string | null;
  productId: string | null;
  regularPrice: number | null;
  sourceKinds: ["html_product_card"];
  stableId: string;
  title: string;
};

export function extractRetailProductCards(
  html: unknown,
  pageUrl: string,
): RetailProductCard[];
