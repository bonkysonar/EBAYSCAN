import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CandidateListing,
  DiscogsMarketSnapshot,
  ListingConditionFilter,
  MarketSearchPageSummary,
  MoneyValue,
  SearchInput,
  SearchResult,
} from "../lib/ebay/types";
import {
  selectUsedDiscogsPriceSuggestion,
  type DiscogsPriceSuggestionsResponse,
} from "../lib/discogs/priceSuggestions";

type EbayItemSummary = {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  shippingOptions?: Array<{ shippingCost?: { value?: string; currency?: string } }>;
  condition?: string;
  image?: { imageUrl?: string };
  itemWebUrl?: string;
};

type EbaySearchResponse = {
  total?: number;
  itemSummaries?: EbayItemSummary[];
  warnings?: Array<{ message?: string; longMessage?: string }>;
  errors?: Array<{ message?: string }>;
};

type EbaySearchRequest = {
  q?: string;
  gtin?: string;
  label: string;
};

type SearchProfile = "scanner" | "seller-pricing";

type EbaySearchPage = {
  label: string;
  pageCount: number;
  query: string;
  total: number | null;
  listings: CandidateListing[];
  warnings: string[];
};

type EbayTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

type DiscogsSearchResult = {
  catno?: string;
  id: number;
  title?: string;
  uri?: string;
  year?: string;
};

type DiscogsSearchResponse = {
  pagination?: { items?: number };
  results?: DiscogsSearchResult[];
};

type DiscogsReleaseResponse = {
  community?: {
    have?: number;
    want?: number;
  };
  id: number;
  lowest_price?: number;
  num_for_sale?: number;
  title?: string;
  uri?: string;
  year?: number;
};

export type MarketplaceApiEnv = {
  DISCOGS_USER_TOKEN?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_ENV?: string;
  EBAY_MARKETPLACE_ID?: string;
};

let cachedApplicationToken: { token: string; expiresAt: number } | null = null;
const EBAY_PAGE_LIMIT = 50;
const EBAY_MAX_RETURNED_LISTINGS_PER_QUERY = 50;
const SELLER_PRICING_PAGE_LIMIT = 50;
const SELLER_PRICING_MAX_RETURNED_LISTINGS = 50;

export async function searchMarketplace(input: SearchInput, env: MarketplaceApiEnv): Promise<SearchResult> {
  const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const ebayEnv = env.EBAY_ENV || "production";

  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in server environment.");
  }

  const accessToken = await getApplicationToken({
    clientId: env.EBAY_CLIENT_ID,
    clientSecret: env.EBAY_CLIENT_SECRET,
    ebayEnv,
  });

  return searchEbayBrowse(input, {
    accessToken,
    discogsToken: env.DISCOGS_USER_TOKEN,
    ebayEnv,
    marketplaceId,
  });
}

async function getApplicationToken(config: { clientId: string; clientSecret: string; ebayEnv: string }): Promise<string> {
  const now = Date.now();
  if (cachedApplicationToken && cachedApplicationToken.expiresAt > now + 60_000) {
    return cachedApplicationToken.token;
  }

  const endpointRoot = config.ebayEnv === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${endpointRoot}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  const payloadText = await response.text();
  const payload = payloadText ? (JSON.parse(payloadText) as Partial<EbayTokenResponse> & { error_description?: string }) : {};

  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new Error(`eBay token request failed (${response.status}): ${payload.error_description ?? response.statusText}`);
  }

  cachedApplicationToken = {
    token: payload.access_token,
    expiresAt: now + payload.expires_in * 1000,
  };

  return payload.access_token;
}

async function searchEbayBrowse(
  input: SearchInput,
  config: { accessToken: string; discogsToken?: string; ebayEnv: string; marketplaceId: string },
): Promise<SearchResult> {
  if (input.type === "image") {
    throw new Error("Real eBay image search is not wired yet. Use the mock image placeholder for now.");
  }

  const endpointRoot = config.ebayEnv === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const conditionFilter = buildConditionFilter(input.conditionFilter);
  const searchProfile = input.searchProfile ?? "scanner";
  const primaryRequest = buildPrimarySearchRequest(input);
  const pages: EbaySearchPage[] = [];

  const primaryPage = await fetchEbaySearchPage({
    accessToken: config.accessToken,
    conditionFilter,
    endpointRoot,
    marketplaceId: config.marketplaceId,
    searchProfile,
    request: primaryRequest,
  });
  pages.push(primaryPage);

  const expandedQuery = searchProfile === "scanner" && shouldExpandIdentifierSearch(input) ? deriveExpandedQuery(primaryPage.listings, input) : null;
  if (expandedQuery && expandedQuery !== primaryPage.query.toLowerCase()) {
    pages.push(
      await fetchEbaySearchPage({
        accessToken: config.accessToken,
        conditionFilter,
        endpointRoot,
        marketplaceId: config.marketplaceId,
        searchProfile,
        request: { label: "expanded artist/title", q: expandedQuery },
      }),
    );
  }

  const discogs = searchProfile === "scanner" ? await searchDiscogsMarket(input, pages, config.discogsToken) : undefined;
  const discogsExpandedQuery = discogs && shouldExpandIdentifierSearch(input) && pages.length === 1 ? buildDiscogsExpandedQuery(discogs) : null;
  if (discogsExpandedQuery && discogsExpandedQuery !== primaryPage.query.toLowerCase()) {
    pages.push(
      await fetchEbaySearchPage({
        accessToken: config.accessToken,
        conditionFilter,
        endpointRoot,
        marketplaceId: config.marketplaceId,
        searchProfile,
        request: { label: "discogs artist/title", q: discogsExpandedQuery },
      }),
    );
  }

  const listings = dedupeListings(pages.flatMap((page) => page.listings));
  const ebayResearchKeywords = buildResearchKeywords(input, pages);
  const warnings = pages.flatMap((page) => page.warnings);

  return {
    input,
    listings,
    marketSnapshot: {
      discogs,
      ebaySearchPages: summarizeEbayPages(pages),
      ebayResearchKeywords,
      ebayResearchUrl: buildEbayResearchUrl(ebayResearchKeywords),
    },
    source: "ebay",
    timestamp: new Date().toISOString(),
    warnings,
    rawSummary: buildRawSummary(pages, listings.length, input.conditionFilter, searchProfile),
  };
}

async function fetchEbaySearchPage(options: {
  accessToken: string;
  conditionFilter: string | null;
  endpointRoot: string;
  marketplaceId: string;
  searchProfile: SearchProfile;
  request: EbaySearchRequest;
}): Promise<EbaySearchPage> {
  const listings: CandidateListing[] = [];
  const warnings: string[] = [];
  let total: number | null = null;
  let pageCount = 0;
  const pageLimit = options.searchProfile === "seller-pricing" ? SELLER_PRICING_PAGE_LIMIT : EBAY_PAGE_LIMIT;
  const maxReturnedListings =
    options.searchProfile === "seller-pricing" ? SELLER_PRICING_MAX_RETURNED_LISTINGS : EBAY_MAX_RETURNED_LISTINGS_PER_QUERY;

  for (let offset = 0; offset < maxReturnedListings; offset += pageLimit) {
    const payload = await fetchEbaySearchPayload(options, offset, pageLimit);
    total = typeof payload.total === "number" ? payload.total : total;
    warnings.push(...(payload.warnings ?? []).map((warning) => warning.longMessage ?? warning.message ?? "eBay warning"));
    listings.push(...((payload.itemSummaries ?? []).map(mapEbayItemToListing).filter(Boolean) as CandidateListing[]));
    pageCount += 1;

    const returnedThisPage = payload.itemSummaries?.length ?? 0;
    const knownTotalReached = typeof total === "number" && listings.length >= total;
    if (returnedThisPage < pageLimit || knownTotalReached) break;
  }

  return {
    label: options.request.label,
    pageCount,
    query: options.request.q ?? options.request.gtin ?? "",
    total,
    listings: dedupeListings(listings),
    warnings,
  };
}

async function fetchEbaySearchPayload(
  options: {
    accessToken: string;
    conditionFilter: string | null;
    endpointRoot: string;
    marketplaceId: string;
    searchProfile: SearchProfile;
    request: EbaySearchRequest;
  },
  offset: number,
  limit: number,
): Promise<EbaySearchResponse> {
  const url = new URL("/buy/browse/v1/item_summary/search", options.endpointRoot);
  if (options.request.q) url.searchParams.set("q", options.request.q);
  if (options.request.gtin) url.searchParams.set("gtin", options.request.gtin);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (options.searchProfile === "seller-pricing") {
    url.searchParams.set("sort", "price");
  }
  if (options.conditionFilter) {
    url.searchParams.set("filter", options.conditionFilter);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": options.marketplaceId,
    },
  });

  const payloadText = await response.text();
  const payload = payloadText ? (JSON.parse(payloadText) as EbaySearchResponse) : {};

  if (!response.ok) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || response.statusText;
    throw new Error(`eBay Browse API failed (${response.status}): ${message}`);
  }

  return payload;
}

function buildPrimarySearchRequest(input: Exclude<SearchInput, { type: "image" }>): EbaySearchRequest {
  if (input.type === "manual") return { label: "manual", q: `${input.query} vinyl record` };
  if (input.type === "catalog") return { label: "catalog number", q: `${input.catalogNumber} vinyl record` };

  const barcode = input.barcode.trim();
  return isLikelyGtin(barcode) ? { label: "barcode GTIN", gtin: barcode } : { label: "barcode text", q: barcode };
}

function isLikelyGtin(value: string): boolean {
  return /^\d{8,14}$/.test(value);
}

function shouldExpandIdentifierSearch(input: SearchInput): input is Extract<SearchInput, { type: "barcode" | "catalog" }> {
  return input.type === "barcode" || input.type === "catalog";
}

function deriveExpandedQuery(listings: CandidateListing[], input: SearchInput): string | null {
  if (listings.length === 0) return null;

  const excluded = tokensFromInput(input);
  const tokenStats = new Map<string, { count: number; firstPosition: number }>();

  for (const listing of listings.slice(0, 25)) {
    tokenizeForExpansion(listing.title).forEach((token, position) => {
      if (excluded.has(token) || isExpansionNoise(token)) return;
      const current = tokenStats.get(token);
      if (current) {
        current.count += 1;
        current.firstPosition = Math.min(current.firstPosition, position);
      } else {
        tokenStats.set(token, { count: 1, firstPosition: position });
      }
    });
  }

  const ranked = [...tokenStats.entries()]
    .filter(([, stats]) => stats.count >= Math.min(2, listings.length))
    .sort((a, b) => b[1].count - a[1].count || a[1].firstPosition - b[1].firstPosition)
    .slice(0, 5)
    .sort((a, b) => a[1].firstPosition - b[1].firstPosition)
    .map(([token]) => token);

  if (ranked.length < 2) return null;
  return `${ranked.join(" ")} vinyl record`;
}

function tokensFromInput(input: SearchInput): Set<string> {
  if (input.type === "barcode") return new Set(tokenizeForExpansion(input.barcode));
  if (input.type === "catalog") return new Set(tokenizeForExpansion(input.catalogNumber));
  if (input.type === "manual") return new Set(tokenizeForExpansion(input.query));
  return new Set();
}

function tokenizeForExpansion(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isExpansionNoise(token: string): boolean {
  const noise = new Set([
    "album",
    "black",
    "club",
    "condition",
    "edition",
    "excellent",
    "gatefold",
    "insert",
    "label",
    "longplay",
    "mint",
    "near",
    "new",
    "original",
    "press",
    "pressing",
    "record",
    "records",
    "reissue",
    "sealed",
    "sleeve",
    "stereo",
    "used",
    "vg",
    "vinyl",
  ]);

  return token.length < 3 || /^\d+$/.test(token) || noise.has(token);
}

function dedupeListings(listings: CandidateListing[]): CandidateListing[] {
  const seen = new Set<string>();
  const deduped: CandidateListing[] = [];

  for (const listing of listings) {
    const key = listing.id || listing.itemUrl || `${listing.title}-${listing.totalPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(listing);
  }

  return deduped;
}

function buildRawSummary(
  pages: EbaySearchPage[],
  returnedCount: number,
  conditionFilter: ListingConditionFilter = "used",
  searchProfile: SearchProfile = "scanner",
): string {
  const condition = conditionFilter === "both" ? "no condition filter" : `${conditionFilter} condition filter`;
  const parts = pages.map(
    (page) =>
      `${page.label} \"${page.query}\" total=${page.total ?? "unknown"} returned=${page.listings.length} pages=${page.pageCount}`,
  );
  const maxReturned =
    searchProfile === "seller-pricing"
      ? `max ${SELLER_PRICING_MAX_RETURNED_LISTINGS} cheapest-price results per seller-pricing query`
      : `max ${EBAY_MAX_RETURNED_LISTINGS_PER_QUERY} fetched listings per query; eBay total count still reported when available`;
  return `eBay Browse merged ${returnedCount} unique listings using ${condition}; ${maxReturned}. ${parts.join("; ")}.`;
}

function summarizeEbayPages(pages: EbaySearchPage[]): MarketSearchPageSummary[] {
  return pages.map((page) => ({
    label: page.label,
    pageCount: page.pageCount,
    query: page.query,
    returnedCount: page.listings.length,
    total: page.total,
  }));
}

function buildResearchKeywords(input: SearchInput, pages: EbaySearchPage[]): string {
  const expanded = pages.find((page) => page.label === "expanded artist/title" || page.label === "discogs artist/title")?.query;
  const primary = pages[0]?.query;
  const fallback =
    input.type === "manual"
      ? input.query
      : input.type === "catalog"
        ? input.catalogNumber
        : input.type === "barcode"
          ? input.barcode
          : "vinyl record";

  return stripVinylSuffix(expanded ?? primary ?? fallback);
}

function buildDiscogsExpandedQuery(discogs: DiscogsMarketSnapshot): string | null {
  if (discogs.status !== "available" || !discogs.matchedTitle) return null;
  return `${discogs.matchedTitle.replace(/\s+-\s+/g, " ")} vinyl record`;
}

function stripVinylSuffix(value: string): string {
  return value.replace(/\s+vinyl\s+record\s*$/i, "").trim();
}

function buildEbayResearchUrl(keywords: string): string {
  const endDate = Date.now();
  const startDate = endDate - 90 * 24 * 60 * 60 * 1000;
  const url = new URL("https://www.ebay.com/sh/research");
  url.searchParams.set("marketplace", "EBAY-US");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("dayRange", "90");
  url.searchParams.set("endDate", String(endDate));
  url.searchParams.set("startDate", String(startDate));
  url.searchParams.set("categoryId", "176985");
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "50");
  url.searchParams.set("tabName", "SOLD");
  url.searchParams.set("tz", "America/Los_Angeles");
  return url.toString();
}

async function searchDiscogsMarket(
  input: SearchInput,
  ebayPages: EbaySearchPage[],
  discogsToken: string | undefined,
): Promise<DiscogsMarketSnapshot> {
  if (!discogsToken) {
    return {
      confidence: "low",
      status: "not_configured",
      warnings: ["Discogs token is not configured."],
    };
  }

  if (input.type === "image") {
    return {
      confidence: "low",
      status: "unavailable",
      warnings: ["Discogs lookup is not available for image input yet."],
    };
  }

  try {
    const primary = await fetchDiscogsSearch(buildDiscogsSearchParams(input), discogsToken);
    const fallbackQuery = ebayPages.find((page) => page.label === "expanded artist/title")?.query;
    const fallback =
      (primary.results ?? []).length === 0 && fallbackQuery
        ? await fetchDiscogsSearch({ q: fallbackQuery, type: "release", format: "vinyl" }, discogsToken)
        : null;
    const results = [...(primary.results ?? []), ...(fallback?.results ?? [])];
    const candidates = rankDiscogsResults(results, input);

    if (candidates.length === 0) {
      return {
        confidence: "low",
        status: "unavailable",
        warnings: ["Discogs returned no likely release match."],
      };
    }

    let best: DiscogsSearchResult | null = null;
    let release: DiscogsReleaseResponse | null = null;
    let priceSuggestion: ReturnType<typeof selectUsedDiscogsPriceSuggestion>;
    let priceSuggestionWarning = "";
    const skipped: number[] = [];

    for (const candidate of candidates) {
      const [releaseResult, suggestionsResult] = await Promise.allSettled([
        fetchDiscogsRelease(candidate.id, discogsToken),
        fetchDiscogsPriceSuggestions(candidate.id, discogsToken),
      ]);

      if (releaseResult.status === "rejected") {
        skipped.push(candidate.id);
        continue;
      }

      release = releaseResult.value;
      best = candidate;

      if (suggestionsResult.status === "fulfilled") {
        priceSuggestion = selectUsedDiscogsPriceSuggestion(suggestionsResult.value);
        if (!priceSuggestion) {
          priceSuggestionWarning = "Discogs did not return a usable used-condition price guide for this release.";
        }
      } else {
        priceSuggestionWarning = "Discogs price guide was unavailable; current marketplace data is still shown.";
      }
      break;
    }

    if (!best || !release) {
      return {
        confidence: "low",
        status: "unavailable",
        warnings: ["Discogs search results could not be fetched as active releases."],
      };
    }

    const lowest = release.lowest_price;
    const currency = priceSuggestion?.currency ?? "USD";

    return {
      catno: best.catno,
      confidence: discogsConfidence(best, input),
      have: release.community?.have,
      lowestPrice: typeof lowest === "number" ? { currency, value: roundMoney(lowest) } : undefined,
      matchedTitle: best.title ?? release.title,
      medianPrice: undefined,
      numForSale: release.num_for_sale,
      releaseId: release.id,
      releaseUrl: release.uri ?? best.uri,
      suggestedPrice: priceSuggestion
        ? { currency: priceSuggestion.currency, value: priceSuggestion.value }
        : undefined,
      suggestedPriceCondition: priceSuggestion?.condition,
      status: "available",
      warnings: [
        [
          priceSuggestionWarning,
          skipped.length ? `Skipped unavailable Discogs release IDs: ${skipped.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      ].filter(Boolean),
      want: release.community?.want,
      year: release.year ?? parseOptionalYear(best.year),
    };
  } catch (error) {
    return {
      confidence: "low",
      status: "unavailable",
      warnings: [error instanceof Error ? `Discogs lookup failed: ${error.message}` : "Discogs lookup failed."],
    };
  }
}

function buildDiscogsSearchParams(input: Exclude<SearchInput, { type: "image" }>): Record<string, string> {
  if (input.type === "catalog") {
    return { catno: input.catalogNumber, type: "release", format: "vinyl" };
  }

  if (input.type === "barcode") {
    const value = input.barcode.trim();
    return /^\d+$/.test(value) ? { barcode: value, type: "release", format: "vinyl" } : { q: value, type: "release", format: "vinyl" };
  }

  return { q: input.query, type: "release", format: "vinyl" };
}

async function fetchDiscogsSearch(params: Record<string, string>, token: string): Promise<DiscogsSearchResponse> {
  const url = new URL("https://api.discogs.com/database/search");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("per_page", "10");
  url.searchParams.set("page", "1");
  return fetchDiscogsJson<DiscogsSearchResponse>(url, token);
}

async function fetchDiscogsRelease(releaseId: number, token: string): Promise<DiscogsReleaseResponse> {
  return fetchDiscogsJson<DiscogsReleaseResponse>(new URL(`https://api.discogs.com/releases/${releaseId}`), token);
}

async function fetchDiscogsPriceSuggestions(releaseId: number, token: string): Promise<DiscogsPriceSuggestionsResponse> {
  return fetchDiscogsJson<DiscogsPriceSuggestionsResponse>(
    new URL(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`),
    token,
  );
}

async function fetchDiscogsJson<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Discogs token=${token}`,
      "User-Agent": "RecordScanner/1.0 +https://ebayscan.vercel.app",
    },
  });
  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Discogs API failed (${response.status}): ${payloadText || response.statusText}`);
  }
  return JSON.parse(payloadText) as T;
}

function rankDiscogsResults(results: DiscogsSearchResult[], input: SearchInput): DiscogsSearchResult[] {
  if (results.length === 0) return [];

  if (input.type === "catalog") {
    return [...results].sort((a, b) => scoreDiscogsCatalogResult(b, input.catalogNumber) - scoreDiscogsCatalogResult(a, input.catalogNumber));
  }

  return results;
}

function scoreDiscogsCatalogResult(result: DiscogsSearchResult, catalogNumber: string): number {
  const inputLoose = normalizeLoose(catalogNumber);
  const resultLoose = normalizeLoose(result.catno ?? "");
  const inputTokens = catalogTokens(catalogNumber);
  const resultTokens = catalogTokens(result.catno ?? "");
  let score = 0;

  if (resultLoose === inputLoose) {
    score += 100;
  } else if (resultLoose.includes(inputLoose) || inputLoose.includes(resultLoose)) {
    score += 70;
  }

  const matchedTokens = inputTokens.filter((token) => resultTokens.includes(token)).length;
  score += matchedTokens * 12;

  if (inputTokens.length > 0 && matchedTokens === inputTokens.length) {
    score += 25;
  }

  const inputHasStandaloneOne = inputTokens.includes("1");
  const resultHasStandaloneOne = resultTokens.includes("1");
  if (inputHasStandaloneOne && resultHasStandaloneOne) {
    score += 20;
  } else if (inputHasStandaloneOne && !resultHasStandaloneOne) {
    score -= 15;
  }

  const year = parseOptionalYear(result.year);
  if (year) {
    score += Math.max(0, 12 - Math.abs(year - 1982));
    if (year > 2000) score -= 20;
  }

  return score;
}

function catalogTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function discogsConfidence(result: DiscogsSearchResult, input: SearchInput): "high" | "medium" | "low" {
  if (input.type === "catalog") {
    return scoreDiscogsCatalogResult(result, input.catalogNumber) >= 120 ? "high" : "medium";
  }

  if (input.type === "barcode") {
    return "medium";
  }

  return result.title ? "medium" : "low";
}

function normalizeLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseOptionalYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function buildConditionFilter(conditionFilter: ListingConditionFilter = "used"): string | null {
  if (conditionFilter === "new") return "conditions:{NEW}";
  if (conditionFilter === "both") return null;
  return "conditions:{USED}";
}

function mapEbayItemToListing(item: EbayItemSummary): CandidateListing | null {
  const price = parseMoney(item.price?.value);
  if (price === null) return null;

  const shippingPrice = parseMoney(item.shippingOptions?.[0]?.shippingCost?.value) ?? 0;
  const totalPrice = roundMoney(price + shippingPrice);

  return {
    id: item.itemId ?? item.itemWebUrl ?? item.title ?? crypto.randomUUID(),
    title: item.title ?? "Untitled eBay listing",
    price,
    shippingPrice,
    totalPrice,
    currency: item.price?.currency ?? item.shippingOptions?.[0]?.shippingCost?.currency ?? "USD",
    condition: item.condition ?? "Unknown",
    imageUrl: item.image?.imageUrl,
    itemUrl: item.itemWebUrl,
    source: "ebay",
    matchSignals: { titleSimilarity: 0.5 },
    raw: item,
  };
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function readLocalEnv(cwd: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const fileName of [".env", ".env.local"]) {
    const path = join(cwd, fileName);
    if (!existsSync(path)) continue;

    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      env[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return env;
}
