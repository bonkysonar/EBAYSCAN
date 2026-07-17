import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  activeSearchKey,
  buildActiveSearchProfile,
  matchActiveListing,
} from "../src/lib/arbitrage/activeEbayMatching.mjs";

const WORKSPACE = process.cwd();
const FINDS_DIR = join(WORKSPACE, "exports", "arbitrage-finds");
const EBAY_VINYL_CATEGORY_ID = "176985";
const EBAY_MARKETPLACE_ID = "EBAY_US";
const SEARCH_PAGE_LIMIT = 100;
const DEFAULT_MAX_SEARCH_PAGES = 2;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_QUERIES = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);

const maxQueries = args.has("max") ? Number(args.get("max")) : DEFAULT_MAX_QUERIES;
const concurrency = args.has("concurrency") ? Math.max(1, Number(args.get("concurrency"))) : DEFAULT_CONCURRENCY;
const maxSearchPages = args.has("pages") ? Math.max(1, Number(args.get("pages"))) : DEFAULT_MAX_SEARCH_PAGES;
const includeCompleted = args.has("all");
const env = readLocalEnv();
let token = "";
let haltedByRateLimit = false;
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) await main();

async function main() {
  const latestPath = args.get("file") ? join(WORKSPACE, args.get("file")) : latestFindsPath();
  token = await getApplicationToken(env);
  const payload = JSON.parse(readFileSync(latestPath, "utf8"));
  const queue = buildQueue(payload.finds).slice(0, maxQueries);
  const startedAt = new Date().toISOString();
  let completed = 0;
  let withLowest = 0;
  let withoutResults = 0;
  let failed = 0;

  console.log(
    JSON.stringify({
      file: latestPath,
      rows: payload.finds.length,
      uniqueQueries: queue.length,
      concurrency,
      maxSearchPages,
      pageLimit: SEARCH_PAGE_LIMIT,
      startedAt,
    }),
  );

  await runPool(queue, concurrency, async (entry) => {
    const result = await enrichActiveEntry(entry);
    if (haltedByRateLimit && result.status !== "failed") return;
    applyResult(payload.finds, entry.key, result);
    completed += 1;
    if (result.status === "available") withLowest += 1;
    if (result.status === "no_results") withoutResults += 1;
    if (result.status === "failed") failed += 1;

    if (completed % 10 === 0 || completed === queue.length) {
      writeFileSync(latestPath, JSON.stringify(payload, null, 2));
      console.log(
        JSON.stringify({
          completed,
          failed,
          remaining: queue.length - completed,
          withLowest,
          withoutResults,
        }),
      );
    }
  });

  writeFileSync(latestPath, JSON.stringify(payload, null, 2));
  console.log(
    JSON.stringify({
      completed,
      failed,
      file: latestPath,
      finishedAt: new Date().toISOString(),
      startedAt,
      withLowest,
      withoutResults,
    }),
  );
}

function latestFindsPath() {
  const latest = readdirSync(FINDS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, mtime: statSync(join(FINDS_DIR, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)[0];
  if (!latest) throw new Error(`No arbitrage JSON files found in ${FINDS_DIR}`);
  return join(FINDS_DIR, latest.name);
}

function readLocalEnv() {
  const envPath = join(WORKSPACE, ".env.local");
  const parsed = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) parsed[match[1].trim()] = match[2].trim();
    }
  }

  return {
    EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID ?? parsed.EBAY_CLIENT_ID,
    EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET ?? parsed.EBAY_CLIENT_SECRET,
    EBAY_ENV: process.env.EBAY_ENV ?? parsed.EBAY_ENV ?? "production",
    EBAY_MARKETPLACE_ID: process.env.EBAY_MARKETPLACE_ID ?? parsed.EBAY_MARKETPLACE_ID ?? EBAY_MARKETPLACE_ID,
  };
}

async function getApplicationToken(env) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET.");
  }

  const endpointRoot = env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const credentials = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
  const response = await fetchWithTimeout(fetch, `${endpointRoot}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  }, DEFAULT_REQUEST_TIMEOUT_MS);

  const payloadText = await response.text();
  const payload = payloadText ? JSON.parse(payloadText) : {};
  if (!response.ok || !payload.access_token) {
    throw new Error(`eBay token request failed (${response.status}): ${payload.error_description ?? response.statusText}`);
  }

  return payload.access_token;
}

function buildQueue(finds) {
  const byKey = new Map();
  for (const find of finds) {
    const profile = buildActiveSearchProfile(find);
    if (!profile) continue;
    const key = profile.key;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        needsRun: false,
        primary: profile.primary,
        profile,
        variants: profile.variants,
      });
    }
    const entry = byKey.get(key);
    if (
      includeCompleted ||
      !["available", "no_results"].includes(find.ebayActiveSearchStatus) ||
      find.ebayActiveSearchComplete !== true
    ) {
      entry.needsRun = true;
    }
  }
  return [...byKey.values()].filter((entry) => entry.needsRun);
}

export async function enrichActiveEntry(entry, options = {}) {
  const listingsById = new Map();
  const errors = [];
  const variantResults = [];
  let rawListingsInspected = 0;
  let searchComplete = true;
  let successfulVariants = 0;

  for (const variant of entry.variants) {
    try {
      const result = options.searchVariant
        ? await options.searchVariant(variant, entry.profile)
        : await searchVariantPages(variant, entry.profile, options.searchOptions);
      successfulVariants += 1;
      rawListingsInspected += result.rawListingsInspected;
      searchComplete = searchComplete && result.searchComplete;
      variantResults.push({
        keyword: variant,
        matchedListings: result.listings.length,
        pagesFetched: result.pagesFetched,
        rawListingsInspected: result.rawListingsInspected,
        searchComplete: result.searchComplete,
      });
      for (const listing of result.listings) {
        const existing = listingsById.get(listing.id);
        if (!existing || listing.totalPrice < existing.totalPrice) listingsById.set(listing.id, listing);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRateLimitError(message)) {
        haltedByRateLimit = true;
        return {
          error: `${message}. Stopped the batch to protect the shared eBay API quota.`,
          rawListingsInspected,
          searchComplete: false,
          searchedVariants: entry.variants,
          status: "failed",
          variantResults,
        };
      }
      errors.push(`${variant}: ${message}`);
      searchComplete = false;
    }
  }

  if (successfulVariants === 0) {
    return {
      error: errors.join("; ") || "Active eBay search failed without a response.",
      rawListingsInspected,
      searchComplete: false,
      searchedVariants: entry.variants,
      status: "failed",
      variantResults,
    };
  }

  const listings = [...listingsById.values()].sort((left, right) => left.totalPrice - right.totalPrice);
  const lowest = listings[0];
  const status = lowest ? "available" : "no_results";
  return {
    activeListingCount: listings.length,
    error: errors.length > 0 ? errors.join("; ") : undefined,
    keyword: entry.primary,
    listings: listings.slice(0, 10),
    lowest,
    matchConfidence: searchComplete ? "high" : "unknown",
    rawListingsInspected,
    searchComplete,
    searchedVariants: entry.variants,
    searchUrl: publicSearchUrl(entry.primary),
    status,
    variantResults,
  };
}

export async function searchVariantPages(keyword, profile, options = {}) {
  const environment = options.env ?? env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenValue = options.token ?? token;
  const pageLimit = Math.max(1, options.pageLimit ?? SEARCH_PAGE_LIMIT);
  const pageCountLimit = Math.max(1, options.maxPages ?? maxSearchPages);
  const requestTimeoutMs = positiveNumber(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const endpointRoot = environment.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const listingsById = new Map();
  let pagesFetched = 0;
  let rawListingsInspected = 0;
  let searchComplete = false;

  for (let page = 0; page < pageCountLimit; page += 1) {
    const offset = page * pageLimit;
    const url = new URL("/buy/browse/v1/item_summary/search", endpointRoot);
    url.searchParams.set("q", keyword);
    url.searchParams.set("category_ids", EBAY_VINYL_CATEGORY_ID);
    url.searchParams.set("filter", "conditions:{NEW}");
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sort", "price");

    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenValue}`,
        "X-EBAY-C-MARKETPLACE-ID": environment.EBAY_MARKETPLACE_ID,
      },
    }, requestTimeoutMs);
    const payloadText = await response.text();
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (!response.ok) {
      const message = payload.errors?.map((error) => error.message).join("; ") || response.statusText;
      throw new Error(`eBay Browse API failed (${response.status}): ${message}`);
    }

    const summaries = payload.itemSummaries ?? [];
    pagesFetched += 1;
    rawListingsInspected += summaries.length;
    for (const item of summaries) {
      const listing = mapItem(item);
      if (!listing || listing.currency !== "USD") continue;
      const match = matchActiveListing(listing.title, profile);
      if (!match.matched) continue;
      const matchedListing = {
        ...listing,
        editionSignals: match.editionSignals,
        matchConfidence: match.confidence,
        matchScore: match.score,
        matchedVariant: keyword,
      };
      const existing = listingsById.get(matchedListing.id);
      if (!existing || matchedListing.totalPrice < existing.totalPrice) listingsById.set(matchedListing.id, matchedListing);
    }

    const total = parseMoney(payload.total);
    const hasMoreByTotal = total !== null && offset + summaries.length < total;
    const hasMore = Boolean(payload.next) || hasMoreByTotal || (total === null && summaries.length === pageLimit);
    if (!hasMore) {
      searchComplete = true;
      break;
    }
  }

  return {
    listings: [...listingsById.values()].sort((left, right) => left.totalPrice - right.totalPrice),
    pagesFetched,
    rawListingsInspected,
    searchComplete,
  };
}

function mapItem(item) {
  const price = parseMoney(item.price?.value);
  if (price === null) return null;
  const shippingPrices = (item.shippingOptions ?? [])
    .map((option) => parseMoney(option.shippingCost?.value))
    .filter((value) => value !== null);
  const shippingPrice = shippingPrices.length > 0 ? Math.min(...shippingPrices) : 0;
  return {
    condition: item.condition ?? "Unknown",
    currency: item.price?.currency ?? item.shippingOptions?.[0]?.shippingCost?.currency ?? "USD",
    id: item.itemId ?? item.itemWebUrl ?? item.title,
    itemUrl: item.itemWebUrl,
    price,
    shippingPrice,
    title: item.title ?? "Untitled eBay listing",
    totalPrice: roundMoney(price + shippingPrice),
  };
}

function applyResult(finds, key, result) {
  const now = new Date().toISOString();
  for (const find of finds) {
    if (activeSearchKey(find) !== key) continue;
    const profile = buildActiveSearchProfile(find);
    if (!profile) continue;

    find.ebayActiveSearchStatus = result.status;
    find.ebayActiveSearchUpdatedAt = now;
    find.ebayActiveSearchKeyword = result.keyword ?? result.searchedVariants?.[0] ?? profile.primary;
    find.ebayActiveSearchUrl = result.searchUrl ?? publicSearchUrl(result.keyword ?? profile.primary);
    find.ebayActiveSearchVariants = result.searchedVariants ?? (result.keyword ? [result.keyword] : undefined);
    find.activeListingCount = result.activeListingCount ?? null;
    find.activeListingCountIsExactMatch = result.searchComplete === true;
    find.activeEvidence = {
      capturedAt: now,
      exactMatchedListingCount: result.activeListingCount ?? null,
      matchConfidence: result.matchConfidence ?? "unknown",
      rawListingsInspected: result.rawListingsInspected ?? 0,
      searchComplete: result.searchComplete === true,
      status: result.status,
    };
    find.ebayActiveEditionIdentity = {
      colors: profile.edition.colors,
      format: profile.edition.format,
      key: profile.edition.key,
      retailerExclusive: profile.edition.retailerExclusive,
      signals: profile.edition.signals,
    };
    find.ebayActiveMatchConfidence = result.matchConfidence ?? "unknown";
    find.ebayActiveRawListingsInspected = result.rawListingsInspected ?? 0;
    find.ebayActiveSearchComplete = result.searchComplete === true;
    find.exactActiveListingCount = result.activeListingCount ?? null;
    find.lowestActivePrice = result.lowest?.totalPrice ?? null;
    find.lowestActiveItemPrice = result.lowest?.price ?? null;
    find.lowestActiveShippingPrice = result.lowest?.shippingPrice ?? null;
    find.lowestActiveTitle = result.lowest?.title;
    find.lowestActiveUrl = result.lowest?.itemUrl;
    find.ebayActiveListings = result.listings ?? [];
    if (result.error) find.ebayActiveSearchError = result.error;
    else delete find.ebayActiveSearchError;
  }
}

async function runPool(items, size, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (nextIndex < items.length && !haltedByRateLimit) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function publicSearchUrl(keyword) {
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.searchParams.set("_nkw", keyword);
  url.searchParams.set("_sacat", EBAY_VINYL_CATEGORY_ID);
  url.searchParams.set("LH_ItemCondition", "1000");
  url.searchParams.set("_sop", "15");
  return url.toString();
}

function parseMoney(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function isRateLimitError(message) {
  return /\b429\b|too many requests|rate limit/i.test(message);
}
