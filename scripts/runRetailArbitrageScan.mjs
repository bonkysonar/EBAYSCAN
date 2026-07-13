import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractVinylPriceDropCards,
  parseOldRedditDealPage,
  parseRedditAtomFeed,
  parseVinylPriceDropDetail,
  splitDealArtistTitle,
} from "./lib/dealSourceAdapters.mjs";
import { discoverSaleLinks, extractPromoCode, hasCouponSignal, httpFailureKind, sourceEntryUrls } from "./lib/retailSaleDiscovery.mjs";

const WORKSPACE = process.cwd();
const OUTPUT_DIR = join(WORKSPACE, "exports", "arbitrage-finds");
const SOLD_INDEX_PATH = join(WORKSPACE, "exports", "sold-history", "sold-comps-index.json");
const SOURCE_FILE = join(WORKSPACE, "src", "lib", "arbitrage", "vinylShopSources.ts");
const LOCAL_ENV_PATH = join(WORKSPACE, ".env.local");
const DEFAULT_TAX_RATE = 0.095;
const EBAY_RESEARCH_NEW_CONDITION_ID = "1000";
const EBAY_RESEARCH_VINYL_CATEGORY_ID = "176985";
const DEFAULT_MAX_PRODUCT_FINDS = 80;
const DEFAULT_MAX_SALE_EVENTS = 40;
const DEFAULT_MAX_DISCOVERED_SALE_PAGES = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_DISCOVERY_DETAIL_LIMIT = 30;
const DEFAULT_DISCOVERY_CONCURRENCY = 5;

loadLocalEnv(LOCAL_ENV_PATH);

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);
const scanMode = args.get("mode") ?? "sale-radar";
const maxProductFinds = parseLimit(args.get("maxProductFinds"), scanMode === "comprehensive" ? Number.POSITIVE_INFINITY : DEFAULT_MAX_PRODUCT_FINDS);
const maxSaleEvents = parseLimit(args.get("maxSaleEvents"), scanMode === "comprehensive" ? 0 : DEFAULT_MAX_SALE_EVENTS);
const maxDiscoveredSalePages = parseLimit(args.get("maxDiscoveredSalePages"), DEFAULT_MAX_DISCOVERED_SALE_PAGES);
const fetchTimeoutMs = parseLimit(args.get("fetchTimeoutMs"), DEFAULT_FETCH_TIMEOUT_MS);
const discoveryDetailLimit = parseLimit(args.get("discoveryDetailLimit"), DEFAULT_DISCOVERY_DETAIL_LIMIT);
const discoveryConcurrency = parseLimit(args.get("discoveryConcurrency"), DEFAULT_DISCOVERY_CONCURRENCY);
const skipActiveEnrichment = args.has("skipActiveEnrichment") || args.get("enrichActive") === "false";
const skipUpload = args.has("skipUpload") || args.get("upload") === "false";
const maxActiveQueries = parseLimit(args.get("maxActiveQueries"), Number.isFinite(maxProductFinds) ? maxProductFinds : DEFAULT_MAX_PRODUCT_FINDS);

const requestedSourceIds = new Set(
  String(args.get("sources") ?? args.get("source") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const sourceCatalog = await readVinylSources(SOURCE_FILE);
const sources = requestedSourceIds.size ? sourceCatalog.filter((source) => requestedSourceIds.has(source.id)) : sourceCatalog;
if (requestedSourceIds.size && sources.length !== requestedSourceIds.size) {
  const matched = new Set(sources.map((source) => source.id));
  const missing = [...requestedSourceIds].filter((id) => !matched.has(id));
  throw new Error(`Unknown source id${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
}
const soldIndex = existsSync(SOLD_INDEX_PATH) ? JSON.parse(readFileSync(SOLD_INDEX_PATH, "utf8")) : null;
const capturedAt = new Date().toISOString();
const previousScanState = loadPreviousScanState(OUTPUT_DIR);
const sourceReports = [];
const allCandidates = [];
const allSaleEvents = [];

for (const source of sources) {
  const startedAt = Date.now();
  const catalogUrl = source.url;
  const preferredUrl = previousScanState.preferredUrls.get(source.id) ?? catalogUrl;
  const scanTarget = preferredUrl === catalogUrl ? source : { ...source, url: preferredUrl };
  try {
    const scanResult = await scanSource(scanTarget);
    const candidates = scanResult.candidates ?? [];
    const saleEvents = scanResult.saleEvents ?? [];
    const pageReports = scanResult.pageReports ?? [];
    const failedPages = pageReports.filter((report) => report.status === "error");
    const successfulPages = pageReports.filter((report) => report.status === "available");
    sourceReports.push({
      candidateCount: candidates.length,
      adapterStats: scanResult.adapterStats,
      catalogUrl,
      elapsedMs: Date.now() - startedAt,
      id: source.id,
      name: source.name,
      pageErrors: failedPages,
      preferredUrl: preferredSourceUrl(scanTarget.url, pageReports),
      resolvedUrls: [...new Set(successfulPages.map((report) => report.resolvedUrl))],
      saleEventCount: saleEvents.length,
      status: failedPages.length ? "partial" : candidates.length ? "candidates" : saleEvents.length ? "sale_signals" : "empty",
      url: preferredUrl,
    });
    allCandidates.push(...candidates);
    allSaleEvents.push(...saleEvents);
    console.log(`${source.name}: ${candidates.length} candidates, ${saleEvents.length} sale signals`);
  } catch (error) {
    sourceReports.push({
      candidateCount: 0,
      catalogUrl,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      id: source.id,
      name: source.name,
      saleEventCount: 0,
      status: "error",
      preferredUrl,
      url: preferredUrl,
    });
    console.log(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const enrichedProducts = allCandidates
  .map((candidate) => enrichCandidate(candidate, soldIndex))
  .filter((find) => find.purchasePrice > 0);
const includedProductFinds =
  scanMode === "comprehensive"
    ? enrichedProducts
    : enrichedProducts.filter(isHighSignalProductFind).slice(0, maxProductFinds);
const saleEventFinds = allSaleEvents.slice(0, maxSaleEvents).map(saleEventToFind).map((find) => addSaleFreshness(find, previousScanState.salesBySource));
const scored = [...saleEventFinds, ...includedProductFinds.map((find) => prepareSaleRadarProductFind(find)).map((find) => addDecisionEvidence(find))]
  .sort((left, right) => {
    const leftPriority = opportunitySortPriority(left);
    const rightPriority = opportunitySortPriority(right);
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    const leftMargin = estimatedMargin(left);
    const rightMargin = estimatedMargin(right);
    return rightMargin - leftMargin || (right.totalSoldCount ?? 0) - (left.totalSoldCount ?? 0);
  });

let payload = {
  createdAt: capturedAt,
  finds: scored,
  runMode: scanMode,
  saleEvents: saleEventFinds,
  source: scanMode === "comprehensive" ? "comprehensive-retail-arbitrage-scan" : "sale-radar-retail-arbitrage-scan",
  sourceReports,
  summary: summarize(scored, sourceReports),
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const outputPath = join(OUTPUT_DIR, `retail-arbitrage-${timestampForFile(capturedAt)}.json`);
writeFileSync(outputPath, JSON.stringify(payload, null, 2));
const activeEnrichment = runActiveEnrichmentIfConfigured(outputPath);
if (activeEnrichment.status === "enriched") {
  payload = JSON.parse(readFileSync(outputPath, "utf8"));
}
payload.summary = {
  ...summarize(payload.finds, sourceReports),
  activeEnrichment,
};
writeFileSync(outputPath, JSON.stringify(payload, null, 2));
const uploadResult = skipUpload ? { reason: "Disabled by --skipUpload or --upload=false.", status: "skipped" } : await uploadPayloadIfConfigured(payload);

const summary = summarize(payload.finds, sourceReports);
console.log(JSON.stringify({ activeEnrichment, outputPath, uploadResult, ...summary }, null, 2));

async function readVinylSources(path) {
  const text = readFileSync(path, "utf8");
  const importedSources = await importVinylShopSources(text);
  if (importedSources.length) return importedSources;

  const catalogSources = readStructuredSourceCatalog(text);
  if (catalogSources.length) return catalogSources;

  const blocks = [...text.matchAll(/\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*sourceType:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*\}/g)];
  return blocks.map((match) => ({
    id: match[1],
    name: match[2],
    priority: 4,
    sourceType: match[3],
    url: match[4],
  }));
}

async function importVinylShopSources(text) {
  try {
    const ts = await import("typescript");
    const output = ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
    const module = await import(moduleUrl);
    return Array.isArray(module.vinylShopSources) ? module.vinylShopSources : [];
  } catch {
    return [];
  }
}

function readStructuredSourceCatalog(text) {
  const sources = [];
  const sourceBlocks = [...text.matchAll(/source\(\{([\s\S]*?)\}\)/g)];
  const seenDomains = new Set();

  for (const match of sourceBlocks) {
    const block = match[1];
    if (readBooleanField(block, "isDiscoveryOnly")) continue;

    const id = readStringField(block, "id");
    const name = readStringField(block, "displayName");
    const domain = readStringField(block, "domain");
    const sourceType = readStringField(block, "crawlType");
    const url = readStringField(block, "baseUrl");
    const priority = readNumberField(block, "priority") ?? 4;
    if (!id || !name || !domain || !sourceType || !url) continue;
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    sources.push({ domain, id, name, priority, sourceType, url });
  }

  return sources.sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
}

function readStringField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*"([^"]+)"`));
  return match?.[1] ?? null;
}

function readNumberField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*([0-9]+)`));
  return match ? Number(match[1]) : null;
}

function readBooleanField(block, fieldName) {
  return new RegExp(`${fieldName}:\\s*true`).test(block);
}

async function scanSource(source) {
  if (source.id === "vinyl-price-drop") {
    return scanVinylPriceDrop(source);
  }

  if (source.sourceType === "shopify-store") {
    return scanShopifySource(source);
  }

  if (source.id.startsWith("reddit-")) {
    return scanReddit(source);
  }

  if (source.id.includes("craigslist")) {
    return scanCraigslist(source);
  }

  const pageScan = await fetchSourcePages(source);
  return {
    candidates: dedupeCandidates(pageScan.pages.flatMap((page) => extractCandidatesFromHtml(source, page.html, page.url))),
    pageReports: pageScan.pageReports,
    saleEvents: dedupeSaleEvents(pageScan.pages.flatMap((page) => detectSaleEvents(source, page.html, page.url))),
  };
}

async function scanShopifySource(source) {
  const pageScan = await fetchSourcePages(source, { allowEmpty: true });
  const origin = pageScan.pages.length ? new URL(pageScan.pages[0].url).origin : new URL(source.url).origin;
  const collectionMatch = new URL(source.url).pathname.match(/\/collections\/([^/?#]+)/);
  const productUrls = collectionMatch
    ? [`${origin}/collections/${collectionMatch[1]}/products.json?limit=250`, `${origin}/products.json?limit=250`]
    : [`${origin}/products.json?limit=250`];

  const byUrl = new Map();

  for (const url of productUrls) {
    try {
      const payload = JSON.parse(await fetchText(url));
      for (const product of payload.products ?? []) {
        if (!isVinylProductCandidate(source, product.title, product.product_type, (product.tags ?? []).join(" "), product.handle)) continue;
        const variants = product.variants ?? [];
        const prices = variants.map((variant) => Number(variant.price)).filter(Number.isFinite);
        const availableVariants = variants.filter((variant) => variant.available !== false);
        const purchasePrice = Math.min(...prices);
        if (!Number.isFinite(purchasePrice)) continue;
        const productUrl = `${origin}/products/${product.handle}`;
        const titleArtist = inferArtist(product.title);
        const artist = titleArtist !== "Unknown Artist" || isStoreVendor(product.vendor) ? titleArtist : cleanText(product.vendor);
        byUrl.set(productUrl, {
          artist,
          condition: "new/sealed",
          id: stableId(source.id, productUrl, product.title),
          purchasePrice,
          quantityAvailable: availableVariants.length || null,
          sourceId: source.id,
          sourceName: source.name,
          sourceListingTitle: cleanText(product.title),
          sourceUrl: productUrl,
          title: inferTitle(product.title),
        });
      }
    } catch {
      // Fall through to the page HTML below.
    }
  }

  if (byUrl.size === 0) {
    if (pageScan.pages.length === 0) throw new Error(sourceFailureMessage(source, pageScan.pageReports));
    return {
      candidates: dedupeCandidates(pageScan.pages.flatMap((page) => extractCandidatesFromHtml(source, page.html, page.url))),
      pageReports: pageScan.pageReports,
      saleEvents: dedupeSaleEvents(pageScan.pages.flatMap((page) => detectSaleEvents(source, page.html, page.url))),
    };
  }

  return {
    candidates: [...byUrl.values()],
    pageReports: pageScan.pageReports,
    saleEvents: dedupeSaleEvents(pageScan.pages.flatMap((page) => detectSaleEvents(source, page.html, page.url))),
  };
}

async function fetchSourcePages(source, options = {}) {
  const pages = [];
  const pageReports = [];
  const attempted = new Set();
  const resolved = new Set();

  for (const url of sourceEntryUrls(source.url)) {
    await addPage(url, url === source.url ? "configured" : "homepage");
  }

  const discoveredUrls = [];
  for (const page of pages) {
    discoveredUrls.push(...discoverSaleLinks(page.html, page.url, maxDiscoveredSalePages));
  }

  for (const url of [...new Set(discoveredUrls)].slice(0, maxDiscoveredSalePages)) {
    await addPage(url, "discovered-sale-link");
  }

  if (pages.length === 0 && !options.allowEmpty) {
    throw new Error(sourceFailureMessage(source, pageReports));
  }

  return { pageReports, pages };

  async function addPage(url, purpose) {
    if (attempted.has(url) || resolved.has(url)) return;
    attempted.add(url);

    try {
      const page = await fetchPage(url);
      pageReports.push({
        purpose,
        requestedUrl: url,
        resolvedUrl: page.url,
        status: "available",
      });
      if (!resolved.has(page.url)) {
        resolved.add(page.url);
        pages.push(page);
      }
    } catch (error) {
      pageReports.push({
        error: error instanceof Error ? error.message : String(error),
        failureKind: error?.failureKind ?? "network_error",
        purpose,
        requestedUrl: url,
        status: "error",
      });
    }
  }
}

function sourceFailureMessage(source, pageReports) {
  const failures = pageReports
    .filter((report) => report.status === "error")
    .map((report) => report.error)
    .slice(0, 3);
  return failures.length ? `All entry pages failed for ${source.name}: ${failures.join("; ")}` : `No usable entry page was found for ${source.name}.`;
}

function dedupeCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
}

function preferredSourceUrl(currentUrl, pageReports) {
  const configuredWasStale = pageReports.some(
    (report) => report.purpose === "configured" && report.status === "error" && report.failureKind === "not_found",
  );
  if (!configuredWasStale) return currentUrl;
  return pageReports.find((report) => report.purpose === "homepage" && report.status === "available")?.resolvedUrl ?? currentUrl;
}

async function scanReddit(source) {
  const subredditMatch = new URL(source.url).pathname.match(/\/r\/([^/]+)/i);
  const subreddit = subredditMatch ? subredditMatch[1] : "VinylDeals";
  const feedUrl = `https://www.reddit.com/r/${subreddit}/new/.rss`;
  const fallbackUrl = `https://old.reddit.com/r/${subreddit}/new/`;
  const pageReports = [];
  let adapter = "reddit-atom";
  let deals = [];

  try {
    const page = await fetchPage(feedUrl);
    pageReports.push(availablePageReport("feed", feedUrl, page.url));
    deals = parseRedditAtomFeed(page.html);
  } catch (error) {
    pageReports.push(failedPageReport("feed", feedUrl, error));
    adapter = "reddit-old-html";
    const page = await fetchPage(fallbackUrl);
    pageReports.push(availablePageReport("fallback", fallbackUrl, page.url));
    deals = parseOldRedditDealPage(page.html, page.url);
  }

  const activeDeals = deals.filter((deal) => !deal.expired);
  const candidates = activeDeals.map((deal) => discoveryDealToCandidate(source, deal)).filter(Boolean);
  const saleEvents = dedupeSaleEvents(
    activeDeals.flatMap((deal) => detectSaleEventsFromText(source, deal.title, deal.directUrl ?? deal.discussionUrl ?? source.url)),
  );

  return {
    adapterStats: {
      adapter,
      activeDealCount: activeDeals.length,
      candidateCount: candidates.length,
      expiredDealCount: deals.length - activeDeals.length,
      feedEntryCount: deals.length,
    },
    candidates: dedupeCandidates(candidates),
    pageReports,
    saleEvents,
  };
}

async function scanVinylPriceDrop(source) {
  const origin = new URL(source.url).origin;
  const dealsUrl = `${origin}/deals`;
  const sitewideUrl = `${origin}/deals/type/sitewide`;
  const pageReports = [];
  const dealsPage = await fetchPage(dealsUrl);
  pageReports.push(availablePageReport("deal-index", dealsUrl, dealsPage.url));

  let sitewidePage = null;
  try {
    sitewidePage = await fetchPage(sitewideUrl);
    pageReports.push(availablePageReport("sitewide-index", sitewideUrl, sitewidePage.url));
  } catch (error) {
    pageReports.push(failedPageReport("sitewide-index", sitewideUrl, error));
  }

  const productCards = extractVinylPriceDropCards(dealsPage.html, dealsPage.url).slice(0, discoveryDetailLimit);
  const sitewideCards = sitewidePage ? extractVinylPriceDropCards(sitewidePage.html, sitewidePage.url) : [];
  const cards = dedupeByKey(
    [
      ...productCards.map((card) => ({ ...card, dealType: "product" })),
      ...sitewideCards.map((card) => ({ ...card, dealType: "sitewide" })),
    ],
    (card) => card.detailUrl,
  );
  let detailErrorCount = 0;
  const details = (
    await mapWithConcurrency(cards, discoveryConcurrency, async (card) => {
      try {
        const page = await fetchPage(card.detailUrl);
        return { ...parseVinylPriceDropDetail(page.html, page.url, card.title), dealType: card.dealType };
      } catch {
        detailErrorCount += 1;
        return null;
      }
    })
  ).filter(Boolean);

  const activeDetails = details.filter((detail) => !detail.expired);
  const expiredDealCount = details.length - activeDetails.length;
  const candidates = activeDetails
    .filter((detail) => detail.dealType === "product" && detail.currentPrice !== null)
    .map((detail) =>
      discoveryDealToCandidate(source, {
        directUrl: detail.directUrl,
        discussionUrl: detail.detailUrl,
        expired: false,
        originalPrice: detail.originalPrice,
        price: detail.currentPrice,
        publishedAt: null,
        sourceDiscountPercent: detail.discountPercent,
        title: detail.title,
      }),
    )
    .filter(Boolean);
  const saleEvents = activeDetails
    .filter((detail) => detail.dealType === "sitewide")
    .map((detail) => vinylPriceDropSaleEvent(source, detail));
  const uniqueCandidates = dedupeCandidates(candidates);

  return {
    adapterStats: {
      adapter: "vinyl-price-drop-detail-pages",
      activeDealCount: activeDetails.length,
      candidateCount: uniqueCandidates.length,
      detailErrorCount,
      detailPageCount: details.length,
      expiredDealCount,
      productCardCount: productCards.length,
      sitewideCardCount: sitewideCards.length,
    },
    candidates: uniqueCandidates,
    pageReports,
    saleEvents: dedupeSaleEvents(saleEvents),
  };
}

function discoveryDealToCandidate(source, deal) {
  const purchasePrice = deal.price ?? parsePrice(deal.title);
  if (!purchasePrice || purchasePrice < 2 || purchasePrice > 250) return null;
  const sourceUrl = deal.directUrl ?? deal.discussionUrl;
  if (!sourceUrl) return null;
  const parsedTitle = splitDealArtistTitle(deal.title);
  if (!parsedTitle.title || parsedTitle.title.length < 3) return null;

  return {
    artist: parsedTitle.artist,
    condition: "new/sealed",
    discoveryUrl: deal.discussionUrl ?? null,
    id: stableId(source.id, sourceUrl, deal.title),
    purchasePrice,
    sourceDiscountPercent: deal.sourceDiscountPercent ?? null,
    sourceId: source.id,
    sourceListingTitle: cleanText(deal.title),
    sourceName: source.name,
    sourceOriginalPrice: deal.originalPrice ?? null,
    sourcePublishedAt: deal.publishedAt ?? null,
    sourceUrl,
    title: parsedTitle.title,
  };
}

function vinylPriceDropSaleEvent(source, detail) {
  const rawSignal = cleanText(detail.title);
  const discountPercent = detail.discountPercent ?? extractMaxDiscountPercent(rawSignal);
  const scope = /\ball\s+(?:vinyl|records|lps|music)\b/i.test(rawSignal) ? "vinyl-wide" : "sitewide";
  const url = detail.directUrl ?? detail.detailUrl ?? source.url;
  const signal = saleSignalSummary(source, rawSignal, discountPercent, scope);
  const fingerprint = saleFingerprint(source, rawSignal, url, discountPercent, scope);
  return {
    capturedAt,
    discountPercent,
    evidence: rawSignal.slice(0, 320),
    fingerprint,
    id: stableId("sale", source.id, fingerprint),
    scope,
    signal,
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: url,
    title: `${discountPercent ? `${discountPercent}%+ sale` : "Broad sale"}: ${source.name}`,
    verification: "discovery-lead",
  };
}

function availablePageReport(purpose, requestedUrl, resolvedUrl) {
  return { purpose, requestedUrl, resolvedUrl, status: "available" };
}

function failedPageReport(purpose, requestedUrl, error) {
  return {
    error: error instanceof Error ? error.message : String(error),
    failureKind: error?.failureKind ?? "network_error",
    purpose,
    requestedUrl,
    status: "error",
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(values.length || 1, Number.isFinite(concurrency) ? Math.floor(concurrency) : DEFAULT_DISCOVERY_CONCURRENCY));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }),
  );
  return results;
}

function dedupeByKey(values, keyFor) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scanCraigslist(source) {
  const html = await fetchText(source.url.replace("#search=2~gallery~0", ""));
  return {
    candidates: extractCandidatesFromHtml(source, html),
    saleEvents: detectSaleEvents(source, html),
  };
}

function extractCandidatesFromHtml(source, html, pageUrl = source.url) {
  const candidates = [];
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi)];
  const seen = new Set();

  for (const match of anchors) {
    const href = absolutize(pageUrl, match[1]);
    const text = cleanText(stripTags(match[2]));
    const nearby = html.slice(Math.max(0, match.index - 800), Math.min(html.length, match.index + 1800));
    if (!isVinylProductCandidate(source, text, href, stripTags(nearby))) continue;

    const price = parsePrice(`${text} ${stripTags(nearby)}`);
    if (!price || price < 2 || price > 250) continue;

    const title = inferTitle(text);
    if (!title || title.length < 3) continue;
    const dedupeKey = `${href}::${title}::${price}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    candidates.push({
      artist: inferArtist(text),
      condition: "new/sealed",
      id: stableId(source.id, href, title),
      purchasePrice: price,
      sourceId: source.id,
      sourceName: source.name,
      sourceListingTitle: text,
      sourceUrl: href,
      title,
    });
  }

  const jsonLdCandidates = extractJsonLdCandidates(source, html, pageUrl);
  for (const candidate of jsonLdCandidates) {
    const dedupeKey = `${candidate.sourceUrl}::${candidate.title}::${candidate.purchasePrice}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      candidates.push(candidate);
    }
  }

  return candidates;
}

function extractJsonLdCandidates(source, html, pageUrl = source.url) {
  const candidates = [];
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of flattenJsonLd(items)) {
        const name = item.name ?? item.title;
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        const price = parsePrice(offer?.price ?? offer?.lowPrice ?? item.price);
        const sourceUrl = absolutize(pageUrl, item.url ?? offer?.url ?? pageUrl);
        if (!name || !price || !isVinylProductCandidate(source, name, item.category, sourceUrl, offer?.description)) continue;
        candidates.push({
          artist: inferArtist(name),
          condition: "new/sealed",
          id: stableId(source.id, sourceUrl, name),
          purchasePrice: price,
          sourceId: source.id,
          sourceName: source.name,
          sourceListingTitle: cleanText(name),
          sourceUrl,
          title: inferTitle(name),
        });
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return candidates;
}

function flattenJsonLd(items) {
  const flattened = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item["@graph"])) flattened.push(...flattenJsonLd(item["@graph"]));
    if (Array.isArray(item.itemListElement)) {
      flattened.push(...flattenJsonLd(item.itemListElement.map((entry) => entry.item ?? entry)));
    }
    flattened.push(item);
  }
  return flattened;
}

function detectSaleEvents(source, html, pageUrl = source.url) {
  if (!html) return [];
  if (source.sourceType === "deal-aggregator" || source.sourceType === "social-feed") {
    return detectDiscoverySaleEvents(source, html, pageUrl);
  }
  const text = cleanText(stripTags(html));
  const snippets = [];
  const signalPattern =
    /.{0,100}\b(?:sitewide|site-wide|storewide|store-wide|entire\s+site|all\s+(?:vinyl|records|lps|music)|vinyl\s+deals?|warehouse\s+(?:sale|overstock)|overstock|clearance|final\s+sale|closeout|special\s+price|daily\s+deal|specials?\s+(?:and|&)\s+sales?|garage\s+sale|buy\s+more\s+save\s+more|vinyl\s+discount|promo\s+code|discount\s+code|use\s+code|under\s+\$?\s*(?:10|15|20)|bogo|buy\s+(?:one|1|2)\s+get\s+(?:one|1)|[3-9][0-9]\s*%\s*off|[3-9][0-9]\s*percent\s*off).{0,160}/gi;
  for (const match of text.matchAll(signalPattern)) {
    snippets.push(match[0]);
    if (snippets.length >= 8) break;
  }

  return dedupeSaleEvents(snippets.flatMap((snippet) => detectSaleEventsFromText(source, snippet, pageUrl)));
}

function detectDiscoverySaleEvents(source, html, pageUrl) {
  const events = [];
  const anchors = [...String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,700}?)<\/a>/gi)];
  for (const match of anchors) {
    const text = cleanText(stripTags(match[2]));
    if (!hasVinylContext(text)) continue;
    events.push(...detectSaleEventsFromText(source, text, absolutize(pageUrl, match[1])));
  }
  return dedupeSaleEvents(events);
}

function detectSaleEventsFromText(source, text, url = source.url) {
  const rawSignal = cleanText(text);
  if (!rawSignal || !isLargeSaleSignal(rawSignal, source, url)) return [];

  const discountPercent = extractMaxDiscountPercent(rawSignal);
  const scope = saleScope(rawSignal, source);
  const titlePrefix = discountPercent ? `${discountPercent}%+ sale` : hasBogoSignal(rawSignal) ? "BOGO sale" : "Broad sale";
  const signal = saleSignalSummary(source, rawSignal, discountPercent, scope);
  const fingerprint = saleFingerprint(source, rawSignal, url, discountPercent, scope);

  return [
    {
      capturedAt,
      discountPercent,
      evidence: rawSignal.slice(0, 320),
      fingerprint,
      id: stableId("sale", source.id, fingerprint),
      scope,
      signal,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: url,
      title: `${titlePrefix}: ${source.name}`,
      verification: source.sourceType === "deal-aggregator" || source.sourceType === "social-feed" ? "discovery-lead" : "retailer-page",
    },
  ];
}

function dedupeSaleEvents(events) {
  const bySource = new Map();
  for (const event of events) {
    const current = bySource.get(event.sourceId);
    if (!current || saleEventPriority(event) > saleEventPriority(current)) {
      bySource.set(event.sourceId, event);
    }
  }
  return [...bySource.values()];
}

function saleEventPriority(event) {
  const scopeScore = event.scope === "sitewide" ? 5 : event.scope === "vinyl-wide" ? 4 : event.scope === "clearance" ? 3 : 2;
  const discountScore = event.discountPercent ?? (hasBogoSignal(event.signal) ? 45 : 0);
  return discountScore * 10 + scopeScore;
}

function isLargeSaleSignal(text, source, evidenceUrl = source.url) {
  if (/\bexpired\b/i.test(text)) return false;
  if (!hasVinylContext(text) && hasNonVinylSaleContext(text)) return false;
  if (!hasVinylContext(text) && !sourceIsVinylFocused({ ...source, url: evidenceUrl })) return false;
  const percent = extractMaxDiscountPercent(text);
  const largeDiscount = percent !== null && percent >= 30;
  const bogo = hasBogoSignal(text);
  const sourceIsKnownSalePage = isBroadSaleSource(source.id, source.name, evidenceUrl);
  const broad = hasBroadSaleScope(text) || sourceIsKnownSalePage;
  const priceThreshold = hasPriceThresholdSignal(text) && hasVinylContext(text);
  const coupon = hasCouponSignal(text) && (hasVinylContext(text) || sourceIsKnownSalePage);
  const salePageSignal = sourceIsKnownSalePage && hasSalePageSignal(text);
  return (largeDiscount || bogo || coupon || priceThreshold || hasVolumeDiscountSignal(text) || salePageSignal) && broad;
}

function hasBogoSignal(text) {
  return /\b(?:bogo|buy\s+one\s+get\s+one|buy\s+1\s+get\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(text);
}

function hasBroadSaleScope(text) {
  return /\b(?:sitewide|site-wide|storewide|store-wide|entire\s+site|everything|all\s+(?:vinyl|records|lps|music)|warehouse\s+(?:sale|overstock)|overstock|clearance|final\s+sale|closeout|super\s+sale|special\s+price|daily\s+deal|specials?\s+(?:and|&)\s+sales?|garage\s+sale|buy\s+more\s+save\s+more|vinyl\s+discount|under\s+\$?\s*(?:10|15|20))\b/i.test(
    text,
  );
}

function saleScope(text, source) {
  if (/\b(?:sitewide|site-wide|storewide|store-wide|entire\s+site|everything)\b/i.test(text)) return "sitewide";
  if (/\ball\s+(?:vinyl|records|lps|music)\b/i.test(text)) return "vinyl-wide";
  if (/\b(?:warehouse\s+(?:sale|overstock)|overstock|clearance|final\s+sale|closeout|super\s+sale|garage\s+sale|special\s+price|under\s+\$?\s*(?:10|15|20))\b/i.test(text))
    return "clearance";
  if (/\b(?:daily\s+deal|specials?\s+(?:and|&)\s+sales?|buy\s+more\s+save\s+more|vinyl\s+discount)\b/i.test(text)) return "deal-source";
  return isFinalDealSource(source.id, source.name, source.url) ? "deal-source" : "unknown";
}

function hasPriceThresholdSignal(text) {
  return /\b(?:under|below|less\s+than)\s+\$?\s*(?:10|15|20)\b/i.test(text);
}

function hasVolumeDiscountSignal(text) {
  return /\b(?:buy\s+more\s+save\s+more|buy\s+(?:one|1|2)\s+get\s+(?:one|1)|bogo|2\s+for\s+1|two\s+for\s+one|spend\s+\$?\d+\s+(?:get|save))\b/i.test(text);
}

function hasSalePageSignal(text) {
  return /\b(?:clearance|closeout|special\s+price|warehouse|overstock|daily\s+deal|specials?\s+(?:and|&)\s+sales?|garage\s+sale|vinyl\s+discount|buy\s+more\s+save\s+more|[3-9][0-9]\s*%\s*off)\b/i.test(text);
}

function hasVinylContext(text) {
  return /\b(?:vinyl|record|records|lp|lps|album)\b/i.test(text);
}

function hasNonVinylSaleContext(text) {
  return /\b(?:baby|smart\s+home|pharmacy|kindle|books?|luxury|devices?|furniture|mattress|laptop|tablet|phone|kitchen|grocery|toys?|beauty|apparel|clothing|shoes?)\b/i.test(
    text,
  );
}

function saleSignalSummary(source, rawSignal, discountPercent, scope) {
  const scopeLabel = scope === "unknown" ? "broad" : scope.replace(/-/g, " ");
  const verb = source.sourceType === "deal-aggregator" || source.sourceType === "social-feed" ? "surfaced" : "has";
  if (discountPercent) return `${source.name} ${verb} a ${scopeLabel} vinyl sale signal at ${discountPercent}%+ off.`;
  if (hasBogoSignal(rawSignal)) return `${source.name} ${verb} a ${scopeLabel} vinyl BOGO or volume-discount sale signal.`;
  if (hasCouponSignal(rawSignal)) return `${source.name} ${verb} a ${scopeLabel} vinyl coupon or promo-code sale signal.`;
  return `${source.name} ${verb} a ${scopeLabel} vinyl sale signal.`;
}

function extractMaxDiscountPercent(text) {
  const values = [
    ...String(text).matchAll(/\b([3-9][0-9])\s*%\s*off\b/gi),
    ...String(text).matchAll(/\b([3-9][0-9])\s*percent\s*off\b/gi),
  ]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function saleEventToFind(event) {
  return {
    activeListingCount: null,
    artist: "Sale alert",
    averageSoldPrice: null,
    averageSoldShipping: null,
    capturedAt: event.capturedAt,
    condition: "new/sealed",
    id: event.id,
    notes: [
      event.signal,
      "Broad sale detected by the daily scan. Review the source before opening any per-record price research.",
      "No eBay API lookup was run for this sale alert.",
    ],
    oneSellerSoldCount: null,
    opportunityType: "sitewide_sale",
    purchasePrice: 0,
    saleDiscountPercent: event.discountPercent,
    saleEvidence: event.evidence,
    saleFingerprint: event.fingerprint,
    saleScope: event.scope,
    saleSignal: event.signal,
    saleVerification: event.verification,
    sourceId: event.sourceId,
    sourceName: event.sourceName,
    sourceListingTitle: event.title,
    sourceUrl: event.sourceUrl,
    status: "WATCH",
    title: event.title,
    totalSoldCount: null,
  };
}

function saleFingerprint(source, rawSignal, url, discountPercent, scope) {
  const promoCode = extractPromoCode(rawSignal) ?? "no-code";
  const offerType = hasBogoSignal(rawSignal) ? "bogo" : hasVolumeDiscountSignal(rawSignal) ? "volume" : hasCouponSignal(rawSignal) ? "coupon" : "sale";
  let path = "/";
  try {
    path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    path = String(url ?? "");
  }
  return stableId("sale-fingerprint", source.id, path, scope, discountPercent ?? "none", offerType, promoCode);
}

function addSaleFreshness(find, previousBySource) {
  const previous = previousBySource.get(find.sourceId);
  const sameCampaign = previous && previous.saleFingerprint === find.saleFingerprint;
  return {
    ...find,
    firstSeenAt: sameCampaign ? previous.firstSeenAt ?? previous.capturedAt : capturedAt,
    saleScanCount: sameCampaign ? (previous.saleScanCount ?? 1) + 1 : 1,
    saleStatus: !previous ? "new" : sameCampaign ? "ongoing" : "changed",
  };
}

function loadPreviousScanState(outputDir) {
  const salesBySource = new Map();
  const preferredUrls = new Map();
  if (!existsSync(outputDir)) return { preferredUrls, salesBySource };

  let latest = null;
  for (const fileName of readdirSync(outputDir)) {
    if (!/^retail-arbitrage-.*\.json$/i.test(fileName)) continue;
    try {
      const payload = JSON.parse(readFileSync(join(outputDir, fileName), "utf8"));
      const createdAtMs = new Date(payload.createdAt ?? 0).getTime();
      if (!Number.isFinite(createdAtMs) || (latest && createdAtMs <= latest.createdAtMs)) continue;
      latest = { createdAtMs, payload };
    } catch {
      // Ignore incomplete or unrelated export files.
    }
  }

  for (const find of latest?.payload?.saleEvents ?? []) {
    if (!find?.sourceId) continue;
    const fingerprint =
      find.saleFingerprint ??
      saleFingerprint(
        { id: find.sourceId },
        find.saleEvidence ?? find.saleSignal ?? "",
        find.sourceUrl,
        find.saleDiscountPercent ?? null,
        find.saleScope ?? "unknown",
      );
    salesBySource.set(find.sourceId, { ...find, saleFingerprint: fingerprint });
  }

  for (const report of latest?.payload?.sourceReports ?? []) {
    if (!report?.id) continue;
    if (report.preferredUrl) {
      preferredUrls.set(report.id, report.preferredUrl);
      continue;
    }
    const configuredWasStale = report.pageErrors?.some(
      (page) => page.purpose === "configured" && page.failureKind === "not_found",
    );
    if (configuredWasStale && report.resolvedUrls?.[0]) preferredUrls.set(report.id, report.resolvedUrls[0]);
  }

  return { preferredUrls, salesBySource };
}

function enrichCandidate(candidate, index) {
  const compMatch = index ? bestCompMatch(candidate, index.comps) : null;
  const notes = [];
  const averageSoldPrice = compMatch?.comp.averageSoldFor ?? null;
  const averageSoldShipping = compMatch?.comp.averageShipping ?? null;
  const totalSoldCount = compMatch?.comp.count ?? null;
  const conditionCounts = compMatch?.comp.conditionCounts;

  if (compMatch) {
    notes.push(
      `Local sold-history match ${(compMatch.matchScore * 100).toFixed(0)}%: ${compMatch.comp.count} sold, avg total $${compMatch.comp.averageTotal.toFixed(2)}, median $${compMatch.comp.medianTotal.toFixed(2)}.`,
    );
    notes.push(
      `Condition evidence: ${conditionCounts.new_sealed} new/sealed, ${conditionCounts.used} used, ${conditionCounts.unknown} unknown; latest sale ${compMatch.comp.latestSaleDate ?? "n/a"}.`,
    );
  } else {
    notes.push("No strong local sold-history match; eBay Product Research needed.");
  }

  if (candidate.sourceOriginalPrice && candidate.sourceOriginalPrice > candidate.purchasePrice) {
    notes.push(
      `Discovery source listed a previous price of $${candidate.sourceOriginalPrice.toFixed(2)}${candidate.sourceDiscountPercent ? ` (${candidate.sourceDiscountPercent}% drop)` : ""}.`,
    );
  }
  if (candidate.discoveryUrl && candidate.discoveryUrl !== candidate.sourceUrl) {
    notes.push(`Discovery evidence: ${candidate.discoveryUrl}`);
  }
  if (candidate.sourcePublishedAt) notes.push(`Discovery source published this deal at ${candidate.sourcePublishedAt}.`);
  notes.push(`Source scan captured this at $${candidate.purchasePrice.toFixed(2)} before tax/shipping adjustments.`);

  return {
    ...candidate,
    activeListingCount: null,
    averageSoldPrice,
    averageSoldShipping,
    capturedAt,
    ebayResearchUrl: ebayResearchUrl(candidate),
    ebayResearchKeywordVariants: researchKeywordVariants(candidate),
    lowestActivePrice: null,
    notes,
    oneSellerSoldCount: compMatch?.comp.count ?? null,
    totalSoldCount,
  };
}

function addDecisionEvidence(find) {
  const status = find.status ?? decisionFor(find);
  const notes = [...(find.notes ?? [])];
  const sale = soldTotal(find);
  const margin = estimatedMargin(find);
  const marginRatio = sale ? margin / sale : null;

  if (status === "REJECT") {
    if (sale === null) {
      notes.push("Rejected for now because no local sold-price evidence matched strongly enough; use the eBay research link for manual validation.");
    } else if (margin < 5) {
      notes.push(`Rejected by current rules: estimated margin is $${margin.toFixed(2)}, below the $5.00 review floor.`);
    } else if ((find.totalSoldCount ?? 0) < 2) {
      notes.push("Rejected by current rules: sold evidence is single-copy or thinner.");
    }
  } else if (status === "REVIEW") {
    notes.push(
      sale === null
        ? "Review: sale-radar source and price are promising, but local sold-history evidence is missing."
        : "Review: local sold history suggests possible margin, but sold volume is below the automatic buy/watch thresholds.",
    );
  } else if (status === "WATCH") {
    notes.push("Watch: local sold history has enough volume and margin, but repeat-seller proof still needs eBay validation.");
  } else {
    notes.push("Buy: current evidence clears the local repeat-sales and margin thresholds.");
  }

  if (marginRatio !== null) {
    notes.push(`Estimated local-comp margin ratio: ${(marginRatio * 100).toFixed(0)}%.`);
  }

  return {
    ...find,
    notes,
    status,
  };
}

function prepareSaleRadarProductFind(find) {
  if (scanMode !== "sale-radar" || soldTotal(find) !== null) return find;

  return {
    ...find,
    notes: [
      ...(find.notes ?? []),
      "Sale-radar kept this low-priced final-deal item for manual review without running an eBay API check.",
    ],
    status: "REVIEW",
  };
}

function bestCompMatch(candidate, comps) {
  const query = normalize(`${candidate.artist} ${candidate.title}`);
  const queryTokens = new Set(query.split(" ").filter(Boolean));
  if (queryTokens.size < 2) return null;

  let best = null;
  for (const comp of comps) {
    const compTokens = new Set(comp.normalizedKey.replace(/::/g, " ").split(/\s+/).filter(Boolean));
    let overlap = 0;
    for (const token of queryTokens) {
      if (compTokens.has(token)) overlap += 1;
    }
    const score = overlap / Math.max(queryTokens.size, compTokens.size);
    const conditionBoost = comp.conditionCounts.new_sealed > 0 ? 0.05 : 0;
    const adjustedScore = score + conditionBoost;
    if (!best || adjustedScore > best.matchScore) {
      best = { comp, matchScore: adjustedScore };
    }
  }

  if (!best || best.matchScore < 0.52) return null;
  return best;
}

async function fetchText(url) {
  const page = await fetchPage(url);
  return page.html;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(Number.isFinite(fetchTimeoutMs) ? fetchTimeoutMs : DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText || "Error"} for ${url}`);
    error.failureKind = httpFailureKind(response.status);
    error.status = response.status;
    error.url = url;
    throw error;
  }

  return {
    html: await response.text(),
    status: response.status,
    url: response.url || url,
  };
}

function summarize(finds, reports) {
  const byDecision = { BUY: 0, REVIEW: 0, REJECT: 0, WATCH: 0 };
  for (const find of finds) {
    byDecision[find.status ?? decisionFor(find)] += 1;
  }

  return {
    byDecision,
    candidateCount: allCandidates.length,
    includedProductFindCount: finds.filter((find) => find.opportunityType !== "sitewide_sale").length,
    findCount: finds.length,
    saleEventCount: allSaleEvents.length,
    scanMode,
    sourceCount: reports.length,
    sourcesWithCandidates: reports.filter((report) => report.candidateCount > 0).length,
    sourcesWithErrors: reports.filter((report) => report.status === "error").length,
    sourcesWithSaleEvents: reports.filter((report) => report.saleEventCount > 0).length,
  };
}

async function uploadPayloadIfConfigured(payload) {
  const uploadUrl = process.env.ARBITRAGE_UPLOAD_URL;
  const uploadToken = process.env.ARBITRAGE_UPLOAD_TOKEN;
  if (!uploadUrl || !uploadToken) return null;

  const response = await fetch(uploadUrl, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${uploadToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Arbitrage upload failed: HTTP ${response.status} ${responseBody}`);
  }

  try {
    return JSON.parse(responseBody);
  } catch {
    return { status: "uploaded", responseBody };
  }
}

function runActiveEnrichmentIfConfigured(outputPath) {
  if (skipActiveEnrichment) {
    return { status: "skipped", reason: "Disabled by --skipActiveEnrichment or --enrichActive=false." };
  }

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return { status: "skipped", reason: "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET." };
  }

  const relativeOutputPath = outputPath.startsWith(WORKSPACE) ? outputPath.slice(WORKSPACE.length + 1) : outputPath;
  const result = spawnSync(
    process.execPath,
    [
      join(WORKSPACE, "scripts", "enrichArbitrageActiveEbay.mjs"),
      `--file=${relativeOutputPath}`,
      `--max=${maxActiveQueries}`,
      "--concurrency=1",
    ],
    {
      cwd: WORKSPACE,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 5,
      windowsHide: true,
    },
  );

  if (result.status === 0) {
    return {
      maxQueries: maxActiveQueries,
      status: "enriched",
      stdout: tailLines(result.stdout, 5),
    };
  }

  return {
    error: tailLines(result.stderr || result.stdout, 8),
    exitCode: result.status,
    maxQueries: maxActiveQueries,
    status: "failed",
  };
}

function tailLines(text, count) {
  return String(text ?? "")
    .trim()
    .split(/\r?\n/)
    .slice(-count)
    .join("\n");
}

function isHighSignalProductFind(find) {
  const fromFinalDealSource = isFinalDealSource(find.sourceId, find.sourceName, find.sourceUrl);
  const productSaleSignal = hasProductSaleSignal(`${find.sourceListingTitle ?? ""} ${find.sourceUrl ?? ""}`);
  if (!fromFinalDealSource && !productSaleSignal) return false;

  const sale = soldTotal(find);
  const margin = estimatedMargin(find);
  if (sale !== null) {
    return (
      margin >= 5 && (find.totalSoldCount ?? 0) >= 2 ||
      margin >= 10 ||
      (sale >= 25 && find.purchasePrice <= 15)
    );
  }

  return find.purchasePrice <= 15 && (fromFinalDealSource || productSaleSignal);
}

function hasProductSaleSignal(text) {
  return /\b(?:final\s+sale|clearance|closeout|super\s+sale|warehouse\s+(?:sale|overstock)|overstock|garage\s+sale|special\s+price|daily\s+deal|deep\s+discount|price\s+drop|vinyl\s+discount|buy\s+more\s+save\s+more|under\s+\$?\s*(?:10|15|20)|bogo|buy\s+(?:one|1|2)\s+get\s+(?:one|1)|[3-9][0-9]\s*%\s*off)\b/i.test(
    text,
  );
}

function isFinalDealSource(sourceId, sourceName, sourceUrl) {
  return /\b(?:final|clearance|closeout|super-sale|super\s+sale|deep-cuts|deep\s+cuts|deep-discount|deep\s+discount|on-sale|on\s+sale|deals?|daily-deal|specials?|special-price|price-drop|price\s+drop|cheap-vinyl|cheap\s+vinyl|slickdeals|discount|warehouse|overstock|garage|volume-sale|buy-more-save-more|under-?1?[0459]9?9?)\b/i.test(
    `${sourceId} ${sourceName} ${sourceUrl}`,
  );
}

function isBroadSaleSource(sourceId, sourceName, sourceUrl) {
  return /\b(?:sitewide|storewide|50-off|30-80|buy-more-save-more|warehouse|overstock|clearance|super-sale|super\s+sale|special-price|garage-sale|garage\s+sale|under-?1?[0459]9?9?|4\+|bogo)\b/i.test(
    `${sourceId} ${sourceName} ${sourceUrl}`,
  );
}

function opportunitySortPriority(find) {
  if (find.opportunityType === "sitewide_sale") return 2;
  if (find.status === "BUY" || find.status === "WATCH") return 1;
  return 0;
}

function decisionFor(find) {
  const margin = estimatedMargin(find);
  const marginRatio = soldTotal(find) ? margin / soldTotal(find) : 0;
  if (margin >= 7 && marginRatio >= 0.25 && (find.oneSellerSoldCount ?? 0) >= 10) return "BUY";
  if (margin >= 7 && marginRatio >= 0.25 && (find.totalSoldCount ?? 0) >= 10) return "WATCH";
  if (margin >= 5 && (find.totalSoldCount ?? 0) >= 2) return "REVIEW";
  return "REJECT";
}

function estimatedMargin(find) {
  const sale = soldTotal(find);
  if (sale === null) return Number.NEGATIVE_INFINITY;
  return sale - find.purchasePrice * (1 + DEFAULT_TAX_RATE);
}

function soldTotal(find) {
  if (find.averageSoldPrice === null || find.averageSoldPrice === undefined) return null;
  return find.averageSoldPrice + (find.averageSoldShipping ?? 0);
}

function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferArtist(text) {
  const original = cleanText(text);
  const walmartBestSeller = original.match(/^best\s+seller\s+(.+?)\s+\(([^)]+)\)\s+was\b/i);
  if (walmartBestSeller) return cleanText(walmartBestSeller[1]);
  const clean = cleanProductTitle(text);
  const colon = clean.match(/^(.{2,80}?):\s+.{2,}$/);
  if (colon) return cleanText(colon[1]);
  const dash = clean.match(/^(.{2,80}?)(?:\s+[-–—]\s+|\s*[-–—]\s+).{2,}$/);
  if (dash) return cleanText(dash[1]);
  return "Unknown Artist";
}

function inferTitle(text) {
  const original = cleanText(text);
  const walmartBestSeller = original.match(/^best\s+seller\s+(.+?)\s+\(([^)]+)\)\s+was\b/i);
  if (walmartBestSeller) return cleanText(walmartBestSeller[1]);
  const clean = cleanProductTitle(text);
  const colon = clean.match(/^.{2,80}?:\s+(.{2,})$/);
  const dash = clean.match(/^.{2,80}?(?:\s+[-–—]\s+|\s*[-–—]\s+)(.{2,})$/);
  const title = colon ? colon[1] : dash ? dash[1] : clean;
  return cleanText(
    title
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*(?:vinyl|lp|record|sale|deal)[^)]*\)/gi, " ")
      .replace(/\$\s*[0-9.,]+/g, " "),
  );
}

function cleanProductTitle(text) {
  return cleanText(
    text
      .replace(/\bbest\s+seller\b/gi, " ")
      .replace(/\b(?:vinyl|lp|record|records|album)\b/gi, " ")
      .replace(/\b(?:sale|deal|clearance|limited|edition|exclusive|colored|colour|color)\b/gi, " "),
  );
}

function isVinylProductCandidate(source, ...parts) {
  const text = cleanText(parts.filter(Boolean).join(" "));
  if (!text) return false;
  if (isNonVinylProduct(text)) return false;
  return hasVinylProductSignal(text) || sourceIsVinylFocused(source);
}

function isNonVinylProduct(text) {
  return /\b(?:cd|compact\s+disc|digital|download|mp3|flac|wav|aac|lossless|hi-?res|streaming|hoodie|shirt|t-shirt|tee\b|sweatshirt|trading\s+card|cassette|dvd|blu-ray|blu\s+ray|book|zine|magazine|poster|slipmat|koozie|pizza\s+cutter|turntable|speaker|stylus|cartridge|tote|hat|socks|pin|patch|sticker|gift\s+card|coupon)\b/i.test(
    String(text ?? ""),
  );
}

function cleanText(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function looksRecordRelated(text) {
  return hasVinylProductSignal(text);
}

function hasVinylProductSignal(text) {
  return /\b(?:vinyl|record|records|lp|2lp|3lp|4lp|(?:7|10|12)\s*(?:inch|in\.|["”']))\b/i.test(String(text ?? ""));
}

function sourceIsVinylFocused(source) {
  return /\b(?:vinyl|records?|lps?|all-vinyl|super-sale-lps|deep-cuts)\b/i.test(`${source.id} ${source.name} ${source.url}`);
}

function normalize(value) {
  return cleanProductTitle(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !["the", "a", "an", "new", "sealed", "brand", "factory", "used"].includes(token))
    .join(" ")
    .trim();
}

function ebayResearchUrl(candidate) {
  const keywords = encodeURIComponent(researchKeywords(candidate));
  return `https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=${keywords}&dayRange=1095&categoryId=${EBAY_RESEARCH_VINYL_CATEGORY_ID}&conditionId=${EBAY_RESEARCH_NEW_CONDITION_ID}&offset=0&limit=50&sorting=-itemssold&tabName=SOLD&tz=America%2FLos_Angeles`;
}

function researchKeywords(candidate) {
  const normalizedArtist = normalizeResearchArtist(candidate.artist);
  const normalizedTitle = normalizeResearchTitle(candidate.title || candidate.sourceListingTitle || "");
  if (!normalizedArtist) return normalizedTitle;
  return cleanResearchText(startsWithSameWords(normalizedTitle, normalizedArtist) ? normalizedTitle : `${normalizedArtist} ${normalizedTitle}`);
}

function researchKeywordVariants(candidate) {
  const primary = researchKeywords(candidate);
  const variants = new Set([primary]);
  const rawTitle = cleanResearchText(String(candidate.title || candidate.sourceListingTitle || "").replace(/[()]/g, " "));

  if (/\bsoundtrack\b|\bmotion\s+picture\b/i.test(rawTitle)) {
    const baseTitle = normalizeResearchTitle(candidate.title || candidate.sourceListingTitle || "");
    const normalizedArtist = normalizeResearchArtist(candidate.artist);
    const prefix = normalizedArtist && !startsWithSameWords(baseTitle, normalizedArtist) ? `${normalizedArtist} ` : "";
    if (baseTitle) {
      variants.add(cleanResearchText(`${prefix}${baseTitle}`));
      variants.add(cleanResearchText(`${prefix}${baseTitle} Soundtrack`));
      variants.add(cleanResearchText(`${prefix}${baseTitle} OST`));
    }
  }

  return [...variants].filter(Boolean);
}

function absolutize(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return base;
  }
}

function stableId(...parts) {
  const input = parts.join("|");
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return `scan-${hash.toString(16)}`;
}

function timestampForFile(iso) {
  return iso.replace(/[:.]/g, "-");
}

function parseLimit(value, fallback) {
  if (value === undefined) return fallback;
  if (String(value).toLowerCase() === "all") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function loadLocalEnv(path) {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function startsWithSameWords(value, prefix) {
  return value.toLowerCase().split(/\s+/).slice(0, 4).join(" ") === prefix.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
}

function normalizeResearchArtist(rawArtist) {
  return cleanResearchText(
    String(rawArtist)
      .replace(/[|:]+/g, " ")
      .replace(/\b(?:def\s+jam|official\s+store|records?|recordings|music|shop|store|sound\s+of\s+vinyl)\b/gi, " ")
      .replace(/\b(?:unknown\s+artist|various\s+artists?)\b/gi, " "),
  );
}

function isStoreVendor(vendor) {
  if (!vendor || vendor === "Default Title") return true;
  return /\b(?:official\s+store|sound\s+of\s+vinyl|def\s+jam|records?|recordings|shop|store)\b/i.test(vendor);
}

function normalizeResearchTitle(rawTitle) {
  const title = String(rawTitle)
    .replace(/[|:]+/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\$\s*[0-9.,]+/g, " ")
    .trim();
  const firstUsefulSegment = title.split(/\s+(?:music\s+(?:on|and|from|by|performance)|was\s*\/\s*ea)\b/i)[0] ?? title;
  return cleanResearchText(
    firstUsefulSegment
      .replace(/\bmusic\s+(?:on|and|from|by|performance)\b.*$/gi, " ")
      .replace(/\bmusic\s*(?:&|and)\s*performance\b.*$/gi, " ")
      .replace(/\bwas\s*\/\s*ea\b.*$/gi, " ")
      .replace(/\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban outfitters|uo)\s+edition\b/gi, " ")
      .replace(/\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban outfitters|uo)\b/gi, " ")
      .replace(/\b(?:colored|colour|color|clear|red|blue|green|yellow|pink|purple|orange|white|black|gold|silver|splatter|swirl|marbled|translucent|transparent)\s+vinyl\b/gi, " ")
      .replace(/\b(?:vinyl|record|records|album|lp|2lp|3lp|4lp|ep|single)\b/gi, " ")
      .replace(/\b(?:180g|180gram|180grams|heavyweight|remaster(?:ed)?|half-speed\s+master)\b/gi, " ")
      .replace(/\b(?:pre[-\s]?order|sale|clearance|new|sealed|brand\s+new)\b/gi, " ")
      .replace(/\bstaff\s+pick\b/gi, " ")
      .replace(/\bat\s+(?:amazon|target|walmart|urban outfitters|barnes\s*&\s*noble|deep discount)\b.*$/gi, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*(?:vinyl|lp|record|edition|exclusive|color|colour|soundtrack|remaster|sale|deal)[^)]*\)/gi, " ")
      .replace(/[()]/g, " "),
  );
}

function cleanResearchText(value) {
  return cleanText(value)
    .replace(/[\u2013\u2014]/g, " ")
    .replace(/[–—]/g, " ")
    .replace(/[^A-Za-z0-9&'./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
