export type WalmartAbsolutePriceAssessment = {
  eligible: boolean;
  price: number | null;
  requiresDemandSupport: boolean;
  tier: "unconditional" | "conditional" | "ineligible";
};

export type WalmartCatalogItem = {
  available: boolean | null;
  badges: string[];
  canonicalUrl: string | null;
  currency: string | null;
  currentPrice: number | null;
  fulfillment: string[];
  inventoryQuantity: number | null;
  rating: number | null;
  reviewCount: number | null;
  sellerId: string | null;
  sellerName: string | null;
  sku: string | null;
  soldByWalmart: boolean | null;
  stableId: string;
  stockStatus: "in_stock" | "limited_stock" | "out_of_stock" | "unknown";
  title: string;
  unitPrice: number | null;
  upc: string | null;
  usItemId: string | null;
  wasPrice: number | null;
};

export type WalmartCatalogPagination = {
  currentPage: number;
  hasNextPage: boolean;
  maxPage: number | null;
  nextPage: number | null;
  nextPageUrl: string | null;
  pageSize: number | null;
  totalCount: number | null;
};

export type WalmartCatalogPage = {
  items: WalmartCatalogItem[];
  pagination: WalmartCatalogPagination;
  payloadCount: number;
};

export type WalmartParserInput = {
  html?: string | null;
  pageUrl?: string | null;
  payload?: unknown;
  payloads?: unknown[];
};

export function extractWalmartStructuredPayloads(html: unknown): unknown[];
export function parseWalmartCatalogPage(
  input: string | object | WalmartParserInput | null | undefined,
  fallbackPageUrl?: string | null,
): WalmartCatalogPage;
export function assessWalmartAbsolutePrice(
  price: unknown,
  thresholds?: { conditionalMax?: unknown; unconditionalMax?: unknown },
): WalmartAbsolutePriceAssessment;
