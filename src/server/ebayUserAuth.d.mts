export type EbayUserAuthEnv = {
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_ENV?: string;
  EBAY_USER_ACCESS_TOKEN?: string;
  EBAY_USER_REFRESH_TOKEN?: string;
};

export type EbayUserAccessTokenOptions = {
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
};

export function getEbayUserAccessToken(
  env: EbayUserAuthEnv,
  options?: EbayUserAccessTokenOptions,
): Promise<string>;
export function resetEbayUserAccessTokenCache(): void;
export function isLikelyExpiredEbayUserTokenError(error: unknown): boolean;
