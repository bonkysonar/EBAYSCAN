export type SaleDiscoverySource = {
  baseUrl?: string;
  salePathHints?: string[];
  saleUrlPatterns?: string[];
  url?: string;
};
export type SourceEntryTarget = {
  purpose: "configured" | "configured-sale-hint" | "homepage";
  url: string;
};
export function sourceEntryUrls(
  sourceOrUrl: SaleDiscoverySource | string,
  options?: { maxHintUrls?: number },
): string[];
export function sourceEntryTargets(
  sourceOrUrl: SaleDiscoverySource | string,
  options?: { maxHintUrls?: number },
): SourceEntryTarget[];
export function isSaleSpecificUrl(value: string, source?: SaleDiscoverySource): boolean;
export function discoverSaleLinks(
  html: string,
  pageUrl: string,
  maxLinks?: number,
  source?: SaleDiscoverySource,
): string[];
export function httpFailureKind(status: number): "blocked" | "http_error" | "not_found" | "server_error";
export function hasCouponSignal(text: unknown): boolean;
export function hasCoherentSaleClaim(
  text: unknown,
  scope?: "any" | "sitewide" | "vinyl-wide",
): boolean;
export function extractPromoCode(text: unknown): string | null;
export function verifiedSalePathOffer(value: unknown): {
  discountPercent: number;
  evidence: string;
  purchaseOfferVerification: "campaign_advertised";
  saleVerification: "discovery-lead";
  scope: "collection";
} | null;
export function hasBogoOfferSignal(text: unknown): boolean;
export function dedupeSaleCampaigns<T extends {
  fingerprint?: string;
  sourceId?: string;
  sourceUrl?: string;
  title?: string;
}>(
  events: T[],
  priorityFor?: (event: T) => number,
  identityFor?: ((event: T) => string) | null,
): T[];
