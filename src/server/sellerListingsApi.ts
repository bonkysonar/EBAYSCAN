import { Buffer } from "node:buffer";
import type { SellerListing, SellerListingsResult } from "../lib/seller/types";

type SellerListingsEnv = {
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_ENV?: string;
  EBAY_MARKETPLACE_ID?: string;
  EBAY_USER_ACCESS_TOKEN?: string;
  EBAY_USER_REFRESH_TOKEN?: string;
};

type PaginationState = {
  pageNumber: number;
  totalPages: number;
};

export type SellerListingsFetchOptions = {
  maxPages?: number;
  pageNumber?: number;
};

type EbayTokenResponse = {
  access_token?: string;
  error_description?: string;
  expires_in?: number;
};

const ENTRIES_PER_PAGE = 200;
const MAX_PAGES = 25;
let cachedSellerAccessToken: { cacheKey: string; token: string; expiresAt: number } | null = null;

export async function fetchSellerActiveListings(
  env: SellerListingsEnv,
  options: SellerListingsFetchOptions = {},
): Promise<SellerListingsResult> {
  const endpoint = env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com/ws/api.dll" : "https://api.ebay.com/ws/api.dll";
  const siteId = marketplaceToSiteId(env.EBAY_MARKETPLACE_ID ?? "EBAY_US");
  const listings: SellerListing[] = [];
  const warnings: string[] = [];
  let pageNumber = normalizePageNumber(options.pageNumber);
  let totalPages = MAX_PAGES;
  let pageCount = 0;
  const maxPages = normalizeMaxPages(options.maxPages);
  let accessToken = await getSellerAccessToken(env);

  while (pageNumber <= totalPages && pageNumber <= MAX_PAGES && pageCount < maxPages) {
    const xml = await fetchSellerPageWithTokenRetry(env, {
      accessToken,
      endpoint,
      pageNumber,
      siteId,
    });
    const parsed = parseSellerListingsXml(xml);
    listings.push(...parsed.listings);
    warnings.push(...parsed.warnings);
    totalPages = parsed.pagination.totalPages;
    pageNumber += 1;
    pageCount += 1;
    accessToken = cachedSellerAccessToken?.token ?? accessToken;
  }

  if (totalPages > MAX_PAGES) {
    warnings.push(`Stopped after ${MAX_PAGES} pages to avoid a runaway seller-listing pull.`);
  }

  const dedupedListings = dedupeSellerListings(listings);
  return {
    hasMore: pageNumber <= totalPages && pageNumber <= MAX_PAGES,
    listings: dedupedListings,
    nextPageNumber: pageNumber <= totalPages && pageNumber <= MAX_PAGES ? pageNumber : undefined,
    pageCount,
    source: "ebay-trading",
    timestamp: new Date().toISOString(),
    total: dedupedListings.length,
    warnings,
  };
}

function normalizePageNumber(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.min(MAX_PAGES, Math.max(1, Math.floor(value)));
}

function normalizeMaxPages(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return MAX_PAGES;
  return Math.min(MAX_PAGES, Math.max(1, Math.floor(value)));
}

async function getSellerAccessToken(env: SellerListingsEnv, options: { forceRefresh?: boolean } = {}): Promise<string> {
  if (env.EBAY_USER_REFRESH_TOKEN) {
    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
      throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET. EBAY_USER_REFRESH_TOKEN requires server-side eBay OAuth credentials.");
    }

    const now = Date.now();
    const cacheKey = `${env.EBAY_ENV ?? "production"}:${env.EBAY_CLIENT_ID}:${env.EBAY_USER_REFRESH_TOKEN}`;
    if (
      !options.forceRefresh &&
      cachedSellerAccessToken &&
      cachedSellerAccessToken.cacheKey === cacheKey &&
      cachedSellerAccessToken.expiresAt > now + 60_000
    ) {
      return cachedSellerAccessToken.token;
    }

    const token = await refreshSellerAccessToken({
      clientId: env.EBAY_CLIENT_ID,
      clientSecret: env.EBAY_CLIENT_SECRET,
      ebayEnv: env.EBAY_ENV ?? "production",
      refreshToken: env.EBAY_USER_REFRESH_TOKEN,
    });
    cachedSellerAccessToken = { ...token, cacheKey };
    return token.token;
  }

  if (env.EBAY_USER_ACCESS_TOKEN) {
    return env.EBAY_USER_ACCESS_TOKEN;
  }

  throw new Error(
    "Missing EBAY_USER_REFRESH_TOKEN or EBAY_USER_ACCESS_TOKEN. Seller listing analysis needs eBay user authorization with seller access.",
  );
}

async function refreshSellerAccessToken(config: {
  clientId: string;
  clientSecret: string;
  ebayEnv: string;
  refreshToken: string;
}): Promise<{ token: string; expiresAt: number }> {
  const endpointRoot = config.ebayEnv === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${endpointRoot}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
    }),
  });
  const payloadText = await response.text();
  const payload = payloadText ? (JSON.parse(payloadText) as EbayTokenResponse) : {};

  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new Error(`eBay user token refresh failed (${response.status}): ${payload.error_description ?? response.statusText}`);
  }

  return {
    token: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

async function fetchSellerPageWithTokenRetry(
  env: SellerListingsEnv,
  options: {
    accessToken: string;
    endpoint: string;
    pageNumber: number;
    siteId: string;
  },
): Promise<string> {
  try {
    return await fetchSellerPage({ ...options, token: options.accessToken });
  } catch (error) {
    if (!env.EBAY_USER_REFRESH_TOKEN || !isLikelyExpiredSellerTokenError(error)) {
      throw error;
    }

    cachedSellerAccessToken = null;
    const refreshedToken = await getSellerAccessToken(env, { forceRefresh: true });
    return fetchSellerPage({ ...options, token: refreshedToken });
  }
}

function isLikelyExpiredSellerTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /access token|iaf token|token.*expired|token.*invalid|invalid.*token/i.test(message);
}

async function fetchSellerPage(options: {
  endpoint: string;
  pageNumber: number;
  siteId: string;
  token: string;
}): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <DetailLevel>ReturnAll</DetailLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${ENTRIES_PER_PAGE}</EntriesPerPage>
      <PageNumber>${options.pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;

  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-IAF-TOKEN": options.token,
      "X-EBAY-API-SITEID": options.siteId,
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`eBay seller listings request failed (${response.status}): ${text || response.statusText}`);
  }

  return text;
}

export function parseSellerListingsXml(xml: string): {
  listings: SellerListing[];
  pagination: PaginationState;
  warnings: string[];
} {
  const ack = textForTag(xml, "Ack");
  const warnings = textsForTag(xml, "LongMessage").concat(textsForTag(xml, "ShortMessage")).filter(Boolean);

  if (ack && !["Success", "Warning"].includes(ack)) {
    throw new Error(`eBay seller listings request failed: ${warnings.join("; ") || ack}`);
  }

  const activeList = firstTagBlock(xml, "ActiveList") ?? "";
  const paginationBlock = firstTagBlock(activeList, "PaginationResult") ?? "";
  const totalPages = parseInteger(textForTag(paginationBlock, "TotalNumberOfPages")) ?? 1;
  const pageNumber = parseInteger(textForTag(paginationBlock, "PageNumber")) ?? 1;
  const itemBlocks = tagBlocks(activeList, "Item");

  return {
    listings: itemBlocks.map(mapSellerItemBlock).filter((listing): listing is SellerListing => Boolean(listing)),
    pagination: { pageNumber, totalPages },
    warnings,
  };
}

function mapSellerItemBlock(block: string): SellerListing | null {
  const id = textForTag(block, "ItemID");
  const title = textForTag(block, "Title");
  const currentPriceBlock = firstTagBlock(firstTagBlock(block, "SellingStatus") ?? "", "CurrentPrice");
  const currentPrice = parseMoney(currentPriceBlock ?? textForTag(block, "CurrentPrice"));

  if (!id || !title || currentPrice === null) return null;

  return {
    availableQuantity: parseInteger(textForTag(block, "QuantityAvailable")),
    condition: textForTag(firstTagBlock(block, "ConditionDisplayName") ? block : "", "ConditionDisplayName") ?? textForTag(block, "ConditionID"),
    currency: currencyForMoneyBlock(currentPriceBlock) ?? "USD",
    currentPrice,
    customLabel: textForTag(firstTagBlock(block, "SellingManagerDetails") ?? "", "CustomLabel"),
    endTime: textForTag(block, "EndTime"),
    id,
    imageUrl: textForTag(block, "GalleryURL") ?? textForTag(block, "PictureURL"),
    itemUrl: textForTag(block, "ViewItemURL") ?? `https://www.ebay.com/itm/${id}`,
    quantitySold: parseInteger(textForTag(block, "QuantitySold")),
    sku: textForTag(block, "SKU"),
    startTime: textForTag(block, "StartTime"),
    title,
  };
}

function dedupeSellerListings(listings: SellerListing[]): SellerListing[] {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    if (seen.has(listing.id)) return false;
    seen.add(listing.id);
    return true;
  });
}

function marketplaceToSiteId(marketplace: string): string {
  if (marketplace === "EBAY_US") return "0";
  return "0";
}

function tagBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? "");
}

function firstTagBlock(xml: string, tag: string): string | null {
  return tagBlocks(xml, tag)[0] ?? null;
}

function textForTag(xml: string, tag: string): string | undefined {
  const block = firstTagBlock(xml, tag);
  if (block === null) return undefined;
  return decodeXml(block.replace(/<[^>]*>/g, "").trim());
}

function textsForTag(xml: string, tag: string): string[] {
  return tagBlocks(xml, tag)
    .map((block) => decodeXml(block.replace(/<[^>]*>/g, "").trim()))
    .filter(Boolean);
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function currencyForMoneyBlock(block: string | null): string | undefined {
  if (!block) return undefined;
  return block.match(/currencyID=["']([^"']+)["']/i)?.[1];
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
