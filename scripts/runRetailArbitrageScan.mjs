import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  extractAmazonAsin,
  extractVinylPriceDropCards,
  parseOldRedditDealPage,
  parseRedditAtomFeed,
  parseVinylPriceDropDetail,
  splitDealArtistTitle,
} from "./lib/dealSourceAdapters.mjs";
import {
  assessRecordCandidate,
  candidateQualityScore,
  isHighSignalProductFind,
  rankAndSelectCandidates,
} from "./lib/candidatePipeline.mjs";
import { createPoliteFetcher } from "./lib/politeHttp.mjs";
import {
  fieldstackResultsUrl,
  parseFieldstackResultTotal,
  parseFieldstackResultsPayload,
  parseFieldstackSearchConfig,
} from "./lib/fieldstackCatalog.mjs";
import { buildLocalSoldEvidence } from "./lib/localSoldEvidence.mjs";
import { normalizeSoldText } from "./lib/soldHistoryAggregation.mjs";
import {
  dedupeSaleCampaigns,
  discoverSaleLinks,
  extractPromoCode,
  hasBogoOfferSignal,
  hasCouponSignal,
  httpFailureKind,
  isSaleSpecificUrl,
  sourceEntryTargets,
} from "./lib/retailSaleDiscovery.mjs";
import { reconcileSaleCampaigns, saleCampaignLedgerFromPayload } from "./lib/saleCampaignLifecycle.mjs";
import {
  decodeHtmlEntities,
  inferRetailArtist,
  inferRetailTitle,
  parseRetailProductPrices,
} from "./lib/retailListingParsing.mjs";
import { discoverRetailCatalogLinks } from "./lib/retailCatalogDiscovery.mjs";
import { discoverRetailPaginationLinks } from "./lib/retailPagination.mjs";
import { extractRetailProductCards } from "./lib/retailProductCards.mjs";
import {
  extractShopifyCurrency,
  normalizeShopifyProducts,
  selectShopifyCollectionLanes,
  shopifyCatalogUrls,
} from "./lib/shopifyCatalog.mjs";
import { parseStructuredRetailCatalog } from "./lib/structuredRetailCatalog.mjs";
import {
  assessWalmartAbsolutePrice,
  parseWalmartCatalogPage,
} from "./lib/walmartCatalog.mjs";
import { evaluateOpportunity } from "../src/lib/arbitrage/evaluateOpportunity.mjs";

const WORKSPACE = process.cwd();
const DEFAULT_OUTPUT_DIR = join(WORKSPACE, "exports", "arbitrage-finds");
const SOLD_INDEX_PATH = join(WORKSPACE, "exports", "sold-history", "sold-comps-index.json");
const SOURCE_FILE = join(WORKSPACE, "src", "lib", "arbitrage", "vinylShopSources.ts");
const LOCAL_ENV_PATH = join(WORKSPACE, ".env.local");
const DEFAULT_TAX_RATE = 0.095;
const EBAY_RESEARCH_NEW_CONDITION_ID = "1000";
const EBAY_RESEARCH_VINYL_CATEGORY_ID = "176985";
const DEFAULT_MAX_PRODUCT_FINDS = 80;
const DEFAULT_MAX_SALE_EVENTS = 40;
const DEFAULT_MAX_DISCOVERED_CATALOG_PAGES = 2;
const DEFAULT_MAX_DISCOVERED_SALE_PAGES = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_DISCOVERY_DETAIL_LIMIT = 30;
const DEFAULT_DISCOVERY_CONCURRENCY = 5;
const DEFAULT_SOURCE_CONCURRENCY = 6;
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_HOST_DELAY_MS = 200;
const DEFAULT_GENERIC_MAX_PAGES = 5;
const DEFAULT_MAX_RESEARCH_POOL_SIZE = 240;
const DEFAULT_RESEARCH_POOL_MULTIPLIER = 3;
const DEFAULT_SHOPIFY_COLLECTION_LANES = 2;
const DEFAULT_SHOPIFY_MAX_PAGES = 10;
const DEFAULT_SHOPIFY_ROOT_MAX_PAGES = 2;
const DEFAULT_WALMART_MAX_PAGES = 10;
const DEFAULT_WALMART_AVAILABILITY_DETAIL_LIMIT = 40;
const DEFAULT_ACTIVE_ENRICHMENT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SOLD_HISTORY_SYNC_TIMEOUT_MS = 30 * 60 * 1000;

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
const OUTPUT_DIR = args.get("outputDir") ? resolve(WORKSPACE, args.get("outputDir")) : DEFAULT_OUTPUT_DIR;
const maxProductFinds = parseLimit(args.get("maxProductFinds"), scanMode === "comprehensive" ? Number.POSITIVE_INFINITY : DEFAULT_MAX_PRODUCT_FINDS);
const maxSaleEvents = parseLimit(args.get("maxSaleEvents"), scanMode === "comprehensive" ? 0 : DEFAULT_MAX_SALE_EVENTS);
const maxDiscoveredCatalogPages = parseLimit(
  args.get("maxDiscoveredCatalogPages"),
  DEFAULT_MAX_DISCOVERED_CATALOG_PAGES,
);
const maxDiscoveredSalePages = parseLimit(args.get("maxDiscoveredSalePages"), DEFAULT_MAX_DISCOVERED_SALE_PAGES);
const fetchTimeoutMs = parseLimit(args.get("fetchTimeoutMs"), DEFAULT_FETCH_TIMEOUT_MS);
const discoveryDetailLimit = parseLimit(args.get("discoveryDetailLimit"), DEFAULT_DISCOVERY_DETAIL_LIMIT);
const discoveryConcurrency = parseLimit(args.get("discoveryConcurrency"), DEFAULT_DISCOVERY_CONCURRENCY);
const sourceConcurrency = parseLimit(args.get("sourceConcurrency"), DEFAULT_SOURCE_CONCURRENCY);
const fetchRetries = parseLimit(args.get("fetchRetries"), DEFAULT_FETCH_RETRIES);
const hostDelayMs = parseLimit(args.get("hostDelayMs"), DEFAULT_HOST_DELAY_MS);
const genericMaxPages = parseLimit(args.get("genericMaxPages"), DEFAULT_GENERIC_MAX_PAGES);
const shopifyCollectionLanes = parseLimit(
  args.get("shopifyCollectionLanes"),
  DEFAULT_SHOPIFY_COLLECTION_LANES,
);
const shopifyMaxPages = parseLimit(args.get("shopifyMaxPages"), DEFAULT_SHOPIFY_MAX_PAGES);
const shopifyRootMaxPages = parseLimit(args.get("shopifyRootMaxPages"), DEFAULT_SHOPIFY_ROOT_MAX_PAGES);
const includeShopifyRootCatalog = args.get("shopifyRootCatalog") === "true";
const walmartMaxPages = parseLimit(args.get("walmartMaxPages"), DEFAULT_WALMART_MAX_PAGES);
const walmartAvailabilityDetailLimit = parseLimit(
  args.get("walmartAvailabilityDetailLimit"),
  DEFAULT_WALMART_AVAILABILITY_DETAIL_LIMIT,
);
const researchPoolMultiplier = parsePositiveNumber(
  args.get("researchPoolMultiplier"),
  DEFAULT_RESEARCH_POOL_MULTIPLIER,
);
const maxResearchPoolSize = parseLimit(
  args.get("maxResearchPoolSize"),
  DEFAULT_MAX_RESEARCH_POOL_SIZE,
);
const researchPoolProductLimit =
  scanMode === "comprehensive" || !Number.isFinite(maxProductFinds)
    ? Number.POSITIVE_INFINITY
    : Math.min(
        maxResearchPoolSize,
        Math.max(maxProductFinds, Math.ceil(maxProductFinds * researchPoolMultiplier)),
      );
const activeEnrichmentTimeoutMs = parsePositiveNumber(
  args.get("activeEnrichmentTimeoutMs"),
  DEFAULT_ACTIVE_ENRICHMENT_TIMEOUT_MS,
);
const soldHistorySyncTimeoutMs = parsePositiveNumber(
  args.get("soldHistorySyncTimeoutMs") ?? args.get("sold-history-sync-timeout-ms"),
  DEFAULT_SOLD_HISTORY_SYNC_TIMEOUT_MS,
);
const skipEbaySync =
  args.has("skipEbaySync") ||
  args.has("skip-ebay-sync") ||
  args.get("ebaySync") === "false" ||
  args.get("ebay-sync") === "false";
const skipActiveEnrichment = args.has("skipActiveEnrichment") || args.get("enrichActive") === "false";
const skipUpload = args.has("skipUpload") || args.get("upload") === "false";
const maxActiveQueries = parseLimit(
  args.get("maxActiveQueries"),
  Number.isFinite(researchPoolProductLimit)
    ? researchPoolProductLimit
    : DEFAULT_MAX_PRODUCT_FINDS,
);

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
const sourceMetadataById = new Map(sources.map((source) => [source.id, source]));
const soldHistorySync = runSoldHistorySyncIfConfigured();
const soldIndex = existsSync(SOLD_INDEX_PATH) ? JSON.parse(readFileSync(SOLD_INDEX_PATH, "utf8")) : null;
const capturedAt = new Date().toISOString();
const runId = `scan-${timestampForFile(capturedAt)}`;
const previousScanState = loadPreviousScanState(OUTPUT_DIR);
const sourceReports = [];
const allCandidates = [];
const allSaleEvents = [];
const scheduledFetch = createPoliteFetcher({
  maxConcurrency: sourceConcurrency,
  maxRetries: fetchRetries,
  minHostDelayMs: hostDelayMs,
  requestTimeoutMs: fetchTimeoutMs,
});

const sourceScanResults = await mapWithConcurrency(sources, sourceConcurrency, async (source) => {
  const startedAt = Date.now();
  const catalogUrl = source.url;
  const storedPreferredUrl = previousScanState.preferredUrls.get(source.id) ?? null;
  const preferredUrl = compatiblePreferredSourceUrl(catalogUrl, storedPreferredUrl)
    ? storedPreferredUrl
    : catalogUrl;
  const scanTarget = preferredUrl === catalogUrl ? source : { ...source, url: preferredUrl };
  try {
    const scanResult = await scanSource(scanTarget);
    const candidates = scanResult.candidates ?? [];
    const saleEvents = scanResult.saleEvents ?? [];
    const pageReports = scanResult.pageReports ?? [];
    const failedPages = pageReports.filter((report) => report.status === "error");
    const successfulPages = pageReports.filter((report) => report.status === "available");
    const successfulSalePages = successfulPages.filter(
      (report) => (report.role ?? inferredPageRole(report.purpose)) === "sale",
    );
    const coverage = pageCoverage(pageReports, source);
    const report = {
      candidateCount: candidates.length,
      adapterStats: scanResult.adapterStats,
      catalogUrl,
      ...coverage,
      ...sourceMetadataForReport(source),
      elapsedMs: Date.now() - startedAt,
      id: source.id,
      name: source.name,
      pageErrors: failedPages,
      preferredUrl: preferredSourceUrl(scanTarget.url, pageReports),
      resolvedUrls: [...new Set(successfulPages.map((report) => report.resolvedUrl))],
      salePageCheckedUrls: [
        ...new Set(
          successfulSalePages.flatMap((page) => [page.requestedUrl, page.resolvedUrl]),
        ),
      ].filter(Boolean),
      saleEventCount: saleEvents.length,
      status: sourceReportStatus(coverage, candidates, saleEvents),
      url: preferredUrl,
    };
    console.log(`${source.name}: ${candidates.length} candidates, ${saleEvents.length} sale signals`);
    return { candidates, report, saleEvents };
  } catch (error) {
    const pageReports = error?.pageReports ?? [];
    const successfulPages = pageReports.filter((report) => report.status === "available");
    const successfulSalePages = successfulPages.filter(
      (report) => (report.role ?? inferredPageRole(report.purpose)) === "sale",
    );
    const coverage = pageCoverage(pageReports, source);
    const report = {
      candidateCount: 0,
      catalogUrl,
      ...coverage,
      ...sourceMetadataForReport(source),
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      id: source.id,
      name: source.name,
      pageErrors: pageReports.filter((page) => page.status === "error"),
      saleEventCount: 0,
      status: "error",
      preferredUrl,
      resolvedUrls: [...new Set(successfulPages.map((report) => report.resolvedUrl))],
      salePageCheckedUrls: [
        ...new Set(
          successfulSalePages.flatMap((page) => [page.requestedUrl, page.resolvedUrl]),
        ),
      ].filter(Boolean),
      url: preferredUrl,
    };
    console.log(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    return { candidates: [], report, saleEvents: [] };
  }
});

for (const result of sourceScanResults) {
  sourceReports.push(result.report);
  allCandidates.push(...result.candidates);
  allSaleEvents.push(...result.saleEvents);
}

const enrichedProducts = allCandidates
  .map((candidate) => enrichCandidate(candidate, soldIndex))
  .filter((find) => find.purchasePrice > 0);
const researchProductFinds =
  scanMode === "comprehensive"
    ? rankAndSelectCandidates(enrichedProducts, { limit: Number.POSITIVE_INFINITY })
    : rankAndSelectCandidates(enrichedProducts.filter(isHighSignalProductFind), {
        limit: researchPoolProductLimit,
      });
const researchSourceReports = annotateSourceYield(
  sourceReports,
  enrichedProducts,
  researchProductFinds,
);
const saleObservations = dedupeSaleEvents(allSaleEvents).map(saleEventToFind);
const saleLifecycle = reconcileSaleCampaigns({
  observedAt: capturedAt,
  previousLedger: previousScanState.saleCampaignLedger,
  runId,
  saleEvents: saleObservations,
  sourceReports: researchSourceReports,
});
const saleEventFinds = [...saleLifecycle.activeSaleEvents]
  .sort((left, right) => saleEventPriority(right) - saleEventPriority(left))
  .slice(0, maxSaleEvents);
const scored = [...saleEventFinds, ...researchProductFinds]
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
  phase: "scan",
  publicationStatus: "draft",
  researchPool: {
    maxActiveQueries,
    maxVisibleProductFinds: maxProductFinds,
    productCandidateCount: researchProductFinds.length,
  },
  runId,
  runMode: scanMode,
  saleCampaignLedger: saleLifecycle.ledger,
  saleEvents: saleLifecycle.activeSaleEvents,
  saleLifecycleSummary: saleLifecycle.summary,
  saleObservations,
  schemaVersion: 2,
  soldHistorySync,
  source: scanMode === "comprehensive" ? "comprehensive-retail-arbitrage-scan" : "sale-radar-retail-arbitrage-scan",
  sourceReports: researchSourceReports,
  summary: {
    ...summarize(scored, researchSourceReports),
    researchPoolProductFindCount: researchProductFinds.length,
  },
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const outputPath = join(OUTPUT_DIR, `retail-arbitrage-${timestampForFile(capturedAt)}.json`);
writeFileSync(outputPath, JSON.stringify(payload, null, 2));
const activeEnrichment = runActiveEnrichmentIfConfigured(outputPath);
if (activeEnrichment.status === "enriched") {
  payload = JSON.parse(readFileSync(outputPath, "utf8"));
}
const evaluatedAt = new Date().toISOString();
const evaluatedFinds = (payload.finds ?? [])
  .map((find) =>
    evaluateOpportunity(find, {}, evaluatedAt),
  )
  .sort(
    (left, right) =>
      opportunitySortPriority(right) - opportunitySortPriority(left) ||
      (Number(right.priorityScore) || 0) - (Number(left.priorityScore) || 0) ||
      (Number(right.expectedNetProfit) || Number.NEGATIVE_INFINITY) -
        (Number(left.expectedNetProfit) || Number.NEGATIVE_INFINITY) ||
      candidateQualityScore(right) - candidateQualityScore(left),
  );
const evaluatedSaleFinds = evaluatedFinds.filter(
  (find) => find.opportunityType === "sitewide_sale",
);
const evaluatedProductFinds = evaluatedFinds.filter(
  (find) => find.opportunityType !== "sitewide_sale",
);
const finalProductFinds = Number.isFinite(maxProductFinds)
  ? evaluatedProductFinds.slice(0, maxProductFinds)
  : evaluatedProductFinds;
payload.finds = [...evaluatedSaleFinds, ...finalProductFinds].sort(
  (left, right) =>
    opportunitySortPriority(right) - opportunitySortPriority(left) ||
    (Number(right.priorityScore) || 0) - (Number(left.priorityScore) || 0) ||
    candidateQualityScore(right) - candidateQualityScore(left),
);
const finalSourceReports = annotateSourceYield(
  sourceReports,
  enrichedProducts,
  finalProductFinds,
);
payload.sourceReports = finalSourceReports;
payload.summary = {
  ...summarize(payload.finds, finalSourceReports),
  activeEnrichment,
  researchPoolProductFindCount: researchProductFinds.length,
  soldHistorySync,
};
payload.evaluatedAt = evaluatedAt;
writeFileSync(outputPath, JSON.stringify(payload, null, 2));
const uploadResult = {
  reason: skipUpload
    ? "Disabled by --skipUpload or --upload=false."
    : "Raw scan payloads are drafts; only the curated final payload may publish as latest.",
  status: "skipped",
};

const summary = {
  ...summarize(payload.finds, finalSourceReports),
  researchPoolProductFindCount: researchProductFinds.length,
};
console.log(JSON.stringify({ activeEnrichment, outputPath, soldHistorySync, uploadResult, ...summary }, null, 2));

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
    const fullSources =
      typeof module.getActiveRetailSources === "function"
        ? module.getActiveRetailSources()
        : Array.isArray(module.retailArbitrageSourceCatalog)
          ? module.retailArbitrageSourceCatalog.filter((source) => !source.isDiscoveryOnly)
          : [];
    if (fullSources.length) return fullSources.map(normalizeOperationalSource);
    return Array.isArray(module.vinylShopSources) ? module.vinylShopSources.map(normalizeOperationalSource) : [];
  } catch {
    return [];
  }
}

function normalizeOperationalSource(source) {
  return {
    ...source,
    name: source.name ?? source.displayName,
    retailSourceType: source.retailSourceType ?? source.sourceType,
    sourceType: source.crawlType ?? source.sourceType,
    url: source.url ?? source.baseUrl,
  };
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

    sources.push({
      defaultDiscountThreshold: readNumberField(block, "defaultDiscountThreshold"),
      domain,
      id,
      minNetProfit: readNumberField(block, "minNetProfit"),
      minROI: readNumberField(block, "minROI"),
      name,
      noiseLevel: readStringField(block, "noiseLevel"),
      priority,
      saleLikelihood: readStringField(block, "saleLikelihood"),
      sourceType,
      url,
    });
  }

  return sources.sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
}

function readStringField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*"([^"]+)"`));
  return match?.[1] ?? null;
}

function readNumberField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*([0-9]+(?:\\.[0-9]+)?)`));
  return match ? Number(match[1]) : null;
}

function readBooleanField(block, fieldName) {
  return new RegExp(`${fieldName}:\\s*true`).test(block);
}

async function scanSource(source) {
  const adapter = sourceAdapterFor(source);
  const result = await adapter.scan(source);
  return {
    ...result,
    adapterStats: {
      adapterFamily: adapter.id,
      ...(result.adapterStats ?? {}),
    },
  };
}

function sourceAdapterFor(source) {
  return [
    {
      id: "vinyl-price-drop",
      matches: (candidate) => candidate.id === "vinyl-price-drop",
      scan: scanVinylPriceDrop,
    },
    {
      id: "walmart-structured-catalog",
      matches: (candidate) => candidate.id === "walmart",
      scan: scanWalmartSource,
    },
    {
      id: "shopify-structured-catalog",
      matches: (candidate) => candidate.sourceType === "shopify-store",
      scan: scanShopifySource,
    },
    {
      id: "reddit-deal-feed",
      matches: (candidate) => candidate.id.startsWith("reddit-"),
      scan: scanReddit,
    },
    {
      id: "craigslist-classifieds",
      matches: (candidate) => candidate.id.includes("craigslist"),
      scan: scanCraigslist,
    },
    {
      id: "fieldstack-catalog",
      matches: (candidate) =>
        /(?:^|\.)(?:bullmoose|ziarecords)\.com$/i.test(candidate.domain ?? new URL(candidate.url).hostname),
      scan: scanFieldstackSource,
    },
    {
      id: "generic-retailer",
      matches: () => true,
      scan: scanGenericRetailerSource,
    },
  ].find((adapter) => adapter.matches(source));
}

async function scanFieldstackSource(source) {
  const pageScan = await fetchSourcePages(source, {
    allowEmpty: true,
    followPagination: false,
  });
  return scanFieldstackPageScan(source, pageScan);
}

async function scanFieldstackPageScan(source, pageScan) {
  const configuredPage = pageScan.pages.find(
    (page) =>
      page.scanRootPurpose === "configured" &&
      !isSuspiciousHomepageRedirect(page.requestedUrl, page.url),
  );
  const config = configuredPage
    ? parseFieldstackSearchConfig(configuredPage.html, configuredPage.url)
    : null;
  if (!configuredPage || !config) {
    if (pageScan.pages.length === 0) {
      const error = new Error(sourceFailureMessage(source, pageScan.pageReports));
      error.pageReports = pageScan.pageReports;
      throw error;
    }
    return genericRetailerResult(source, pageScan);
  }

  const resultPages = [];
  const cookie = cookieHeaderFromPages([configuredPage]);
  let totalPages = 1;
  let resultErrorCount = 0;
  let resultHtmlLength = 0;
  const resultItemCounts = [];
  for (let pageNumber = 1; pageNumber <= Math.min(genericMaxPages, totalPages); pageNumber += 1) {
    const resultUrl = fieldstackResultsUrl(configuredPage.url, config, pageNumber);
    try {
      const response = await fetchPage(resultUrl, {
        headers: {
          ...(cookie ? { cookie } : {}),
          accept: "application/json",
          referer: configuredPage.url,
          "x-requested-with": "XMLHttpRequest",
          "x-search-guid": config.searchId,
        },
      });
      const parsed = parseFieldstackResultsPayload(response.html);
      if (!parsed) throw new Error(`Invalid FieldStack results payload for ${resultUrl}`);
      totalPages = Math.max(1, parsed.totalPages);
      resultHtmlLength += parsed.html.length;
      if (parsed.itemCountHtml) {
        resultItemCounts.push(cleanText(stripTags(parsed.itemCountHtml)));
      }
      const virtualUrl = new URL(configuredPage.url);
      virtualUrl.searchParams.set("page", String(pageNumber));
      resultPages.push({
        html: parsed.html,
        requestedUrl: resultUrl,
        scanPurpose: "fieldstack-results",
        scanRole: "catalog",
        scanRootPurpose: "configured",
        status: response.status,
        url: virtualUrl.toString(),
      });
      pageScan.pageReports.push(
        availablePageReport("fieldstack-results", resultUrl, virtualUrl.toString(), "catalog"),
      );
      if (!parsed.html.trim()) break;
    } catch (error) {
      resultErrorCount += 1;
      pageScan.pageReports.push(
        failedPageReport("fieldstack-results", resultUrl, error, "catalog"),
      );
      break;
    }
  }

  const productCards = resultPages.flatMap((page) =>
    extractRetailProductCards(page.html, page.url),
  );
  const resultTotals = resultItemCounts
    .map(parseFieldstackResultTotal)
    .filter((value) => value !== null);
  const explicitlyEmptyCategory =
    resultTotals.length > 0 &&
    resultTotals.every((value) => value === 0) &&
    productCards.length === 0;
  const candidates = dedupeCandidates(
    productCards
      .map((item) => structuredRetailItemToCandidate(source, item, configuredPage.url))
      .filter(Boolean),
  );
  return {
    adapterStats: {
      adapter: "fieldstack-search-results",
      candidateCount: candidates.length,
      categoryId: config.categoryId,
      resultErrorCount,
      resultHtmlLength,
      resultItemCounts,
      resultTotals,
      resultPageCount: resultPages.length,
      resultProductCardCount: productCards.length,
      totalPages,
    },
    candidates,
    pageReports: pageScan.pageReports,
    saleEvents: explicitlyEmptyCategory
      ? []
      : dedupeSaleEvents(
          [...pageScan.pages, ...resultPages].flatMap((page) =>
            detectSaleEvents(source, page.html, page.url),
          ),
        ),
  };
}

async function scanGenericRetailerSource(source) {
  const pageScan = await fetchSourcePages(source);
  const configuredPage = pageScan.pages.find(
    (page) =>
      page.scanRootPurpose === "configured" &&
      !isSuspiciousHomepageRedirect(page.requestedUrl, page.url),
  );
  if (configuredPage && parseFieldstackSearchConfig(configuredPage.html, configuredPage.url)) {
    return scanFieldstackPageScan(source, pageScan);
  }
  return genericRetailerResult(source, pageScan);
}

function genericRetailerResult(source, pageScan) {
  const candidatePages = genericCandidatePages(pageScan.pages, source);
  const structuredResults = candidatePages.map((page) => ({
    page,
    parsed: parseStructuredRetailCatalog({
      html: page.html,
      pageUrl: page.url,
    }),
  }));
  const structuredCandidates = structuredResults.flatMap(({ page, parsed }) =>
    parsed.items.map((item) => structuredRetailItemToCandidate(source, item, page.url)).filter(Boolean),
  );
  const productCardResults = candidatePages.map((page) => ({
    items: extractRetailProductCards(page.html, page.url),
    page,
  }));
  const productCardCandidates = productCardResults.flatMap(({ items, page }) =>
    items.map((item) => structuredRetailItemToCandidate(source, item, page.url)).filter(Boolean),
  );
  const htmlCandidates = candidatePages.flatMap((page) =>
    extractCandidatesFromHtml(source, page.html, page.url),
  );
  const candidates = dedupeCandidates([
    ...structuredCandidates,
    ...productCardCandidates,
    ...htmlCandidates,
  ]);
  return {
    adapterStats: {
      adapter: "generic-structured-and-html",
      candidateCount: candidates.length,
      candidatePageCount: candidatePages.length,
      fetchedPageCount: pageScan.pages.length,
      htmlProductCardCount: productCardResults.reduce(
        (total, result) => total + result.items.length,
        0,
      ),
      structuredPayloadCount: structuredResults.reduce(
        (total, result) => total + result.parsed.payloadCount,
        0,
      ),
      structuredProductCount: structuredResults.reduce(
        (total, result) => total + result.parsed.items.length,
        0,
      ),
    },
    candidates,
    pageReports: pageScan.pageReports,
    saleEvents: dedupeSaleEvents(pageScan.pages.flatMap((page) => detectSaleEvents(source, page.html, page.url))),
  };
}

function cookieHeaderFromPages(pages) {
  const cookies = new Map();
  for (const setCookie of pages.flatMap((page) => page.setCookies ?? [])) {
    const pair = String(setCookie).split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function genericCandidatePages(pages, source) {
  const configuredPages = pages.filter(
    (page) =>
      page.scanRootPurpose === "configured" &&
      !isSuspiciousHomepageRedirect(page.requestedUrl, page.url),
  );
  const discoveredVinylSalePages = pages.filter(
    (page) =>
      page.scanRootPurpose === "discovered-sale-link" &&
      /\b(?:vinyl|records?|music|lps?)\b/i.test(new URL(page.url).pathname.replace(/[-_/]+/g, " ")),
  );
  const recoveredCatalogPages = pages.filter(
    (page) => page.scanRootPurpose === "discovered-catalog-link",
  );
  if (configuredPages.length > 0) return dedupePages([...configuredPages, ...discoveredVinylSalePages]);
  if (recoveredCatalogPages.length > 0) {
    return dedupePages([...recoveredCatalogPages, ...discoveredVinylSalePages]);
  }

  try {
    if (new URL(source.url).pathname.replace(/\/+$/, "") === "") {
      return pages.filter((page) => page.scanRootPurpose === "homepage");
    }
  } catch {
    // A malformed configured URL is already represented in source diagnostics.
  }
  return [];
}

function isSuspiciousHomepageRedirect(requestedUrl, resolvedUrl) {
  try {
    const requested = new URL(requestedUrl);
    const resolved = new URL(resolvedUrl);
    return requested.pathname.replace(/\/+$/, "") !== "" && resolved.pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
}

function dedupePages(pages) {
  const byUrl = new Map();
  for (const page of pages) byUrl.set(page.url, page);
  return [...byUrl.values()];
}

function structuredRetailItemToCandidate(source, item, pageUrl) {
  if (!Number.isFinite(item.currentPrice) || item.currentPrice < 2 || item.currentPrice > 250) return null;
  if (item.available === false || item.availability === "out_of_stock") return null;
  const sourceUrl = item.canonicalUrl ?? pageUrl;
  const assessment = assessRecordCandidate({
    context: `${item.availability ?? ""} ${item.sourceKinds?.join(" ") ?? ""}`,
    source,
    title: item.title,
    url: sourceUrl,
  });
  if (!assessment.accepted) return null;

  return {
    artist: inferArtist(item.title),
    available: item.available,
    barcode: item.gtin ?? item.upc ?? null,
    candidateQualityReasons: assessment.reasons,
    candidateQualityScore: assessment.score,
    condition: "new/sealed",
    discoveryUrl: pageUrl !== sourceUrl ? pageUrl : null,
    id: stableId(source.id, item.stableId, item.title),
    purchasePrice: item.currentPrice,
    sku: item.sku ?? item.productId ?? item.tcin ?? null,
    sourceCurrency: item.currency,
    sourceDiscountPercent:
      item.regularPrice && item.regularPrice > item.currentPrice
        ? Math.round(((item.regularPrice - item.currentPrice) / item.regularPrice) * 100)
        : null,
    sourceId: source.id,
    sourceListingTitle: cleanText(item.title),
    sourceName: source.name,
    sourceOriginalPrice:
      item.regularPrice && item.regularPrice > item.currentPrice ? item.regularPrice : null,
    sourceUrl,
    stockStatus: item.availability,
    title: inferTitle(item.title),
  };
}

async function scanWalmartSource(source) {
  const pageReports = [];
  const fetchedPages = [];
  const byStableId = new Map();
  const rejectionCounts = new Map();
  let availablePageCount = 0;
  let payloadCount = 0;
  let structuredProductCount = 0;
  let uniqueStructuredProductCount = 0;
  let vinylQualifiedProductCount = 0;
  let lowPriceEligibleProductCount = 0;
  let availableLowPriceProductCount = 0;
  let firstPartyLowPriceProductCount = 0;
  let thirdPartyLowPriceProductCount = 0;
  let unknownSellerLowPriceProductCount = 0;
  const unavailableLowPriceSamples = [];
  let availabilityDetailAttemptCount = 0;
  let availabilityDetailErrorCount = 0;
  let availabilityDetailVerifiedCount = 0;
  const lanes = walmartSearchLanes(source.url);

  for (const lane of lanes) {
    let nextUrl = lane.url;
    let consecutiveNoNewPages = 0;
    const attemptedUrls = new Set();

    for (let pageNumber = 1; pageNumber <= walmartMaxPages && nextUrl; pageNumber += 1) {
      if (attemptedUrls.has(nextUrl)) break;
      attemptedUrls.add(nextUrl);
      const requestedUrl = nextUrl;
      try {
        const page = await fetchPage(requestedUrl);
        availablePageCount += 1;
        fetchedPages.push(page);
        const parsed = parseWalmartCatalogPage({
          html: page.html,
          pageUrl: page.url,
        });
        payloadCount += parsed.payloadCount;
        structuredProductCount += parsed.items.length;
        let newItemCount = 0;
        for (const item of parsed.items) {
          if (!byStableId.has(item.stableId)) {
            uniqueStructuredProductCount += 1;
            newItemCount += 1;
          }
          const existing = byStableId.get(item.stableId);
          byStableId.set(item.stableId, existing ? mergeWalmartLaneItem(existing, item, lane) : { ...item, lanes: [lane.id] });
        }
        consecutiveNoNewPages = newItemCount === 0 ? consecutiveNoNewPages + 1 : 0;
        pageReports.push({
          ...availablePageReport(`${lane.id}-page-${pageNumber}`, requestedUrl, page.url, "catalog"),
          payloadCount: parsed.payloadCount,
          structuredProductCount: parsed.items.length,
        });
        if (consecutiveNoNewPages >= 2 || parsed.items.length === 0) break;
        nextUrl =
          parsed.pagination.nextPageUrl ??
          walmartPageUrl(page.url, (parsed.pagination.currentPage ?? pageNumber) + 1);
      } catch (error) {
        pageReports.push(failedPageReport(`${lane.id}-page-${pageNumber}`, requestedUrl, error, "catalog"));
        break;
      }
    }
  }

  if (availablePageCount === 0) {
    const error = new Error(sourceFailureMessage(source, pageReports));
    error.pageReports = pageReports;
    throw error;
  }

  const availabilityTargets = [...byStableId.values()]
    .filter((item) => {
      if (item.available !== false && item.stockStatus !== "out_of_stock") return false;
      if (item.soldByWalmart === false || !item.canonicalUrl) return false;
      if (!assessWalmartAbsolutePrice(item.currentPrice).eligible) return false;
      return walmartRecordAssessment(item, source).accepted;
    })
    .sort((left, right) => walmartAvailabilityPriority(right) - walmartAvailabilityPriority(left))
    .slice(0, walmartAvailabilityDetailLimit);
  availabilityDetailAttemptCount = availabilityTargets.length;
  await mapWithConcurrency(
    availabilityTargets,
    Math.max(1, Math.min(discoveryConcurrency, 5)),
    async (item) => {
      try {
        const page = await fetchPage(item.canonicalUrl);
        const parsed = parseWalmartCatalogPage({ html: page.html, pageUrl: page.url });
        const verified = parsed.items.find((candidate) => walmartItemsMatch(item, candidate));
        pageReports.push({
          ...availablePageReport("walmart-product-availability", item.canonicalUrl, page.url, "catalog"),
          payloadCount: parsed.payloadCount,
          structuredProductCount: parsed.items.length,
        });
        if (!verified) return;
        byStableId.set(
          item.stableId,
          {
            ...mergeWalmartLaneItem(item, verified, { id: "walmart-product-page" }),
            availabilityVerifiedAt: capturedAt,
            availabilityVerificationSource: "product_page",
          },
        );
        if (verified.available === true || verified.stockStatus === "in_stock" || verified.stockStatus === "limited_stock") {
          availabilityDetailVerifiedCount += 1;
        }
      } catch (error) {
        availabilityDetailErrorCount += 1;
        pageReports.push(failedPageReport("walmart-product-availability", item.canonicalUrl, error, "catalog"));
      }
    },
  );

  const candidates = [];
  for (const item of byStableId.values()) {
    const priceAssessment = assessWalmartAbsolutePrice(item.currentPrice);
    if (priceAssessment.eligible) {
      lowPriceEligibleProductCount += 1;
      if (item.available !== false && item.stockStatus !== "out_of_stock") {
        availableLowPriceProductCount += 1;
      } else if (unavailableLowPriceSamples.length < 8) {
        unavailableLowPriceSamples.push({
          price: item.currentPrice,
          sellerName: item.sellerName,
          stockStatus: item.stockStatus,
          title: item.title,
          url: item.canonicalUrl,
        });
      }
      if (item.soldByWalmart === true) firstPartyLowPriceProductCount += 1;
      else if (item.soldByWalmart === false) thirdPartyLowPriceProductCount += 1;
      else unknownSellerLowPriceProductCount += 1;
    }
    if (item.available === false || item.stockStatus === "out_of_stock") {
      incrementCount(rejectionCounts, "unavailable");
      continue;
    }
    if (item.soldByWalmart === false) {
      incrementCount(rejectionCounts, "third_party_seller");
      continue;
    }
    if (!item.canonicalUrl) {
      incrementCount(rejectionCounts, "missing_product_url");
      continue;
    }

    if (!priceAssessment.eligible) {
      incrementCount(rejectionCounts, item.currentPrice === null ? "missing_price" : "over_absolute_price_ceiling");
      continue;
    }

    const assessment = walmartRecordAssessment(item, source);
    if (!assessment.accepted) {
      incrementCount(rejectionCounts, assessment.reasons[0] ?? "not_vinyl");
      continue;
    }
    vinylQualifiedProductCount += 1;

    const retailerBestSeller = item.badges.some((badge) => /\b(?:best\s*seller|best\s*selling|popular\s+pick)\b/i.test(badge));
    const retailerCustomerPick = item.badges.some((badge) =>
      /\b(?:customer(?:s')?\s+pick|overall\s+pick|top\s+rated)\b/i.test(badge),
    );
    const candidateQualityReasons = [
      ...assessment.reasons,
      `walmart_${priceAssessment.tier}_price`,
      ...(item.soldByWalmart === true ? ["sold_by_walmart"] : []),
      ...(retailerBestSeller ? ["retailer_best_seller"] : []),
      ...(retailerCustomerPick ? ["retailer_customer_pick"] : []),
      ...(item.upc ? ["upc_available"] : []),
    ];
    const sourceDiscountPercent =
      item.wasPrice !== null && item.currentPrice !== null && item.wasPrice > item.currentPrice
        ? Math.round(((item.wasPrice - item.currentPrice) / item.wasPrice) * 100)
        : null;
    const pickupEligible = item.fulfillment.includes("pickup");
    candidates.push({
      artist: inferArtist(item.title),
      barcode: item.upc,
      candidateQualityReasons,
      // Keep the embedded score focused on product identity. Price, first-party
      // status, badges, identifiers, and reviews are added once by the global
      // candidate ranker, which preserves useful separation between Walmart finds.
      candidateQualityScore: assessment.score,
      condition: "new/sealed",
      costs: pickupEligible ? { inboundShipping: 0 } : undefined,
      discoveryUrl: walmartLaneDiscoveryUrl(source.url, item.lanes),
      id: stableId(source.id, item.stableId),
      pickupEligible,
      purchasePrice: item.currentPrice,
      quantityAvailable: item.inventoryQuantity,
      retailerBadges: item.badges,
      retailerBestSeller,
      retailerCustomerPick,
      retailerRating: item.rating,
      retailerReviewCount: item.reviewCount,
      retailerSellerName: item.sellerName,
      retailerSoldBySource: item.soldByWalmart,
      sku: item.sku ?? item.usItemId,
      sourceCurrency: item.currency ?? "USD",
      sourceDiscountPercent,
      sourceId: source.id,
      sourceListingTitle: cleanText(item.title),
      sourceName: source.name,
      sourceOriginalPrice: item.wasPrice,
      sourceUrl: item.canonicalUrl,
      title: inferTitle(item.title),
      walmartAbsolutePriceTier: priceAssessment.tier,
      walmartAvailabilityVerificationSource: item.availabilityVerificationSource ?? "search_result",
      walmartAvailabilityVerifiedAt: item.availabilityVerifiedAt ?? null,
      walmartFulfillment: item.fulfillment,
      walmartRequiresDemandSupport: priceAssessment.requiresDemandSupport,
      walmartStockStatus: item.stockStatus,
      walmartUsItemId: item.usItemId,
    });
  }

  return {
    adapterStats: {
      adapter: "walmart-next-data",
      availabilityDetailAttemptCount,
      availabilityDetailErrorCount,
      availabilityDetailVerifiedCount,
      availablePageCount,
      availableLowPriceProductCount,
      candidateCount: candidates.length,
      firstPartyLowPriceProductCount,
      laneCount: lanes.length,
      lowPriceEligibleProductCount,
      payloadCount,
      rejectedProductCounts: Object.fromEntries([...rejectionCounts.entries()].sort()),
      structuredProductCount,
      thirdPartyLowPriceProductCount,
      unavailableLowPriceSamples,
      uniqueStructuredProductCount,
      unknownSellerLowPriceProductCount,
      vinylQualifiedProductCount,
    },
    candidates: dedupeCandidates(candidates),
    pageReports,
    saleEvents: dedupeSaleEvents(
      fetchedPages.flatMap((page) => detectSaleEvents(source, page.html, page.url)),
    ),
  };
}

function walmartSearchLanes(configuredUrl) {
  const definitions = [
    { id: "walmart-configured", maxPrice: 20, sort: null },
    { id: "walmart-under-10-price-low", maxPrice: 10, sort: "price_low" },
    { id: "walmart-under-15-price-low", maxPrice: 15, sort: "price_low" },
    { id: "walmart-under-20-price-low", maxPrice: 20, sort: "price_low" },
    { id: "walmart-under-20-best-match", maxPrice: 20, sort: "best_match" },
    { id: "walmart-under-20-best-seller", maxPrice: 20, sort: "best_seller" },
  ];
  const seenUrls = new Set();
  return definitions
    .map((definition) => {
      const url = new URL(configuredUrl);
      if (!url.searchParams.get("q")) url.searchParams.set("q", "vinyl records");
      if (!url.searchParams.get("catId")) url.searchParams.set("catId", "4104_1205481");
      url.searchParams.set("max_price", String(definition.maxPrice));
      url.searchParams.set("facet", "retailer_type:Walmart");
      if (definition.sort) url.searchParams.set("sort", definition.sort);
      else url.searchParams.delete("sort");
      url.searchParams.delete("page");
      return { ...definition, url: url.toString() };
    })
    .filter((lane) => {
      if (seenUrls.has(lane.url)) return false;
      seenUrls.add(lane.url);
      return true;
    });
}

function walmartPageUrl(value, pageNumber) {
  const url = new URL(value);
  url.searchParams.set("page", String(pageNumber));
  return url.toString();
}

function walmartRecordAssessment(item, source) {
  return assessRecordCandidate({
    context: `Walmart vinyl records ${(item.badges ?? []).join(" ")}`,
    source,
    title: item.title,
    url: item.canonicalUrl,
  });
}

function walmartAvailabilityPriority(item) {
  const price = Number(item.currentPrice) || 999;
  const reviewCount = Math.max(0, Number(item.reviewCount) || 0);
  const badgeText = (item.badges ?? []).join(" ");
  return (
    (price <= 13 ? 35 : price <= 15 ? 25 : price <= 20 ? 10 : 0) +
    Math.min(30, Math.log2(1 + reviewCount) * 4) +
    (/\b(?:best\s*seller|best\s*selling|popular\s+pick|overall\s+pick)\b/i.test(badgeText) ? 15 : 0) +
    (item.wasPrice && item.wasPrice > price ? Math.min(15, item.wasPrice - price) : 0)
  );
}

function walmartItemsMatch(left, right) {
  if (left.stableId && right.stableId && left.stableId === right.stableId) return true;
  if (left.usItemId && right.usItemId && left.usItemId === right.usItemId) return true;
  if (!left.canonicalUrl || !right.canonicalUrl) return false;
  try {
    return new URL(left.canonicalUrl).pathname.toLowerCase() === new URL(right.canonicalUrl).pathname.toLowerCase();
  } catch {
    return false;
  }
}

function walmartLaneDiscoveryUrl(configuredUrl, lanes) {
  const matchingLane = walmartSearchLanes(configuredUrl).find((lane) => lanes.includes(lane.id));
  return matchingLane?.url ?? configuredUrl;
}

function mergeWalmartLaneItem(existing, incoming, lane) {
  const currentPrice =
    existing.currentPrice === null
      ? incoming.currentPrice
      : incoming.currentPrice === null
        ? existing.currentPrice
        : Math.min(existing.currentPrice, incoming.currentPrice);
  return {
    ...existing,
    available:
      existing.available === true || incoming.available === true
        ? true
        : existing.available === false && incoming.available === false
          ? false
          : existing.available ?? incoming.available,
    badges: [...new Set([...(existing.badges ?? []), ...(incoming.badges ?? [])])],
    canonicalUrl: existing.canonicalUrl ?? incoming.canonicalUrl,
    currency: existing.currency ?? incoming.currency,
    currentPrice,
    fulfillment: [...new Set([...(existing.fulfillment ?? []), ...(incoming.fulfillment ?? [])])],
    inventoryQuantity: existing.inventoryQuantity ?? incoming.inventoryQuantity,
    lanes: [...new Set([...(existing.lanes ?? []), lane.id])],
    rating: existing.rating ?? incoming.rating,
    reviewCount: existing.reviewCount ?? incoming.reviewCount,
    sellerId: existing.sellerId ?? incoming.sellerId,
    sellerName: existing.sellerName ?? incoming.sellerName,
    sku: existing.sku ?? incoming.sku,
    soldByWalmart: existing.soldByWalmart ?? incoming.soldByWalmart,
    stockStatus:
      existing.stockStatus === "in_stock" || incoming.stockStatus === "in_stock"
        ? "in_stock"
        : existing.stockStatus === "limited_stock" || incoming.stockStatus === "limited_stock"
          ? "limited_stock"
          : existing.stockStatus === "out_of_stock" && incoming.stockStatus === "out_of_stock"
            ? "out_of_stock"
            : "unknown",
    upc: existing.upc ?? incoming.upc,
    usItemId: existing.usItemId ?? incoming.usItemId,
    wasPrice: Math.max(existing.wasPrice ?? 0, incoming.wasPrice ?? 0) || null,
  };
}

function incrementCount(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

async function scanShopifySource(source) {
  const pageScan = await fetchSourcePages(source, { allowEmpty: true, followPagination: false });
  const origin = pageScan.pages.length ? new URL(pageScan.pages[0].url).origin : new URL(source.url).origin;
  const byUrl = new Map();
  let shopifyFeedErrorCount = 0;
  let shopifyFeedPageCount = 0;
  let shopifyCollectionFeedPageCount = 0;
  let shopifyRootFeedPageCount = 0;
  let shopifyProductCount = 0;
  let shopifyRecordProductCount = 0;
  const shopifyCurrency = extractShopifyCurrency(pageScan.pages.map((page) => page.html));
  const collectionLaneSelection = selectShopifyCollectionLanes(
    pageScan.pages.map((page) => page.url),
    source.url,
    shopifyCollectionLanes,
  );
  const collectionDescriptors = collectionLaneSelection.selected.flatMap(({ url }) =>
    shopifyCatalogUrls({ url }, 1, 250, { includeRootCatalog: false }),
  );
  const shouldScanRootCatalog =
    includeShopifyRootCatalog ||
    (collectionDescriptors.length === 0 && !collectionLaneSelection.configuredExcluded);
  const firstPageDescriptors = [
    ...collectionDescriptors,
    ...(shouldScanRootCatalog
      ? [shopifyCatalogUrls({ url: origin }, 1).find((descriptor) => descriptor.collectionContext === null)]
      : []),
  ].filter(Boolean);

  for (const firstDescriptor of firstPageDescriptors) {
    const pageLimit = firstDescriptor.collectionContext ? shopifyMaxPages : shopifyRootMaxPages;
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const descriptor = {
        ...firstDescriptor,
        url: shopifyPageUrl(firstDescriptor.url, pageNumber),
      };
      const purpose = descriptor.collectionContext ? "shopify-collection-feed" : "shopify-catalog-feed";
      try {
        const page = await fetchPage(descriptor.url);
        pageScan.pageReports.push(availablePageReport(purpose, descriptor.url, page.url, "catalog"));
        const payload = JSON.parse(page.html);
        const products = Array.isArray(payload.products) ? payload.products : [];
        shopifyFeedPageCount += 1;
        if (descriptor.collectionContext) shopifyCollectionFeedPageCount += 1;
        else shopifyRootFeedPageCount += 1;
        shopifyProductCount += products.length;
        const normalized = normalizeShopifyProducts({
          assessment: assessRecordCandidate,
          collectionContext: descriptor.collectionContext,
          currency: shopifyCurrency,
          origin,
          products,
          source,
        });
        shopifyRecordProductCount += normalized.length;
        for (const item of normalized) {
          const titleArtist = inferArtist(item.product.title);
          const artist =
            titleArtist !== "Unknown Artist" || isStoreVendor(item.product.vendor) ? titleArtist : cleanText(item.product.vendor);
          const candidate = {
            artist,
            availableVariantCount: item.availableVariantCount,
            barcode: item.barcode,
            candidateQualityReasons: item.candidateQualityReasons,
            candidateQualityScore: item.candidateQualityScore,
            collectionContext: item.collectionContext,
            condition: "new/sealed",
            discoveryUrl: item.collectionContext ? `${origin}/collections/${item.collectionContext}` : null,
            id: stableId(source.id, item.productUrl, item.variantId ?? item.product.title),
            purchasePrice: item.price,
            quantityAvailable: item.inventoryQuantity,
            shopifyVariantId: item.variantId,
            shopifyVariantTitle: item.variantTitle,
            sku: item.sku,
            sourceCurrency: item.currency,
            sourceDiscountPercent:
              item.compareAtPrice && item.compareAtPrice > item.price
                ? Math.round(((item.compareAtPrice - item.price) / item.compareAtPrice) * 100)
                : null,
            sourceId: source.id,
            sourceListingTitle: cleanText(item.listingTitle),
            sourceName: source.name,
            sourceOriginalPrice: item.compareAtPrice,
            sourceUrl: item.productUrl,
            title: inferTitle(item.product.title),
          };
          const current = byUrl.get(item.productUrl);
          if (
            !current ||
            collectionContextPriority(candidate.collectionContext) > collectionContextPriority(current.collectionContext) ||
            candidate.purchasePrice < current.purchasePrice
          ) {
            byUrl.set(item.productUrl, candidate);
          }
        }
        if (products.length < 250) break;
      } catch (error) {
        shopifyFeedErrorCount += 1;
        pageScan.pageReports.push(failedPageReport(purpose, descriptor.url, error, "catalog"));
        break;
      }
    }
  }

  if (byUrl.size === 0) {
    if (pageScan.pages.length === 0) {
      const error = new Error(sourceFailureMessage(source, pageScan.pageReports));
      error.pageReports = pageScan.pageReports;
      throw error;
    }
    const fallback = genericRetailerResult(source, pageScan);
    return {
      adapterStats: {
        ...fallback.adapterStats,
        adapter: "shopify-generic-fallback",
        adapterFamily: "shopify-with-retailer-neutral-fallback",
        candidateCount: fallback.candidates.length,
        collectionCandidateCount: collectionLaneSelection.candidateCount,
        collectionFeedPageCount: shopifyCollectionFeedPageCount,
        collectionConfiguredExcluded: collectionLaneSelection.configuredExcluded,
        collectionExcludedCount: collectionLaneSelection.excludedCount,
        collectionLaneLimit: shopifyCollectionLanes,
        collectionSelectedCount: collectionLaneSelection.selected.length,
        feedErrorCount: shopifyFeedErrorCount,
        feedPageCount: shopifyFeedPageCount,
        productCount: shopifyProductCount,
        recordProductCount: shopifyRecordProductCount,
        rejectedOrUnavailableProductCount: Math.max(0, shopifyProductCount - shopifyRecordProductCount),
        rootCatalogAttempted: shouldScanRootCatalog,
        rootFeedPageCount: shopifyRootFeedPageCount,
      },
      candidates: fallback.candidates,
      pageReports: fallback.pageReports,
      saleEvents: fallback.saleEvents,
    };
  }

  return {
    adapterStats: {
      adapter: "shopify-products-json",
      candidateCount: byUrl.size,
      collectionCandidateCount: collectionLaneSelection.candidateCount,
      collectionConfiguredExcluded: collectionLaneSelection.configuredExcluded,
      collectionCount: collectionLaneSelection.selected.length,
      collectionExcludedCount: collectionLaneSelection.excludedCount,
      collectionFeedPageCount: shopifyCollectionFeedPageCount,
      collectionLaneLimit: shopifyCollectionLanes,
      collectionSelectedCount: collectionLaneSelection.selected.length,
      feedErrorCount: shopifyFeedErrorCount,
      feedPageCount: shopifyFeedPageCount,
      productCount: shopifyProductCount,
      recordProductCount: shopifyRecordProductCount,
      rejectedOrUnavailableProductCount: Math.max(0, shopifyProductCount - shopifyRecordProductCount),
      rootCatalogAttempted: shouldScanRootCatalog,
      rootFeedPageCount: shopifyRootFeedPageCount,
    },
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

  for (const target of sourceEntryTargets(source, { maxHintUrls: salePathHintLimit(source) })) {
    await addPage(target.url, target.purpose, sourceEntryRole(source, target));
  }

  const hasUsableConfiguredCatalog = pages.some(
    (page) =>
      page.scanRootPurpose === "configured" &&
      !isSuspiciousHomepageRedirect(page.requestedUrl, page.url),
  );
  if (!hasUsableConfiguredCatalog && maxDiscoveredCatalogPages > 0) {
    const homepage = pages.find((page) => page.scanRootPurpose === "homepage");
    const recoveryUrls = homepage
      ? discoverRetailCatalogLinks(homepage.html, homepage.url, maxDiscoveredCatalogPages)
      : [];
    for (const url of recoveryUrls) {
      await addPage(url, "discovered-catalog-link", "catalog");
    }
  }

  const discoveredUrls = [];
  for (const page of pages) {
    discoveredUrls.push(...discoverSaleLinks(page.html, page.url, maxDiscoveredSalePages, source));
  }

  for (const url of [...new Set(discoveredUrls)].slice(0, maxDiscoveredSalePages)) {
    await addPage(url, "discovered-sale-link", "sale");
  }

  if (options.followPagination !== false && genericMaxPages > 1) {
    let paginationPageCount = 0;
    for (let pageIndex = 0; pageIndex < pages.length && paginationPageCount < genericMaxPages - 1; pageIndex += 1) {
      const page = pages[pageIndex];
      const paginationUrls = discoverRetailPaginationLinks(
        page.html,
        page.url,
        genericMaxPages - 1 - paginationPageCount,
      );
      for (const url of paginationUrls) {
        const added = await addPage(
          url,
          "pagination",
          page.scanRole ?? "catalog",
          page.scanRootPurpose ?? page.scanPurpose,
        );
        if (added) paginationPageCount += 1;
        if (paginationPageCount >= genericMaxPages - 1) break;
      }
    }
  }

  if (pages.length === 0 && !options.allowEmpty) {
    const error = new Error(sourceFailureMessage(source, pageReports));
    error.pageReports = pageReports;
    throw error;
  }

  return { pageReports, pages };

  async function addPage(url, purpose, role, rootPurpose = purpose) {
    if (attempted.has(url) || resolved.has(url)) return false;
    attempted.add(url);

    try {
      const page = await fetchPage(url);
      pageReports.push({
        purpose,
        requestedUrl: url,
        resolvedUrl: page.url,
        role,
        status: "available",
      });
      if (!resolved.has(page.url)) {
        resolved.add(page.url);
        pages.push({
          ...page,
          requestedUrl: url,
          scanPurpose: purpose,
          scanRole: role,
          scanRootPurpose: rootPurpose,
        });
        return true;
      }
    } catch (error) {
      pageReports.push({
        error: error instanceof Error ? error.message : String(error),
        failureKind: error?.failureKind ?? "network_error",
        purpose,
        requestedUrl: url,
        role,
        status: "error",
      });
    }
    return false;
  }
}

function collectionContextPriority(value) {
  if (!value) return 0;
  if (/\b(?:sale|clearance|outlet|deal|discount|last-chance|warehouse|closeout|deep-cuts|50-off)\b/i.test(value)) return 2;
  return 1;
}

function shopifyPageUrl(value, pageNumber) {
  const url = new URL(value);
  url.searchParams.set("page", String(pageNumber));
  return url.toString();
}

function salePathHintLimit(source) {
  if (source.saleLikelihood === "high" || source.priority === 1) return 4;
  if (source.saleLikelihood === "medium" || source.priority === 2) return 2;
  return 1;
}

function sourceEntryRole(source, target) {
  if (source.sourceType === "deal-aggregator" || source.sourceType === "social-feed") return "sale";
  if (target.purpose === "configured-sale-hint") return "sale";
  if (target.purpose === "homepage") return "catalog";
  const value = target.url;
  if (isSaleSpecificUrl(value, source)) return "sale";
  try {
    const parsed = new URL(value);
    if (
      (source.salePathHints ?? []).some((hint) => {
        try {
          return parsed.pathname.startsWith(new URL(hint, parsed.origin).pathname);
        } catch {
          return false;
        }
      })
    ) {
      return "sale";
    }
    if (
      (source.saleUrlPatterns ?? []).some((pattern) => {
        try {
          return new RegExp(pattern, "i").test(value);
        } catch {
          return value.toLowerCase().includes(String(pattern).toLowerCase());
        }
      })
    ) {
      return "sale";
    }
  } catch {
    // Treat malformed configured URLs as catalog attempts so the failure is visible.
  }
  return "catalog";
}

function pageCoverage(pageReports, source) {
  const catalog = pageReports.filter((report) => (report.role ?? inferredPageRole(report.purpose)) === "catalog");
  const sale = pageReports.filter((report) => (report.role ?? inferredPageRole(report.purpose)) === "sale");
  return {
    catalogHealth: coverageHealth(catalog, "not_attempted"),
    catalogPageAttemptCount: catalog.length,
    catalogPageAvailableCount: catalog.filter((report) => report.status === "available").length,
    configuredSalePathCount: (source.salePathHints ?? []).length,
    salePageAttemptCount: sale.length,
    salePageAvailableCount: sale.filter((report) => report.status === "available").length,
    salePageHealth: coverageHealth(sale, "not_checked"),
  };
}

function coverageHealth(reports, emptyStatus) {
  if (reports.length === 0) return emptyStatus;
  const available = reports.filter((report) => report.status === "available").length;
  if (available === reports.length) return "healthy";
  if (available > 0) return "partial";
  return "failed";
}

function annotateSourceYield(reports, enrichedCandidates, selectedProductFinds) {
  const enrichedBySource = groupBySourceId(enrichedCandidates);
  const selectedBySource = groupBySourceId(selectedProductFinds);

  return reports.map((report) => {
    const enriched = enrichedBySource.get(report.id) ?? [];
    const selected = selectedBySource.get(report.id) ?? [];
    const highSignalCandidateCount = enriched.filter(isHighSignalProductFind).length;
    const ownHistoryMatchedCandidateCount = enriched.filter(
      (candidate) => Number(candidate.artistSoldUnits365Days) > 0,
    ).length;
    const productParseHealth = sourceProductParseHealth(report);
    const selectedProductFindCount = selected.length;
    const usableCoverage =
      selectedProductFindCount > 0
        ? "selected"
        : highSignalCandidateCount > 0
          ? "high_signal"
          : Number(report.candidateCount) > 0
            ? "raw_candidates"
            : productParseHealth === "empty"
              ? "parser_empty"
              : productParseHealth === "failed"
                ? "unavailable"
                : "not_attempted";

    return {
      ...report,
      highSignalCandidateCount,
      ownHistoryMatchedCandidateCount,
      productParseHealth,
      selectedProductFindCount,
      usableCoverage,
    };
  });
}

function groupBySourceId(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!item?.sourceId) continue;
    const sourceItems = grouped.get(item.sourceId);
    if (sourceItems) sourceItems.push(item);
    else grouped.set(item.sourceId, [item]);
  }
  return grouped;
}

function sourceProductParseHealth(report) {
  if (Number(report.candidateCount) > 0) return "productive";
  const attemptedPages =
    Number(report.catalogPageAttemptCount ?? 0) + Number(report.salePageAttemptCount ?? 0);
  const availablePages =
    Number(report.catalogPageAvailableCount ?? 0) + Number(report.salePageAvailableCount ?? 0);
  if (attemptedPages === 0) return "not_attempted";
  if (availablePages > 0) return "empty";
  return "failed";
}

function inferredPageRole(purpose) {
  return /\b(?:deal|sale|sitewide)\b/i.test(String(purpose ?? "")) ? "sale" : "catalog";
}

function sourceReportStatus(coverage, candidates, saleEvents) {
  const attemptedHealth = [coverage.catalogHealth, coverage.salePageHealth].filter(
    (health) => health !== "not_attempted" && health !== "not_checked",
  );
  if (attemptedHealth.length && attemptedHealth.every((health) => health === "failed")) return "error";
  if (attemptedHealth.some((health) => health === "failed" || health === "partial")) return "partial";
  if (candidates.length) return "candidates";
  if (saleEvents.length) return "sale_signals";
  return "empty";
}

function sourceMetadataForReport(source) {
  return {
    country: source.country ?? null,
    crawlType: source.crawlType ?? source.sourceType,
    defaultDiscountThreshold: source.defaultDiscountThreshold ?? null,
    domain: source.domain ?? null,
    group: source.group ?? null,
    minNetProfit: source.minNetProfit ?? null,
    minROI: source.minROI ?? null,
    noiseLevel: source.noiseLevel ?? null,
    notes: source.notes ?? null,
    priority: source.priority ?? null,
    retailSourceType: source.retailSourceType ?? null,
    saleLikelihood: source.saleLikelihood ?? null,
    saleUrlPatternCount: (source.saleUrlPatterns ?? []).length,
  };
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
    const current = byId.get(candidate.id);
    if (
      !current ||
      candidateQualityScore(candidate) > candidateQualityScore(current) ||
      (candidateQualityScore(candidate) === candidateQualityScore(current) && candidate.purchasePrice < current.purchasePrice)
    ) {
      byId.set(candidate.id, {
        ...current,
        ...candidate,
        barcode: candidate.barcode ?? current?.barcode ?? null,
        discoveryUrl: candidate.discoveryUrl ?? current?.discoveryUrl ?? null,
        sku: candidate.sku ?? current?.sku ?? null,
      });
    }
  }
  return [...byId.values()];
}

function preferredSourceUrl(currentUrl, pageReports) {
  const configuredWasStale = pageReports.some(
    (report) => report.purpose === "configured" && report.status === "error" && report.failureKind === "not_found",
  );
  if (!configuredWasStale) return currentUrl;
  const recoveredCatalog = pageReports
    .filter(
      (report) =>
        report.purpose === "discovered-catalog-link" &&
        report.status === "available" &&
        report.resolvedUrl,
    )
    .map((report) => report.resolvedUrl)
    .sort(
      (left, right) =>
        preferredRecoveryScore(right, currentUrl) - preferredRecoveryScore(left, currentUrl) ||
        left.localeCompare(right),
    )[0];
  if (recoveredCatalog) return recoveredCatalog;
  return pageReports.find((report) => report.purpose === "homepage" && report.status === "available")?.resolvedUrl ?? currentUrl;
}

function compatiblePreferredSourceUrl(configuredUrl, preferredUrl) {
  if (!preferredUrl) return false;
  let configured;
  let preferred;
  try {
    configured = new URL(configuredUrl);
    preferred = new URL(preferredUrl);
  } catch {
    return false;
  }
  if (configured.origin !== preferred.origin) return false;
  if (isSaleSpecificUrl(configuredUrl) && !isSaleSpecificUrl(preferredUrl)) return false;

  const preferredCollection = preferred.pathname.match(/\/collections\/([^/?#]+)/i)?.[1] ?? null;
  if (preferredCollection) {
    const selection = selectShopifyCollectionLanes([preferredUrl], configuredUrl, 2);
    const preferredCanonical = `${preferred.origin}/collections/${preferredCollection}`.toLowerCase();
    if (!selection.selected.some((lane) => lane.url.toLowerCase() === preferredCanonical)) return false;
  }
  return true;
}

function preferredRecoveryScore(value, currentUrl) {
  let pathText = "";
  try {
    pathText = decodeURIComponent(new URL(value).pathname).replace(/[-_/]+/g, " ");
  } catch {
    return 0;
  }
  return (
    (isSaleSpecificUrl(currentUrl) && isSaleSpecificUrl(value) ? 1_000 : 0) +
    (isSaleSpecificUrl(value) ? 500 : 0) +
    (/\bvinyl\s*records?\b/i.test(pathText) ? 180 : 0) +
    (/\bvinyl\b/i.test(pathText) ? 120 : 0) +
    (/\blps?\b/i.test(pathText) ? 100 : 0) +
    (/\brecords?\b/i.test(pathText) ? 80 : 0)
  );
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
    pageReports.push(availablePageReport("feed", feedUrl, page.url, "sale"));
    deals = parseRedditAtomFeed(page.html);
  } catch (error) {
    pageReports.push(failedPageReport("feed", feedUrl, error, "sale"));
    adapter = "reddit-old-html";
    try {
      const page = await fetchPage(fallbackUrl);
      pageReports.push(availablePageReport("fallback", fallbackUrl, page.url, "sale"));
      deals = parseOldRedditDealPage(page.html, page.url);
    } catch (fallbackError) {
      pageReports.push(failedPageReport("fallback", fallbackUrl, fallbackError, "sale"));
      fallbackError.pageReports = pageReports;
      throw fallbackError;
    }
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
  let dealsPage;
  try {
    dealsPage = await fetchPage(dealsUrl);
    pageReports.push(availablePageReport("deal-index", dealsUrl, dealsPage.url));
  } catch (error) {
    pageReports.push(failedPageReport("deal-index", dealsUrl, error));
    error.pageReports = pageReports;
    throw error;
  }

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
  const assessment = assessRecordCandidate({
    context: parsedTitle.artist,
    source,
    title: deal.title,
    url: sourceUrl,
  });
  if (!assessment.accepted) return null;
  const amazonAsin = extractAmazonAsin(sourceUrl);

  return {
    amazonAsin,
    artist: parsedTitle.artist,
    candidateQualityReasons: assessment.reasons,
    candidateQualityScore: assessment.score,
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

function availablePageReport(purpose, requestedUrl, resolvedUrl, role = inferredPageRole(purpose)) {
  return { purpose, requestedUrl, resolvedUrl, role, status: "available" };
}

function failedPageReport(purpose, requestedUrl, error, role = inferredPageRole(purpose)) {
  return {
    error: error instanceof Error ? error.message : String(error),
    failureKind: error?.failureKind ?? "network_error",
    purpose,
    requestedUrl,
    role,
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
  const requestedUrl = source.url.replace("#search=2~gallery~0", "");
  const page = await fetchPage(requestedUrl);
  return {
    candidates: extractCandidatesFromHtml(source, page.html, page.url),
    pageReports: [availablePageReport("configured", requestedUrl, page.url, "catalog")],
    saleEvents: detectSaleEvents(source, page.html, page.url),
  };
}

function extractCandidatesFromHtml(source, html, pageUrl = source.url) {
  const candidates = [];
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi)];
  const seen = new Set();

  for (const match of anchors) {
    const href = absolutize(pageUrl, decodeHtmlEntities(match[1]));
    if (!/^https?:\/\//i.test(href)) continue;
    const text = cleanText(stripTags(match[2]));
    const nearby = html.slice(Math.max(0, match.index - 300), Math.min(html.length, match.index + 900));
    const assessment = assessRecordCandidate({
      context: stripTags(nearby),
      source,
      title: text,
      url: href,
    });
    if (!assessment.accepted) continue;

    const afterAnchor = stripTags(
      html.slice(match.index + match[0].length, Math.min(html.length, match.index + match[0].length + 450)),
    );
    const beforeAnchor = stripTags(html.slice(Math.max(0, match.index - 250), match.index));
    const primaryPrices = parseRetailProductPrices(cleanText(`${text} ${afterAnchor}`)).filter((price) => price >= 2 && price <= 250);
    const prices =
      primaryPrices.length > 0
        ? primaryPrices
        : parseRetailProductPrices(cleanText(`${beforeAnchor} ${text}`)).filter((price) => price >= 2 && price <= 250);
    const price = prices.length ? Math.min(...prices) : null;
    if (!price || price < 2 || price > 250) continue;
    const originalPrice = prices.length > 1 ? Math.max(...prices) : null;

    const title = inferTitle(text);
    if (!title || title.length < 3) continue;
    const dedupeKey = `${href}::${title}::${price}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    candidates.push({
      artist: inferArtist(text),
      candidateQualityReasons: assessment.reasons,
      candidateQualityScore: assessment.score,
      condition: "new/sealed",
      discoveryUrl: pageUrl !== href ? pageUrl : null,
      id: stableId(source.id, href, title),
      purchasePrice: price,
      sourceDiscountPercent:
        originalPrice && originalPrice > price ? Math.round(((originalPrice - price) / originalPrice) * 100) : null,
      sourceId: source.id,
      sourceName: source.name,
      sourceOriginalPrice: originalPrice && originalPrice > price ? originalPrice : null,
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
        const offers = item.offers ? (Array.isArray(item.offers) ? item.offers : [item.offers]) : [];
        const offer = offers.find((candidate) => !/outofstock|soldout|discontinued/i.test(String(candidate?.availability ?? ""))) ?? null;
        if (offers.length > 0 && !offer) continue;
        const price = parsePrice(offer?.price ?? offer?.lowPrice ?? item.price);
        const sourceUrl = absolutize(pageUrl, item.url ?? offer?.url ?? pageUrl);
        if (!/^https?:\/\//i.test(sourceUrl)) continue;
        const assessment = assessRecordCandidate({
          context: offer?.description ?? item.description ?? "",
          productType: item.category ?? "",
          source,
          title: name,
          url: sourceUrl,
        });
        if (!name || !price || !assessment.accepted) continue;
        candidates.push({
          artist: inferArtist(name),
          barcode: item.gtin13 ?? item.gtin12 ?? item.gtin ?? null,
          candidateQualityReasons: assessment.reasons,
          candidateQualityScore: assessment.score,
          condition: "new/sealed",
          discoveryUrl: pageUrl !== sourceUrl ? pageUrl : null,
          id: stableId(source.id, sourceUrl, name),
          purchasePrice: price,
          sku: item.sku ?? offer?.sku ?? null,
          sourceCurrency: offer?.priceCurrency ?? item.priceCurrency ?? null,
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
  return dedupeSaleCampaigns(events, saleEventPriority, saleEventDedupeKey);
}

function saleEventPriority(event) {
  const scope = event.scope ?? event.saleScope;
  const scopeScore = scope === "sitewide" ? 5 : scope === "vinyl-wide" ? 4 : scope === "clearance" ? 3 : 2;
  const discountScore = event.discountPercent ?? event.saleDiscountPercent ?? (hasBogoSignal(event.signal ?? event.saleSignal) ? 45 : 0);
  return discountScore * 10 + scopeScore;
}

function saleEventDedupeKey(event) {
  const evidence = `${event.signal ?? event.saleSignal ?? ""} ${event.evidence ?? event.saleEvidence ?? ""}`;
  const offerType = hasBogoSignal(evidence)
    ? "bogo"
    : hasVolumeDiscountSignal(evidence)
      ? "volume"
      : hasCouponSignal(evidence)
        ? "coupon"
        : "sale";
  const promoCode = extractPromoCode(evidence) ?? "no-code";
  let url = String(event.sourceUrl ?? "");
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:fbclid|gclid|mc_cid|mc_eid|ref|source|utm_.+)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    url = parsed.toString().replace(/\/$/, "");
  } catch {
    // Keep the original source URL when it cannot be normalized.
  }
  return [
    event.sourceId ?? "unknown",
    url,
    event.scope ?? event.saleScope ?? "unknown",
    event.discountPercent ?? event.saleDiscountPercent ?? "none",
    offerType,
    promoCode,
  ].join("|");
}

function isLargeSaleSignal(text, source, evidenceUrl = source.url) {
  if (/\bexpired\b/i.test(text)) return false;
  if (
    (source.sourceType === "deal-aggregator" || source.sourceType === "social-feed") &&
    /^(?:filter\s+amazon(?:\s+vinyl\s+records?)?\s+by\s+price|(?:vinyl\s+)?records?\s+under\s+\$?\d+|vinyl\s+under\s+\$?\d+)$/i.test(
      cleanText(text),
    )
  ) {
    return false;
  }
  if (!hasVinylContext(text) && hasNonVinylSaleContext(text)) return false;
  if (!hasVinylContext(text) && !sourceIsVinylFocused({ ...source, url: evidenceUrl })) return false;
  const percent = extractMaxDiscountPercent(text);
  const largeDiscount = percent !== null && percent >= 30;
  const bogo = hasBogoSignal(text);
  const sourceIsKnownSalePage = isBroadSaleSource(source.id, source.name, evidenceUrl);
  const broad = hasBroadSaleScope(text) || sourceIsKnownSalePage || bogo;
  const priceThreshold = hasPriceThresholdSignal(text) && hasVinylContext(text);
  const coupon = hasCouponSignal(text) && (hasVinylContext(text) || sourceIsKnownSalePage);
  const salePageSignal = sourceIsKnownSalePage && hasSalePageSignal(text);
  return (largeDiscount || bogo || coupon || priceThreshold || hasVolumeDiscountSignal(text) || salePageSignal) && broad;
}

function hasBogoSignal(text) {
  return hasBogoOfferSignal(text);
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
  return (
    hasBogoSignal(text) ||
    /\b(?:buy\s+more\s+save\s+more|buy\s+2\s+get\s+(?:one|1)|spend\s+\$?\d+\s+(?:get|save))\b/i.test(text)
  );
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
  const contentSignature = cleanText(rawSignal)
    .toLowerCase()
    .replace(/\b(?:today|now|currently|limited\s+time)\b/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  return stableId("sale-fingerprint", source.id, path, scope, discountPercent ?? "none", offerType, promoCode, contentSignature);
}

function loadPreviousScanState(outputDir) {
  const preferredUrls = new Map();
  if (!existsSync(outputDir)) return { preferredUrls, saleCampaignLedger: null };

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

  return {
    preferredUrls,
    saleCampaignLedger: latest?.payload ? saleCampaignLedgerFromPayload(latest.payload) : null,
  };
}

function enrichCandidate(candidate, index) {
  const sourceMetadata = sourceMetadataById.get(candidate.sourceId);
  const sourceCurrency =
    normalizeCurrency(candidate.sourceCurrency) ?? defaultCurrencyForCountry(sourceMetadata?.country);
  const compMatch = index ? bestCompMatch(candidate, index.comps) : null;
  const artistAggregate = index ? bestArtistAggregateMatch(candidate, index.artistAggregates) : null;
  const notes = [];
  const { metrics: conditionMetrics, soldEvidence } = buildLocalSoldEvidence(compMatch, index, {
    candidate,
    condition: "new_sealed",
    referenceAt: capturedAt,
  });
  const averageSoldPrice = conditionMetrics?.averageSoldFor ?? null;
  const averageSoldShipping = conditionMetrics?.averageShipping ?? null;
  const totalSoldCount = conditionMetrics?.unitsSold ?? null;
  const conditionCounts = compMatch?.comp.conditionCounts;

  if (compMatch) {
    notes.push(
      conditionMetrics
        ? `Local new/sealed sold-history match ${(compMatch.matchScore * 100).toFixed(0)}%: ${conditionMetrics.unitsSold} units, avg total $${conditionMetrics.averageTotal.toFixed(2)}, 25th percentile $${conditionMetrics.priceP25.toFixed(2)}.`
        : `Local sold-history title match ${(compMatch.matchScore * 100).toFixed(0)}%, but no condition-matched new/sealed transactions were found.`,
    );
    notes.push(
      `Condition evidence: ${conditionCounts?.new_sealed ?? 0} new/sealed, ${conditionCounts?.used ?? 0} used, ${conditionCounts?.unknown ?? 0} unknown; latest condition-matched sale ${conditionMetrics?.latestSaleDate ?? "n/a"}.`,
    );
    notes.push("Local CSV history is this account's own sales and does not prove repeat sales by one marketplace seller.");
    if (soldEvidence?.artistMatchConfirmed === false) {
      notes.push(`Local sold-history artist evidence was downgraded: ${soldEvidence.artistMismatchReasons.join(", ")}.`);
    }
    if (soldEvidence?.editionMatchConfirmed === false) {
      notes.push(`Local sold-history edition evidence was downgraded: ${soldEvidence.editionMismatchReasons.join(", ")}.`);
    }
  } else {
    notes.push("No strong local sold-history match; eBay Product Research needed.");
  }
  if (artistAggregate) {
    notes.push(
      `Own-account artist history: ${artistAggregate.unitsSold365Days ?? 0} units in the last year across ${artistAggregate.distinctReleaseCount ?? "unknown"} releases. This is a weak evergreen prior, not proof that this pressing will sell.`,
    );
  }

  if (candidate.sourceOriginalPrice && candidate.sourceOriginalPrice > candidate.purchasePrice) {
    notes.push(
      `Discovery source listed a previous price of ${formatSourcePrice(candidate.sourceOriginalPrice, sourceCurrency)}${candidate.sourceDiscountPercent ? ` (${candidate.sourceDiscountPercent}% drop)` : ""}.`,
    );
  }
  if (candidate.discoveryUrl && candidate.discoveryUrl !== candidate.sourceUrl) {
    notes.push(`Discovery evidence: ${candidate.discoveryUrl}`);
  }
  if (candidate.sourcePublishedAt) notes.push(`Discovery source published this deal at ${candidate.sourcePublishedAt}.`);
  if (candidate.walmartAvailabilityVerificationSource === "product_page") {
    notes.push("Walmart availability was rechecked on the product page after the search catalog reported stale or location-default stock.");
  } else if (candidate.sourceId === "walmart") {
    notes.push("Walmart availability came from the structured search catalog; confirm the signed-in delivery or pickup location before purchasing.");
  }
  notes.push(
    `Source scan captured this at ${formatSourcePrice(candidate.purchasePrice, sourceCurrency)} before tax/shipping adjustments.`,
  );

  return {
    ...candidate,
    ...sourceMetadataForCandidate(sourceMetadata),
    activeListingCount: null,
    artistSoldUnits365Days: artistAggregate?.unitsSold365Days ?? null,
    artistSoldUnits1095Days: null,
    averageSoldPrice,
    averageSoldShipping,
    capturedAt,
    ebayResearchUrl: ebayResearchUrl(candidate),
    ebayResearchKeywordVariants: researchKeywordVariants(candidate),
    lowestActivePrice: null,
    notes,
    oneSellerSoldCount: null,
    soldEvidence,
    sourceCurrency,
    totalSoldCount,
  };
}

function bestArtistAggregateMatch(candidate, aggregates) {
  if (!Array.isArray(aggregates) || aggregates.length === 0) return null;
  const artist = normalizeSoldText(candidate.artist ?? "");
  if (!artist || artist === "unknown artist") return null;
  return aggregates.find((aggregate) => aggregate.normalizedArtist === artist) ?? null;
}

function sourceMetadataForCandidate(source) {
  if (!source) return {};
  return {
    sourceCountry: source.country ?? null,
    sourceDefaultDiscountThreshold: source.defaultDiscountThreshold ?? null,
    sourceDomain: source.domain ?? null,
    sourceGroup: source.group ?? null,
    sourceMinNetProfit: source.minNetProfit ?? null,
    sourceMinROI: source.minROI ?? null,
    sourceNoiseLevel: source.noiseLevel ?? null,
    sourcePriority: source.priority ?? null,
    sourceRetailType: source.retailSourceType ?? null,
    sourceSaleLikelihood: source.saleLikelihood ?? null,
  };
}

function normalizeCurrency(value) {
  const currency = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function defaultCurrencyForCountry(value) {
  const country = String(value ?? "").trim().toUpperCase();
  if (["US", "USA", "UNITED STATES"].includes(country)) return "USD";
  if (["UK", "GB", "UNITED KINGDOM"].includes(country)) return "GBP";
  if (["CA", "CANADA"].includes(country)) return "CAD";
  if (["AU", "AUSTRALIA"].includes(country)) return "AUD";
  if (["JP", "JAPAN"].includes(country)) return "JPY";
  if (["EU", "EUROPEAN UNION"].includes(country)) return "EUR";
  return null;
}

function formatSourcePrice(value, currency) {
  return `${currency ?? "currency unknown"} ${Number(value).toFixed(2)}`;
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
    const conditionBoost = (comp.conditionCounts?.new_sealed ?? comp.conditionMetrics?.new_sealed?.unitsSold ?? 0) > 0 ? 0.05 : 0;
    const adjustedScore = score + conditionBoost;
    if (!best || adjustedScore > best.matchScore) {
      best = { comp, matchScore: adjustedScore };
    }
  }

  if (!best || best.matchScore < 0.65) return null;
  return best;
}

async function fetchPage(url, options = {}) {
  const { headers: additionalHeaders = {}, ...requestOptions } = options;
  const response = await scheduledFetch(url, {
    ...requestOptions,
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      ...additionalHeaders,
    },
    redirect: requestOptions.redirect ?? "follow",
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
    setCookies:
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie")]
          : [],
    status: response.status,
    url: response.url || url,
  };
}

function summarize(finds, reports) {
  const byDecision = { BUY: 0, REVIEW: 0, REJECT: 0, WATCH: 0 };
  for (const find of finds) {
    const decision = find.status ?? (find.opportunityType === "sitewide_sale" ? "WATCH" : "REVIEW");
    byDecision[decision] += 1;
  }

  return {
    byDecision,
    candidateCount: allCandidates.length,
    includedProductFindCount: finds.filter((find) => find.opportunityType !== "sitewide_sale").length,
    findCount: finds.length,
    saleEventCount: allSaleEvents.length,
    scanMode,
    sourceCount: reports.length,
    highSignalCandidateCount: reports.reduce(
      (total, report) => total + Number(report.highSignalCandidateCount ?? 0),
      0,
    ),
    ownHistoryMatchedCandidateCount: reports.reduce(
      (total, report) => total + Number(report.ownHistoryMatchedCandidateCount ?? 0),
      0,
    ),
    selectedProductFindCount: reports.reduce(
      (total, report) => total + Number(report.selectedProductFindCount ?? 0),
      0,
    ),
    sourcesWithCatalogCoverage: reports.filter((report) => ["healthy", "partial"].includes(report.catalogHealth)).length,
    sourcesWithCandidates: reports.filter((report) => report.candidateCount > 0).length,
    sourcesWithErrors: reports.filter((report) => report.status === "error").length,
    sourcesWithHighSignalCandidates: reports.filter(
      (report) => Number(report.highSignalCandidateCount) > 0,
    ).length,
    sourcesWithParserEmptyProductCoverage: reports.filter(
      (report) => report.productParseHealth === "empty",
    ).length,
    sourcesWithProductParseFailures: reports.filter(
      (report) => report.productParseHealth === "failed",
    ).length,
    sourcesWithProductiveParsing: reports.filter(
      (report) => report.productParseHealth === "productive",
    ).length,
    sourcesWithSalePageCoverage: reports.filter((report) => ["healthy", "partial"].includes(report.salePageHealth)).length,
    sourcesWithSalePageFailures: reports.filter((report) => report.salePageHealth === "failed").length,
    sourcesWithSaleEvents: reports.filter((report) => report.saleEventCount > 0).length,
    sourcesWithSelectedProductFinds: reports.filter(
      (report) => Number(report.selectedProductFindCount) > 0,
    ).length,
    sourcesWithUsableProductCoverage: reports.filter((report) =>
      ["selected", "high_signal"].includes(report.usableCoverage),
    ).length,
  };
}

function runSoldHistorySyncIfConfigured() {
  if (skipEbaySync) {
    return {
      reason: "Disabled by --skipEbaySync, --skip-ebay-sync, or --ebaySync=false.",
      status: "skipped",
    };
  }

  const hasStaticAccessToken = Boolean(process.env.EBAY_USER_ACCESS_TOKEN);
  const hasRefreshCredentials = Boolean(
    process.env.EBAY_CLIENT_ID &&
      process.env.EBAY_CLIENT_SECRET &&
      process.env.EBAY_USER_REFRESH_TOKEN,
  );
  if (!hasStaticAccessToken && !hasRefreshCredentials) {
    return {
      reason:
        "Missing EBAY_USER_ACCESS_TOKEN or the EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_USER_REFRESH_TOKEN refresh credential set.",
      status: "skipped",
    };
  }

  const result = spawnSync(
    process.execPath,
    [
      join(WORKSPACE, "scripts", "syncEbaySoldHistory.mjs"),
      "--lookback-days=730",
      "--refresh-overlap-days=14",
    ],
    {
      cwd: WORKSPACE,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 5,
      timeout: soldHistorySyncTimeoutMs,
      windowsHide: true,
    },
  );

  if (result.status === 0) {
    const state = readJsonFileIfPresent(
      join(WORKSPACE, "exports", "sold-history", "sync-state.json"),
    );
    const index = readJsonFileIfPresent(SOLD_INDEX_PATH);
    return {
      asOf: index?.asOf ?? state?.lastSuccessfulTo ?? null,
      lastSuccessfulAt: state?.lastSuccessfulAt ?? null,
      range: state
        ? {
            from: state.lastSuccessfulFrom ?? null,
            to: state.lastSuccessfulTo ?? null,
          }
        : null,
      recordCount: index?.recordCount ?? null,
      status: "synced",
      stdout: tailLines(result.stdout, 4),
      unitCount: index?.unitCount ?? null,
    };
  }

  const processError =
    result.error instanceof Error
      ? result.error.message
      : result.error
        ? String(result.error)
        : "";
  return {
    error:
      processError ||
      tailLines(result.stderr || result.stdout, 8) ||
      `eBay sold-history sync exited without completing${result.signal ? ` (${result.signal})` : ""}.`,
    exitCode: result.status,
    signal: result.signal ?? undefined,
    status: "failed",
    timedOut: result.error?.code === "ETIMEDOUT",
    timeoutMs: soldHistorySyncTimeoutMs,
    usedExistingIndex: existsSync(SOLD_INDEX_PATH),
  };
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
      timeout: activeEnrichmentTimeoutMs,
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

  const processError = result.error instanceof Error
    ? result.error.message
    : result.error
      ? String(result.error)
      : "";
  return {
    error:
      processError ||
      tailLines(result.stderr || result.stdout, 8) ||
      `Active eBay enrichment exited without completing${result.signal ? ` (${result.signal})` : ""}.`,
    exitCode: result.status,
    maxQueries: maxActiveQueries,
    signal: result.signal ?? undefined,
    status: "failed",
    timedOut: result.error?.code === "ETIMEDOUT",
    timeoutMs: activeEnrichmentTimeoutMs,
  };
}

function tailLines(text, count) {
  return String(text ?? "")
    .trim()
    .split(/\r?\n/)
    .slice(-count)
    .join("\n");
}

function readJsonFileIfPresent(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isFinalDealSource(sourceId, sourceName, sourceUrl) {
  return /\b(?:final|clearance|closeout|super-sale|super\s+sale|deep-cuts|deep\s+cuts|deep-discount|deep\s+discount|on-sale|on\s+sale|deals?|daily-deal|specials?|special-price|price-drop|price\s+drop|cheap-vinyl|cheap\s+vinyl|slickdeals|discount|warehouse|overstock|garage|volume-sale|buy-more-save-more|under-?1?[0459]9?9?)\b/i.test(
    `${sourceId} ${sourceName} ${sourceUrl}`,
  );
}

function isBroadSaleSource(sourceId, sourceName, sourceUrl) {
  return /\b(?:sitewide|storewide|50-off|30-80|buy-more-save-more|warehouse|overstock|clearance|super-sale|super\s+sale|special-price|garage-sale|garage\s+sale|under-?1?[0459]9?9?|4\+)\b/i.test(
    `${sourceId} ${sourceName} ${sourceUrl}`,
  );
}

function opportunitySortPriority(find) {
  if (find.status === "BUY") return 5;
  if (find.opportunityType === "sitewide_sale") return 4;
  if (find.status === "WATCH") return 3;
  if (find.status === "REVIEW") return 2;
  if (find.status === "REJECT") return 1;
  return 0;
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
  const raw = String(value).trim();
  if (/^[0-9]+(?:\.[0-9]{1,2})?$/.test(raw)) {
    const direct = Number(raw);
    return Number.isFinite(direct) ? direct : null;
  }
  return parsePrices(raw)[0] ?? null;
}

function parsePrices(value) {
  return [
    ...String(value).matchAll(/(?:\$|USD\s*)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/gi),
  ]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter(Number.isFinite);
}

function inferArtist(text) {
  return inferRetailArtist(text);
}

function inferTitle(text) {
  return inferRetailTitle(text);
}

function cleanProductTitle(text) {
  return cleanText(
    text
      .replace(/\bbest\s+seller\b/gi, " ")
      .replace(/\b(?:vinyl|lp|record|records|album)\b/gi, " ")
      .replace(/\b(?:sale|deal|clearance|limited|edition|exclusive|colored|colour|color)\b/gi, " "),
  );
}

function cleanText(text) {
  return decodeHtmlEntities(text)
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
  return /\b(?:vinyl|record|records|(?:[1-9]\s*(?:[x\u00d7-]\s*)?)?lp|(?:7|10|12)\s*(?:inch|in\.|["”']))\b/i.test(String(text ?? ""));
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

function parsePositiveNumber(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
