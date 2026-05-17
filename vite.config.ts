import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Plugin } from "vite";
import react from "@vitejs/plugin-react";

type ListingConditionFilter = "used" | "new" | "both";

type SearchInputOptions = {
  conditionFilter?: ListingConditionFilter;
};

type SearchInput =
  | ({ type: "barcode"; barcode: string } & SearchInputOptions)
  | ({ type: "catalog"; catalogNumber: string } & SearchInputOptions)
  | ({ type: "manual"; query: string } & SearchInputOptions)
  | ({ type: "image"; imageBase64: string; fileName?: string } & SearchInputOptions);

type CandidateListing = {
  id: string;
  title: string;
  price: number;
  shippingPrice: number;
  totalPrice: number;
  currency: string;
  condition: string;
  imageUrl?: string;
  itemUrl?: string;
  source: "ebay";
  matchSignals: { titleSimilarity?: number };
  raw?: unknown;
};

type SearchResult = {
  input: SearchInput;
  listings: CandidateListing[];
  source: string;
  timestamp: string;
  warnings: string[];
  rawSummary?: string;
};

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

type EbaySearchPage = {
  label: string;
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

let cachedApplicationToken: { token: string; expiresAt: number } | null = null;

function ebayLocalApiPlugin(): Plugin {
  return {
    name: "record-scanner-ebay-local-api",
    configureServer(server) {
      server.middlewares.use("/api/ebay/search", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const env = readLocalEnv(process.cwd());
          const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";
          const ebayEnv = env.EBAY_ENV || "production";

          if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
            sendJson(res, 500, { error: "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env.local" });
            return;
          }

          const input = JSON.parse(await readBody(req)) as SearchInput;
          const accessToken = await getApplicationToken({
            clientId: env.EBAY_CLIENT_ID,
            clientSecret: env.EBAY_CLIENT_SECRET,
            ebayEnv,
          });
          const result = await searchEbayBrowse(input, { accessToken, ebayEnv, marketplaceId });
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown eBay API error" });
        }
      });
    },
  };
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
  config: { accessToken: string; ebayEnv: string; marketplaceId: string },
): Promise<SearchResult> {
  if (input.type === "image") {
    throw new Error("Real eBay image search is not wired yet. Use the mock image placeholder for now.");
  }

  const endpointRoot = config.ebayEnv === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const conditionFilter = buildConditionFilter(input.conditionFilter);
  const primaryRequest = buildPrimarySearchRequest(input);
  const pages: EbaySearchPage[] = [];

  const primaryPage = await fetchEbaySearchPage({
    accessToken: config.accessToken,
    conditionFilter,
    endpointRoot,
    marketplaceId: config.marketplaceId,
    request: primaryRequest,
  });
  pages.push(primaryPage);

  const expandedQuery = shouldExpandIdentifierSearch(input) ? deriveExpandedQuery(primaryPage.listings, input) : null;
  if (expandedQuery && expandedQuery !== primaryPage.query.toLowerCase()) {
    pages.push(
      await fetchEbaySearchPage({
        accessToken: config.accessToken,
        conditionFilter,
        endpointRoot,
        marketplaceId: config.marketplaceId,
        request: { label: "expanded artist/title", q: expandedQuery },
      }),
    );
  }

  const listings = dedupeListings(pages.flatMap((page) => page.listings));
  const warnings = pages.flatMap((page) => page.warnings);

  return {
    input,
    listings,
    source: "ebay",
    timestamp: new Date().toISOString(),
    warnings,
    rawSummary: buildRawSummary(pages, listings.length, input.conditionFilter),
  };
}

async function fetchEbaySearchPage(options: {
  accessToken: string;
  conditionFilter: string | null;
  endpointRoot: string;
  marketplaceId: string;
  request: EbaySearchRequest;
}): Promise<EbaySearchPage> {
  const url = new URL("/buy/browse/v1/item_summary/search", options.endpointRoot);
  if (options.request.q) url.searchParams.set("q", options.request.q);
  if (options.request.gtin) url.searchParams.set("gtin", options.request.gtin);
  url.searchParams.set("limit", "200");
  url.searchParams.set("offset", "0");
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

  return {
    label: options.request.label,
    query: options.request.q ?? options.request.gtin ?? "",
    total: typeof payload.total === "number" ? payload.total : null,
    listings: (payload.itemSummaries ?? []).map(mapEbayItemToListing).filter(Boolean) as CandidateListing[],
    warnings: (payload.warnings ?? []).map((warning) => warning.longMessage ?? warning.message ?? "eBay warning"),
  };
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

function buildRawSummary(pages: EbaySearchPage[], returnedCount: number, conditionFilter: ListingConditionFilter = "used"): string {
  const condition = conditionFilter === "both" ? "no condition filter" : `${conditionFilter} condition filter`;
  const parts = pages.map((page) => `${page.label} \"${page.query}\" total=${page.total ?? "unknown"} returned=${page.listings.length}`);
  return `eBay Browse merged ${returnedCount} unique listings using ${condition}. ${parts.join("; ")}.`;
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

function readLocalEnv(cwd: string): Record<string, string> {
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
function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export default defineConfig({
  plugins: [react(), ebayLocalApiPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});

