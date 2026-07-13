export function sourceEntryUrls(sourceUrl: string): string[];
export function discoverSaleLinks(html: string, pageUrl: string, maxLinks?: number): string[];
export function httpFailureKind(status: number): "blocked" | "http_error" | "not_found" | "server_error";
export function hasCouponSignal(text: unknown): boolean;
export function extractPromoCode(text: unknown): string | null;
