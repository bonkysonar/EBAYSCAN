export type StructuredRetailSourceKind =
  | "application_json"
  | "direct_json"
  | "json_ld"
  | "next_data";

export type StructuredRetailAvailability =
  | "backorder"
  | "in_stock"
  | "limited_stock"
  | "out_of_stock"
  | "preorder"
  | "unknown";

export type StructuredRetailCatalogItem = {
  available: boolean | null;
  availability: StructuredRetailAvailability;
  canonicalUrl: string | null;
  currency: string | null;
  currentPrice: number | null;
  gtin: string | null;
  imageUrl: string | null;
  productId: string | null;
  regularPrice: number | null;
  sku: string | null;
  sourceKinds: StructuredRetailSourceKind[];
  stableId: string;
  tcin: string | null;
  title: string;
  upc: string | null;
};

export type StructuredRetailCatalogResult = {
  items: StructuredRetailCatalogItem[];
  payloadCount: number;
};

export type StructuredRetailCatalogInput = {
  html?: string | null;
  pageUrl?: string | null;
  payload?: unknown;
  payloads?: unknown[];
};

export function extractStructuredRetailPayloads(html: unknown): unknown[];
export function parseStructuredRetailCatalog(
  input:
    | string
    | object
    | unknown[]
    | StructuredRetailCatalogInput
    | null
    | undefined,
  fallbackPageUrl?: string | null,
): StructuredRetailCatalogResult;
