export function retailerProductIdentity(value: string): { retailerId: string; productId: string; key: string; canonicalUrl: string } | null;
export function isRetailerOfferSource(sourceId: string, retailerId: string): boolean;
export function validateRetailerOfferPage(page: Record<string, any>, now?: Date | string): Record<string, any> | null;
export function verifyRetailerBrowserOffer(find: Record<string, any>, page: Record<string, any>, now?: Date | string): Record<string, any> | null;
export function retailerBrowserOfferIsCurrent(find: Record<string, any>, now?: Date | string): boolean;
