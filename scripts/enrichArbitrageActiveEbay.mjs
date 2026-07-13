import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE = process.cwd();
const FINDS_DIR = join(WORKSPACE, "exports", "arbitrage-finds");
const EBAY_VINYL_CATEGORY_ID = "176985";
const EBAY_MARKETPLACE_ID = "EBAY_US";
const SEARCH_LIMIT = 10;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_QUERIES = 100;
const FORMAT_NOISE_TOKENS = new Set([
  "album",
  "anniversary",
  "black",
  "blue",
  "clear",
  "color",
  "colored",
  "colour",
  "deluxe",
  "edition",
  "exclusive",
  "gold",
  "gram",
  "green",
  "heavyweight",
  "indie",
  "limited",
  "orange",
  "pink",
  "purple",
  "record",
  "records",
  "red",
  "remaster",
  "sealed",
  "silver",
  "splatter",
  "swirl",
  "transparent",
  "vinyl",
  "white",
  "yellow",
]);

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
const includeCompleted = args.has("all");
const latestPath = args.get("file") ? join(WORKSPACE, args.get("file")) : latestFindsPath();

const env = readLocalEnv();
const token = await getApplicationToken(env);
const payload = JSON.parse(readFileSync(latestPath, "utf8"));
const queue = buildQueue(payload.finds).slice(0, maxQueries);
const startedAt = new Date().toISOString();

let completed = 0;
let withLowest = 0;
let withoutResults = 0;
let failed = 0;
let haltedByRateLimit = false;

console.log(
  JSON.stringify({
    file: latestPath,
    rows: payload.finds.length,
    uniqueQueries: queue.length,
    concurrency,
    startedAt,
  }),
);

await runPool(queue, concurrency, async (entry) => {
  const result = await enrichEntry(entry);
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
  const response = await fetch(`${endpointRoot}/identity/v1/oauth2/token`, {
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
  });

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
    if (find.opportunityType === "sitewide_sale" || find.purchasePrice <= 0 || isSkippableActiveFind(find)) continue;
    const variants = activeSearchVariants(find);
    const primary = variants[0];
    if (!primary) continue;
    const key = primary.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, {
        artist: normalizedActiveArtist(find),
        key,
        needsRun: false,
        title: normalizedActiveTitle(find),
        variants,
      });
    }
    const entry = byKey.get(key);
    if (includeCompleted || !["available", "no_results"].includes(find.ebayActiveSearchStatus)) {
      entry.needsRun = true;
    }
  }
  return [...byKey.values()].filter((entry) => entry.needsRun);
}

function activeSearchVariants(find) {
  const artist = normalizedActiveArtist(find);
  const title = normalizedActiveTitle(find);
  const variants = new Set();
  const add = (value) => {
    const cleaned = cleanSearchText(value);
    if (cleaned) variants.add(cleaned);
  };

  if (title) {
    const titleAlreadyHasArtist = artist && startsWithSameWords(title, artist);
    add(titleAlreadyHasArtist || !artist ? title : `${artist} ${title}`);

    if (/\bsoundtrack\b|\bost\b|\bmotion\s+picture\b/i.test(`${find.title ?? ""} ${find.sourceListingTitle ?? ""}`)) {
      const coreTitle = cleanSearchText(title.replace(/\b(?:soundtrack|ost|original motion picture soundtrack|motion picture soundtrack)\b/gi, " "));
      const prefix = artist && !startsWithSameWords(coreTitle, artist) ? `${artist} ` : "";
      add(`${prefix}${coreTitle}`);
      add(`${prefix}${coreTitle} Soundtrack`);
      add(`${prefix}${coreTitle} OST`);
    }
  }

  if (variants.size === 0) {
    const urlKeyword = keywordFromUrl(find.ebayResearchUrl);
    if (urlKeyword) add(urlKeyword);
  }

  return [...variants];
}

function keywordFromUrl(url) {
  if (!url) return "";
  try {
    return cleanSearchText(new URL(url).searchParams.get("keywords") ?? "");
  } catch {
    return "";
  }
}

async function enrichEntry(entry) {
  let lastError = null;
  let lastNoResults = null;

  for (const variant of entry.variants) {
    try {
      const result = await searchLowestNewVinyl(variant, entry);
      if (result.status === "available") return result;
      lastNoResults = result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRateLimitError(message)) {
        haltedByRateLimit = true;
        return {
          error: `${message}. Stopped the batch to protect the shared eBay API quota.`,
          searchedVariants: entry.variants,
          status: "failed",
        };
      }
      lastError = message;
    }
  }

  if (lastNoResults) return { ...lastNoResults, searchedVariants: entry.variants };

  return {
    error: lastError ?? "Active eBay search failed without a response.",
    searchedVariants: entry.variants,
    status: "failed",
  };
}

async function searchLowestNewVinyl(keyword, entry) {
  const endpointRoot = env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const url = new URL("/buy/browse/v1/item_summary/search", endpointRoot);
  url.searchParams.set("q", keyword);
  url.searchParams.set("category_ids", EBAY_VINYL_CATEGORY_ID);
  url.searchParams.set("filter", "conditions:{NEW}");
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  url.searchParams.set("sort", "price");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": env.EBAY_MARKETPLACE_ID,
    },
  });

  const payloadText = await response.text();
  const payload = payloadText ? JSON.parse(payloadText) : {};
  if (!response.ok) {
    const message = payload.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new Error(`eBay Browse API failed (${response.status}): ${message}`);
  }

  const listings = (payload.itemSummaries ?? [])
    .map(mapItem)
    .filter(Boolean)
    .filter((listing) => isUsableActiveVinylListing(listing, entry))
    .sort((left, right) => left.totalPrice - right.totalPrice);
  const lowest = listings[0];
  if (!lowest) {
    return {
      activeListingCount: payload.total ?? 0,
      keyword,
      listings: [],
      searchUrl: publicSearchUrl(keyword),
      status: "no_results",
    };
  }

  return {
    activeListingCount: payload.total ?? listings.length,
    keyword,
    listings: listings.slice(0, 5),
    lowest,
    searchUrl: publicSearchUrl(keyword),
    status: "available",
  };
}

function mapItem(item) {
  const price = parseMoney(item.price?.value);
  if (price === null) return null;
  const shippingPrice = parseMoney(item.shippingOptions?.[0]?.shippingCost?.value) ?? 0;
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

function isUsableActiveVinylListing(listing, entry) {
  if (/\b(?:cd|compact\s+disc|hoodie|shirt|t-shirt|tee\b|sweatshirt|trading\s+card|cassette|dvd|blu-ray|book|poster|slipmat|koozie|pizza\s+cutter|turntable|speaker|stylus|cartridge|tote|hat|socks|pin|patch|sticker|gift\s+card|coupon|bundle|lot of)\b/i.test(
    listing.title,
  )) {
    return false;
  }

  const listingTokens = new Set(searchTokens(listing.title));
  const artistTokens = searchTokens(entry.artist);
  const titleTokens = searchTokens(entry.title).filter((token) => !FORMAT_NOISE_TOKENS.has(token));
  const matchedTitleTokens = titleTokens.filter((token) => listingTokens.has(token)).length;
  const matchedArtistTokens = artistTokens.filter((token) => listingTokens.has(token)).length;

  if (titleTokens.length >= 3 && matchedTitleTokens < 2) return false;
  if (titleTokens.length > 0 && titleTokens.length < 3 && matchedTitleTokens < titleTokens.length) return false;
  if (artistTokens.length > 0 && matchedArtistTokens === 0 && titleTokens.length < 4) return false;
  return true;
}

function applyResult(finds, key, result) {
  const now = new Date().toISOString();
  for (const find of finds) {
    const primary = activeSearchVariants(find)[0]?.toLowerCase();
    if (primary !== key) continue;

    find.ebayActiveSearchStatus = result.status;
    find.ebayActiveSearchUpdatedAt = now;
    find.ebayActiveSearchKeyword = result.keyword ?? result.searchedVariants?.[0] ?? key;
    find.ebayActiveSearchUrl = result.searchUrl ?? publicSearchUrl(result.keyword ?? key);
    find.ebayActiveSearchVariants = result.searchedVariants ?? (result.keyword ? [result.keyword] : undefined);
    find.activeListingCount = result.activeListingCount ?? null;
    find.lowestActivePrice = result.lowest?.totalPrice ?? null;
    find.lowestActiveItemPrice = result.lowest?.price ?? null;
    find.lowestActiveShippingPrice = result.lowest?.shippingPrice ?? null;
    find.lowestActiveTitle = result.lowest?.title;
    find.lowestActiveUrl = result.lowest?.itemUrl;
    find.ebayActiveListings = result.listings ?? [];
    if (result.error) find.ebayActiveSearchError = result.error;
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

function cleanSearchText(value) {
  return String(value)
    .replace(/[\u2013\u2014]/g, " ")
    .replace(/[^A-Za-z0-9&'./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedActiveArtist(find) {
  const sourceArtist = artistFromListingTitle(find.sourceListingTitle);
  return cleanSearchText(
    String(sourceArtist || find.artist || "")
      .replace(/\b(?:unknown\s+artist|various\s+artists?)\b/gi, " ")
      .replace(/\b(?:official\s+store|sound\s+of\s+vinyl|records?|recordings|music|shop|store)\b/gi, " "),
  );
}

function normalizedActiveTitle(find) {
  const sourceTitle = titleFromListingTitle(find.sourceListingTitle);
  const title = sourceTitle || find.title || find.sourceListingTitle || "";
  return cleanSearchText(
    String(title)
      .replace(/\$\s*[0-9.,]+/g, " ")
      .replace(/\bat\s+(?:amazon|target|walmart|urban outfitters|barnes\s*&\s*noble|deep discount)\b.*$/gi, " ")
      .replace(/\b(?:music\s+(?:on|and|from|by|performance)|music\s*(?:&|and)\s*performance|was\s*\/\s*ea)\b.*$/gi, " ")
      .replace(/\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban outfitters|uo)\s+edition\b/gi, " ")
      .replace(/\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban outfitters|uo)\b/gi, " ")
      .replace(/\b(?:colored|colour|color|clear|red|blue|green|yellow|pink|purple|orange|white|black|gold|silver|splatter|swirl|marbled|translucent|transparent)\s+vinyl\b/gi, " ")
      .replace(/\b(?:vinyl|record|records|album|lp|2lp|3lp|4lp|ep|single)\b/gi, " ")
      .replace(/\b(?:180g|180\s*gram|180grams|heavyweight|remaster(?:ed)?|half-speed\s+master)\b/gi, " ")
      .replace(/\b(?:pre[-\s]?order|sale|clearance|new|sealed|brand\s+new|staff\s+pick)\b/gi, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*(?:vinyl|lp|record|edition|exclusive|color|colour|soundtrack|remaster|sale|deal|gram)[^)]*\)/gi, " ")
      .replace(/[()]/g, " "),
  );
}

function isSkippableActiveFind(find) {
  const title = normalizedActiveTitle(find);
  if (!title || title.length < 3) return true;
  return /^(cheap|deals?|home|facebook page|filter amazon|click here|continue shopping|sign up|sign in|order history|premium membership|time|under)$/i.test(title);
}

function artistFromListingTitle(title) {
  const cleaned = cleanSearchText(title || "");
  const match = cleaned.match(/^(.{2,80}?)(?:\s+-\s+|\s*:\s+).{2,}$/);
  return match ? cleanSearchText(match[1]) : "";
}

function titleFromListingTitle(title) {
  const cleaned = cleanSearchText(title || "");
  const match = cleaned.match(/^.{2,80}?(?:\s+-\s+|\s*:\s+)(.{2,})$/);
  return match ? cleanSearchText(match[1]) : "";
}

function startsWithSameWords(value, prefix) {
  return value.toLowerCase().split(/\s+/).slice(0, 4).join(" ") === prefix.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
}

function searchTokens(value) {
  return cleanSearchText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !["the", "and", "for", "with", "from", "new"].includes(token));
}

function parseMoney(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(message) {
  return /\b429\b|too many requests|rate limit/i.test(message);
}
