import { getEbayApplicationToken } from "../../scripts/lib/ebayPurchaseDiscovery.mjs";
import { classifyVinylLot } from "../lib/vinylLots/classifyLot.js";
import {
  normalizeVinylLotScanRequest,
  VINYL_LOT_COVERAGE_TARGET,
  VINYL_LOT_RESULT_TTL_MS,
  type NormalizedVinylLotScanRequest,
  type VinylLotScanRequest,
} from "../lib/vinylLots/scanOptions.js";
import type { VinylLotClassification, VinylLotTargetGenre } from "../lib/vinylLots/types.js";

export const VINYL_LOT_CATEGORY_ID = "176985";
export const VINYL_LOT_MAX_BROWSE_CALLS = 20;
export const VINYL_LOT_DEFAULT_CONCURRENCY = 4;
export const VINYL_LOT_DEFAULT_PAGE_SIZE = 50;
export const VINYL_LOT_DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export const VINYL_LOT_DEFAULT_SCAN_TIMEOUT_MS = 50_000;

let cachedVinylLotApplicationToken: { expiresAt: number; token: string } | null = null;

export type VinylLotSearchFamily = {
  artistName?: string;
  id: string;
  label: string;
  phase: "artist" | "fallback" | "primary";
  query: string;
  targetGenre: VinylLotTargetGenre;
};

export const VINYL_LOT_SEARCH_FAMILIES: readonly VinylLotSearchFamily[] = Object.freeze([
  Object.freeze({
    id: "hip-hop-collection",
    label: "Hip-hop",
    phase: "primary" as const,
    query: "hip hop vinyl collection",
    targetGenre: "hip-hop" as const,
  }),
  Object.freeze({
    id: "hip-hop-lot",
    label: "Hip-hop",
    phase: "primary" as const,
    query: "rap LP record lot",
    targetGenre: "hip-hop" as const,
  }),
  Object.freeze({
    id: "classic-rock-collection",
    label: "Classic rock",
    phase: "primary" as const,
    query: "classic rock vinyl collection",
    targetGenre: "classic-rock" as const,
  }),
  Object.freeze({
    id: "classic-rock-lot",
    label: "Classic rock",
    phase: "primary" as const,
    query: "rock LP record lot",
    targetGenre: "classic-rock" as const,
  }),
  Object.freeze({
    id: "1990s-rock-collection",
    label: "1990s alternative rock",
    phase: "primary" as const,
    query: "90s rock vinyl collection",
    targetGenre: "1990s-rock" as const,
  }),
  Object.freeze({
    id: "1990s-rock-lot",
    label: "1990s alternative rock",
    phase: "primary" as const,
    query: "grunge alternative LP lot",
    targetGenre: "1990s-rock" as const,
  }),
  Object.freeze({
    id: "instrumental-jazz-collection",
    label: "Instrumental jazz",
    phase: "primary" as const,
    query: "jazz vinyl collection",
    targetGenre: "instrumental-jazz" as const,
  }),
  Object.freeze({
    id: "instrumental-jazz-lot",
    label: "Instrumental jazz",
    phase: "primary" as const,
    query: "hard bop LP record lot",
    targetGenre: "instrumental-jazz" as const,
  }),
]);

const FALLBACK_QUERY_BY_GENRE: Record<VinylLotTargetGenre, string> = {
  "hip-hop": "hip hop record collection estate",
  "classic-rock": "vintage rock record collection",
  "1990s-rock": "1990s indie rock records collection",
  "instrumental-jazz": "Blue Note Prestige jazz collection",
};

export type VinylLotDiscoveryEnv = {
  EBAY_APP_ACCESS_TOKEN?: string;
  EBAY_APPLICATION_ACCESS_TOKEN?: string;
  EBAY_BROWSE_ACCESS_TOKEN?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_ENV?: string;
  EBAY_MARKETPLACE_ID?: string;
};

export type VinylLotMoney = {
  currency: string;
  value: string;
};

export type VinylLotListingObservation = {
  buyingOptions: string[];
  classification: VinylLotClassification;
  condition: string | null;
  conditionId: string | null;
  imageUrl: string | null;
  itemCreationDate: string | null;
  itemId: string;
  itemLocationCountry: string | null;
  itemLocationRegion: string | null;
  itemWebUrl: string | null;
  matchedGenres: VinylLotTargetGenre[];
  matchedSearchFamilyIds: string[];
  price: VinylLotMoney | null;
  seller: {
    feedbackPercentage: string | null;
    feedbackScore: number | null;
    username: string | null;
  } | null;
  shippingCost: VinylLotMoney | null;
  shortDescription: string | null;
  title: string;
};

export type VinylLotFamilyDiagnostic = {
  error: string | null;
  httpStatus: number | null;
  id: string;
  label: string;
  phase: VinylLotSearchFamily["phase"];
  query: string;
  returnedCount: number;
  status: "available" | "error";
  targetGenre: VinylLotTargetGenre;
  totalReported: number | null;
  warnings: string[];
};

export type VinylLotGenreCoverage = {
  displayedCount: number;
  genre: VinylLotTargetGenre;
  label: string;
  rawUniqueCount: number;
  retainedCount: number;
  status: "ok" | "shortfall";
  targetCount: typeof VINYL_LOT_COVERAGE_TARGET;
};

export type VinylLotDiscoveryResult = {
  categoryId: typeof VINYL_LOT_CATEGORY_ID;
  complete: boolean;
  diagnostics: {
    classificationCounts: Record<"near-match" | "qualifying" | "rejected" | "review", number>;
    duplicateCount: number;
    duplicateTitleCount: number;
    families: VinylLotFamilyDiagnostic[];
    genreCoverage: VinylLotGenreCoverage[];
    invalidSummaryCount: number;
    limits: {
      concurrency: number;
      maxBrowseCalls: typeof VINYL_LOT_MAX_BROWSE_CALLS;
      pageSize: number;
      requestTimeoutMs: number;
      scanTimeoutMs: number;
    };
    rawSummaryCount: number;
    requestsMade: number;
    requestMode: "bounded-concurrent";
  };
  evidenceScope: "active_ebay_listings_only";
  expiresAt: string;
  filters: {
    buyingOptions: ["FIXED_PRICE", "BEST_OFFER"];
    condition: "USED";
    fieldgroups: ["EXTENDED"];
    itemLocationCountry: "US";
    sort: "newlyListed";
  };
  listings: VinylLotListingObservation[];
  marketplaceId: string;
  observedAt: string;
  scanOptions: NormalizedVinylLotScanRequest;
  schemaVersion: 2;
  soldDataIncluded: false;
  source: "ebay-browse";
  storage: "transient-no-persistence";
  warnings: string[];
};

export type VinylLotScanOptions = {
  accessToken?: string;
  classifier?: typeof classifyVinylLot;
  clock?: () => Date;
  concurrency?: number;
  endpointRoot?: string;
  families?: readonly VinylLotSearchFamily[];
  fetchImpl?: typeof fetch;
  pageSize?: number;
  requestTimeoutMs?: number;
  scanTimeoutMs?: number;
  scanRequest?: VinylLotScanRequest | unknown;
  signal?: AbortSignal;
  tokenProvider?: typeof getEbayApplicationToken;
};

type EbayItemSummary = Record<string, unknown>;

type EbayBrowsePayload = {
  errors?: Array<{ longMessage?: string; message?: string }>;
  itemSummaries?: unknown[];
  total?: number;
  warnings?: Array<{ longMessage?: string; message?: string }>;
};

type FamilyFetchResult = {
  attempted: boolean;
  diagnostic: VinylLotFamilyDiagnostic;
  family: VinylLotSearchFamily;
  summaries: EbayItemSummary[];
};

export class VinylLotDiscoveryError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "VinylLotDiscoveryError";
    this.statusCode = statusCode;
  }
}

export async function scanVinylLots(
  env: VinylLotDiscoveryEnv,
  options: VinylLotScanOptions = {},
): Promise<VinylLotDiscoveryResult> {
  const clock = options.clock ?? (() => new Date());
  const observedDate = clock();
  if (Number.isNaN(observedDate.getTime())) throw new VinylLotDiscoveryError("Invalid vinyl-lot scan clock.", 500);

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new VinylLotDiscoveryError("No fetch implementation is available.", 500);

  const scanRequest = normalizeVinylLotScanRequest(options.scanRequest);
  const injectedFamilies = options.families ? normalizeFamilies(options.families) : null;
  const primaryFamilies = injectedFamilies ?? buildPrimaryFamilies(scanRequest);
  const concurrency = boundedInteger(options.concurrency, VINYL_LOT_DEFAULT_CONCURRENCY, 1, VINYL_LOT_MAX_BROWSE_CALLS);
  const pageSize = boundedInteger(options.pageSize, VINYL_LOT_DEFAULT_PAGE_SIZE, 1, VINYL_LOT_DEFAULT_PAGE_SIZE);
  const requestTimeoutMs = boundedInteger(
    options.requestTimeoutMs,
    VINYL_LOT_DEFAULT_REQUEST_TIMEOUT_MS,
    500,
    8_000,
  );
  const scanTimeoutMs = boundedInteger(
    options.scanTimeoutMs,
    VINYL_LOT_DEFAULT_SCAN_TIMEOUT_MS,
    100,
    VINYL_LOT_DEFAULT_SCAN_TIMEOUT_MS,
  );
  const scanDeadlineSignal = AbortSignal.timeout(scanTimeoutMs);
  const scanSignal = options.signal
    ? AbortSignal.any([options.signal, scanDeadlineSignal])
    : scanDeadlineSignal;
  const endpointRoot = cleanEndpoint(options.endpointRoot ?? ebayEndpointRoot(env.EBAY_ENV));
  const marketplaceId = cleanText(env.EBAY_MARKETPLACE_ID) ?? "EBAY_US";
  const accessToken = await resolveAccessToken(env, {
    accessToken: options.accessToken,
    endpointRoot,
    fetchImpl,
    requestTimeoutMs,
    signal: scanSignal,
    tokenProvider: options.tokenProvider,
  });

  const fetchOptions = {
    accessToken,
    endpointRoot,
    fetchImpl,
    marketplaceId,
    pageSize,
    requestTimeoutMs,
    signal: scanSignal,
  };
  const primaryResults = await fetchFamilyBatch(primaryFamilies, concurrency, fetchOptions);
  assertAnyFamilyAvailable(primaryResults, scanDeadlineSignal.aborted);
  const classifier = options.classifier ?? classifyVinylLot;
  const primaryClassified = classifyFamilyResults(primaryResults, classifier, scanRequest);
  const shortfallGenres = scanRequest.genres.filter(
    (genre) => retainedCountForGenre(primaryClassified.listings, genre) < VINYL_LOT_COVERAGE_TARGET,
  );
  const expansionFamilies = injectedFamilies
    ? []
    : buildExpansionFamilies(scanRequest, shortfallGenres).slice(
        0,
        Math.max(0, VINYL_LOT_MAX_BROWSE_CALLS - primaryFamilies.length),
      );
  const expansionResults = expansionFamilies.length > 0
    ? await fetchFamilyBatch(expansionFamilies, concurrency, fetchOptions)
    : [];
  const familyResults = [...primaryResults, ...expansionResults];
  const classified = expansionResults.length > 0
    ? classifyFamilyResults(familyResults, classifier, scanRequest)
    : primaryClassified;
  const listings = selectListingsForDisplay(classified.listings, scanRequest);
  const genreCoverage = buildGenreCoverage(classified, listings, scanRequest);

  const failedFamilies = familyResults.filter((result) => result.diagnostic.status === "error");
  const coverageShortfalls = genreCoverage.filter((coverage) => coverage.status === "shortfall");
  const warnings = [
    ...(scanDeadlineSignal.aborted
      ? [`Vinyl-lot scan stopped at its ${scanTimeoutMs} ms runtime budget; coverage may be incomplete.`]
      : []),
    ...familyResults.flatMap((result) => result.diagnostic.warnings),
    ...failedFamilies.map((result) => `${result.family.label} search failed: ${result.diagnostic.error ?? "Unknown error"}`),
    ...coverageShortfalls.map((coverage) => `${coverage.label} retained ${coverage.retainedCount} of the required ${coverage.targetCount} collection candidates.`),
  ];

  return {
    categoryId: VINYL_LOT_CATEGORY_ID,
    complete: !scanDeadlineSignal.aborted && failedFamilies.length === 0 && coverageShortfalls.length === 0,
    diagnostics: {
      classificationCounts: classified.classificationCounts,
      duplicateCount: classified.merged.duplicateCount,
      duplicateTitleCount: classified.duplicateTitleCount,
      families: familyResults.map((result) => result.diagnostic),
      genreCoverage,
      invalidSummaryCount: classified.merged.invalidSummaryCount,
      limits: {
        concurrency,
        maxBrowseCalls: VINYL_LOT_MAX_BROWSE_CALLS,
        pageSize,
        requestTimeoutMs,
        scanTimeoutMs,
      },
      rawSummaryCount: classified.merged.rawSummaryCount,
      requestsMade: familyResults.filter((result) => result.attempted).length,
      requestMode: "bounded-concurrent",
    },
    evidenceScope: "active_ebay_listings_only",
    expiresAt: new Date(observedDate.getTime() + VINYL_LOT_RESULT_TTL_MS).toISOString(),
    filters: {
      buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
      condition: "USED",
      fieldgroups: ["EXTENDED"],
      itemLocationCountry: "US",
      sort: "newlyListed",
    },
    listings,
    marketplaceId,
    observedAt: observedDate.toISOString(),
    scanOptions: scanRequest,
    schemaVersion: 2,
    soldDataIncluded: false,
    source: "ebay-browse",
    storage: "transient-no-persistence",
    warnings: uniqueStrings(warnings),
  };
}

type ClassifiedFamilyResults = {
  classificationCounts: Record<"near-match" | "qualifying" | "rejected" | "review", number>;
  duplicateTitleCount: number;
  listings: VinylLotListingObservation[];
  merged: ReturnType<typeof mergeSummariesByItemId>;
};

function classifyFamilyResults(
  familyResults: FamilyFetchResult[],
  classifier: typeof classifyVinylLot,
  scanRequest: NormalizedVinylLotScanRequest,
): ClassifiedFamilyResults {
  const merged = mergeSummariesByItemId(familyResults);
  const classificationCounts = {
    "near-match": 0,
    qualifying: 0,
    rejected: 0,
    review: 0,
  } satisfies Record<"near-match" | "qualifying" | "rejected" | "review", number>;
  const listings: VinylLotListingObservation[] = [];
  const listingsByTitle = new Map<string, VinylLotListingObservation>();
  let duplicateTitleCount = 0;

  for (const observation of merged.observations) {
    const title = cleanText(observation.summary.title);
    if (!title) {
      merged.invalidSummaryCount += 1;
      continue;
    }
    const searchGenres = uniqueGenres(observation.families.map((family) => family.targetGenre));
    const classification = classifier({
      conditionText: cleanText(observation.summary.condition),
      excludeSinglesAndFortyFives: scanRequest.excludeSinglesAndFortyFives,
      includeUnknownCount: scanRequest.includeUnknownCount,
      minimumRecords: scanRequest.minimumRecords,
      priorityArtists: scanRequest.priorityArtists,
      searchGenre: searchGenres.length === 1 ? searchGenres[0] : null,
      shortDescription: cleanText(observation.summary.shortDescription),
      title,
    });
    classificationCounts[classification.status] += 1;
    if (classification.status === "rejected") continue;
    const listing = mapListingObservation(observation.summary, observation.families, title, classification);
    const titleKey = normalizedTitleKey(title);
    const existing = listingsByTitle.get(titleKey);
    if (existing) {
      duplicateTitleCount += 1;
      existing.matchedGenres = uniqueGenres([...existing.matchedGenres, ...listing.matchedGenres]);
      existing.matchedSearchFamilyIds = uniqueStrings([...existing.matchedSearchFamilyIds, ...listing.matchedSearchFamilyIds]);
      continue;
    }
    listingsByTitle.set(titleKey, listing);
    listings.push(listing);
  }

  listings.sort((left, right) => dateValue(right.itemCreationDate) - dateValue(left.itemCreationDate));
  return { classificationCounts, duplicateTitleCount, listings, merged };
}

function buildPrimaryFamilies(scanRequest: NormalizedVinylLotScanRequest): VinylLotSearchFamily[] {
  const selected = new Set(scanRequest.genres);
  return VINYL_LOT_SEARCH_FAMILIES.filter((family) => selected.has(family.targetGenre));
}

function buildExpansionFamilies(
  scanRequest: NormalizedVinylLotScanRequest,
  genres: VinylLotTargetGenre[],
): VinylLotSearchFamily[] {
  const expansions = genres.map((genre): VinylLotSearchFamily => {
    const fallbackQuery = scanRequest.customQueries[genre] ?? FALLBACK_QUERY_BY_GENRE[genre];
    return {
      id: `${genre}-fallback`,
      label: `${genreLabel(genre)} fallback`,
      phase: "fallback",
      query: fallbackQuery,
      targetGenre: genre,
    };
  });
  const artistsByGenre = new Map(genres.map((genre) => [
    genre,
    scanRequest.priorityArtists.filter((artist) => artist.genre === genre),
  ]));
  const nextIndexByGenre = new Map(genres.map((genre) => [genre, 0]));
  let remainingSlots = Math.max(0, VINYL_LOT_MAX_BROWSE_CALLS - buildPrimaryFamilies(scanRequest).length - expansions.length);

  while (remainingSlots > 0) {
    let addedThisRound = 0;
    for (const genre of genres) {
      if (remainingSlots <= 0) break;
      const index = nextIndexByGenre.get(genre) ?? 0;
      const artist = artistsByGenre.get(genre)?.[index];
      if (!artist) continue;
      expansions.push({
        artistName: artist.name,
        id: `${genre}-artist-${index + 1}-${slug(artist.name)}`,
        label: `${genreLabel(genre)} · ${artist.name}`,
        phase: "artist",
        query: `${artist.name} ${genre === "instrumental-jazz" ? "vinyl collection" : "record lot"}`,
        targetGenre: genre,
      });
      nextIndexByGenre.set(genre, index + 1);
      remainingSlots -= 1;
      addedThisRound += 1;
    }
    if (addedThisRound === 0) break;
  }
  return expansions;
}

async function fetchFamilyBatch(
  families: VinylLotSearchFamily[],
  concurrency: number,
  options: Parameters<typeof fetchFamily>[1],
): Promise<FamilyFetchResult[]> {
  return mapWithConcurrency(families, concurrency, async (family) => {
    if (options.signal?.aborted) {
      return {
        attempted: false,
        diagnostic: {
          error: "Search skipped because the vinyl-lot scan was canceled before it started.",
          httpStatus: null,
          id: family.id,
          label: family.label,
          phase: family.phase,
          query: family.query,
          returnedCount: 0,
          status: "error" as const,
          targetGenre: family.targetGenre,
          totalReported: null,
          warnings: [],
        },
        family,
        summaries: [],
      };
    }
    try {
      return await fetchFamily(family, options);
    } catch (error) {
      return {
        attempted: true,
        diagnostic: {
          error: errorMessage(error),
          httpStatus: errorStatus(error),
          id: family.id,
          label: family.label,
          phase: family.phase,
          query: family.query,
          returnedCount: 0,
          status: "error" as const,
          targetGenre: family.targetGenre,
          totalReported: null,
          warnings: [],
        },
        family,
        summaries: [],
      };
    }
  });
}

function assertAnyFamilyAvailable(familyResults: FamilyFetchResult[], scanDeadlineExceeded = false): void {
  if (familyResults.some((result) => result.diagnostic.status === "available")) return;
  if (scanDeadlineExceeded) {
    throw new VinylLotDiscoveryError(
      "Vinyl-lot scan runtime budget expired before any eBay Browse search completed.",
      504,
    );
  }
  const statuses = familyResults.map((result) => result.diagnostic.httpStatus).filter((status): status is number => status !== null);
  const statusCode = statuses.length > 0 && statuses.every((status) => status === 429) ? 429 : 502;
  throw new VinylLotDiscoveryError(
    familyResults.map((result) => result.diagnostic.error).filter(Boolean).join("; ") || "All eBay vinyl-lot searches failed.",
    statusCode,
  );
}

function buildGenreCoverage(
  classified: ClassifiedFamilyResults,
  displayedListings: VinylLotListingObservation[],
  scanRequest: NormalizedVinylLotScanRequest,
): VinylLotGenreCoverage[] {
  return scanRequest.genres.map((genre) => {
    const rawUniqueCount = classified.merged.observations.filter((observation) =>
      observation.families.some((family) => family.targetGenre === genre)).length;
    const retainedCount = retainedCountForGenre(classified.listings, genre);
    return {
      displayedCount: retainedCountForGenre(displayedListings, genre),
      genre,
      label: genreLabel(genre),
      rawUniqueCount,
      retainedCount,
      status: retainedCount >= VINYL_LOT_COVERAGE_TARGET ? "ok" : "shortfall",
      targetCount: VINYL_LOT_COVERAGE_TARGET,
    };
  });
}

function selectListingsForDisplay(
  listings: VinylLotListingObservation[],
  scanRequest: NormalizedVinylLotScanRequest,
): VinylLotListingObservation[] {
  const counts = new Map<VinylLotTargetGenre, number>();
  return listings.filter((listing) => {
    const eligibleGenres = listing.matchedGenres.filter((genre) => scanRequest.genres.includes(genre));
    if (!eligibleGenres.some((genre) => (counts.get(genre) ?? 0) < scanRequest.resultsPerGenre)) return false;
    eligibleGenres.forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
    return true;
  });
}

function retainedCountForGenre(listings: VinylLotListingObservation[], genre: VinylLotTargetGenre): number {
  return listings.filter((listing) => listing.matchedGenres.includes(genre)).length;
}

export function buildVinylLotSearchUrl(
  family: VinylLotSearchFamily,
  options: { endpointRoot?: string; pageSize?: number } = {},
): URL {
  const url = new URL("/buy/browse/v1/item_summary/search", cleanEndpoint(options.endpointRoot ?? "https://api.ebay.com"));
  url.searchParams.set("q", family.query);
  url.searchParams.set("category_ids", VINYL_LOT_CATEGORY_ID);
  url.searchParams.set(
    "filter",
    "conditions:{USED},buyingOptions:{FIXED_PRICE|BEST_OFFER},itemLocationCountry:US",
  );
  url.searchParams.set("fieldgroups", "EXTENDED");
  url.searchParams.set("sort", "newlyListed");
  url.searchParams.set("limit", String(boundedInteger(options.pageSize, VINYL_LOT_DEFAULT_PAGE_SIZE, 1, VINYL_LOT_DEFAULT_PAGE_SIZE)));
  return url;
}

async function resolveAccessToken(
  env: VinylLotDiscoveryEnv,
  options: {
    accessToken?: string;
    endpointRoot: string;
    fetchImpl: typeof fetch;
    requestTimeoutMs: number;
    signal?: AbortSignal;
    tokenProvider?: typeof getEbayApplicationToken;
  },
): Promise<string> {
  const injected = cleanText(options.accessToken);
  if (injected) return injected;

  const provider = options.tokenProvider ?? getEbayApplicationToken;
  if (
    provider === getEbayApplicationToken &&
    cachedVinylLotApplicationToken &&
    cachedVinylLotApplicationToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedVinylLotApplicationToken.token;
  }
  const result = await provider({
    endpointRoot: options.endpointRoot,
    env,
    fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  });
  if (!result.available) {
    throw new VinylLotDiscoveryError(result.reason, result.httpStatus === 429 ? 429 : 503);
  }
  if (provider === getEbayApplicationToken) {
    const lifetimeMs = Math.max(5 * 60_000, (result.expiresInSeconds ?? 30 * 60) * 1_000);
    cachedVinylLotApplicationToken = {
      expiresAt: Date.now() + lifetimeMs,
      token: result.token,
    };
  }
  return result.token;
}

async function fetchFamily(
  family: VinylLotSearchFamily,
  options: {
    accessToken: string;
    endpointRoot: string;
    fetchImpl: typeof fetch;
    marketplaceId: string;
    pageSize: number;
    requestTimeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<FamilyFetchResult> {
  const url = buildVinylLotSearchUrl(family, options);
  const response = await fetchWithTimeout(
    options.fetchImpl,
    url,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": options.marketplaceId,
      },
      signal: options.signal,
    },
    options.requestTimeoutMs,
  );
  const payload = await readEbayPayload(response);
  if (!response.ok) {
    throw new VinylLotDiscoveryError(
      payload.errors?.map((error) => cleanText(error.longMessage) ?? cleanText(error.message)).filter(Boolean).join("; ") ||
        `eBay Browse API failed (${response.status} ${response.statusText}).`,
      response.status,
    );
  }

  const summaries = Array.isArray(payload.itemSummaries)
    ? payload.itemSummaries.filter(isObject)
    : [];
  return {
    attempted: true,
    diagnostic: {
      error: null,
      httpStatus: response.status,
      id: family.id,
      label: family.label,
      phase: family.phase,
      query: family.query,
      returnedCount: summaries.length,
      status: "available",
      targetGenre: family.targetGenre,
      totalReported: nonNegativeInteger(payload.total),
      warnings:
        payload.warnings
          ?.map((warning) => cleanText(warning.longMessage) ?? cleanText(warning.message))
          .filter((warning): warning is string => Boolean(warning)) ?? [],
    },
    family,
    summaries,
  };
}

function mergeSummariesByItemId(results: FamilyFetchResult[]): {
  duplicateCount: number;
  invalidSummaryCount: number;
  observations: Array<{ families: VinylLotSearchFamily[]; summary: EbayItemSummary }>;
  rawSummaryCount: number;
} {
  const byItemId = new Map<string, { families: VinylLotSearchFamily[]; summary: EbayItemSummary }>();
  const observations: Array<{ families: VinylLotSearchFamily[]; summary: EbayItemSummary }> = [];
  let duplicateCount = 0;
  let invalidSummaryCount = 0;
  let rawSummaryCount = 0;

  for (const result of results) {
    for (const summary of result.summaries) {
      rawSummaryCount += 1;
      const itemId = cleanText(summary.itemId);
      if (!itemId) {
        invalidSummaryCount += 1;
        continue;
      }
      const existing = byItemId.get(itemId);
      if (existing) {
        duplicateCount += 1;
        if (!existing.families.some((family) => family.id === result.family.id)) existing.families.push(result.family);
        continue;
      }
      const observation = { families: [result.family], summary };
      byItemId.set(itemId, observation);
      observations.push(observation);
    }
  }

  return { duplicateCount, invalidSummaryCount, observations, rawSummaryCount };
}

function mapListingObservation(
  summary: EbayItemSummary,
  families: VinylLotSearchFamily[],
  title: string,
  classification: VinylLotClassification,
): VinylLotListingObservation {
  const seller = isObject(summary.seller) ? summary.seller : null;
  const itemLocation = isObject(summary.itemLocation) ? summary.itemLocation : null;
  const image = isObject(summary.image) ? summary.image : null;
  const shippingOptions = Array.isArray(summary.shippingOptions) ? summary.shippingOptions.filter(isObject) : [];
  const firstShipping = shippingOptions.find((option) => isObject(option.shippingCost));

  return {
    buyingOptions: stringArray(summary.buyingOptions),
    classification,
    condition: cleanText(summary.condition),
    conditionId: cleanText(summary.conditionId),
    imageUrl: cleanText(image?.imageUrl),
    itemCreationDate: cleanText(summary.itemOriginDate) ?? cleanText(summary.itemCreationDate),
    itemId: cleanText(summary.itemId) as string,
    itemLocationCountry: cleanText(itemLocation?.country),
    itemLocationRegion: cleanText(itemLocation?.stateOrProvince),
    itemWebUrl: cleanText(summary.itemWebUrl),
    matchedGenres: uniqueGenres(families.map((family) => family.targetGenre)),
    matchedSearchFamilyIds: families.map((family) => family.id),
    price: mapMoney(summary.price),
    seller: seller
      ? {
          feedbackPercentage: cleanText(seller.feedbackPercentage),
          feedbackScore: nonNegativeInteger(seller.feedbackScore),
          username: cleanText(seller.username),
        }
      : null,
    shippingCost: firstShipping ? mapMoney(firstShipping.shippingCost) : null,
    shortDescription: cleanText(summary.shortDescription),
    title,
  };
}

function mapMoney(value: unknown): VinylLotMoney | null {
  if (!isObject(value)) return null;
  const amount = cleanText(value.value);
  const currency = cleanText(value.currency);
  return amount && currency ? { currency, value: amount } : null;
}

async function readEbayPayload(response: Response): Promise<EbayBrowsePayload> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) throw new Error("response is not an object");
    return parsed as EbayBrowsePayload;
  } catch {
    throw new VinylLotDiscoveryError("eBay Browse API returned invalid JSON.", 502);
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`eBay Browse request timed out after ${timeoutMs}ms.`)), timeoutMs);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeFamilies(families: readonly VinylLotSearchFamily[]): VinylLotSearchFamily[] {
  const normalized = families
    .slice(0, VINYL_LOT_MAX_BROWSE_CALLS)
    .filter((family) => cleanText(family.id) && cleanText(family.label) && cleanText(family.query));
  if (normalized.length === 0) throw new VinylLotDiscoveryError("At least one vinyl-lot search family is required.", 400);
  return normalized;
}

function ebayEndpointRoot(environment: string | undefined): string {
  return environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function cleanEndpoint(value: string): string {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(cleanText).filter((item): item is string => Boolean(item)) : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanText(value)).filter((value): value is string => Boolean(value)))];
}

function uniqueGenres(values: VinylLotTargetGenre[]): VinylLotTargetGenre[] {
  return [...new Set(values)];
}

function genreLabel(genre: VinylLotTargetGenre): string {
  if (genre === "hip-hop") return "Hip-hop";
  if (genre === "classic-rock") return "Classic rock";
  if (genre === "1990s-rock") return "1990s rock";
  return "Instrumental jazz";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "artist";
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedTitleKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? Math.floor(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown eBay Browse API error";
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  const status = Number(error.statusCode);
  return Number.isInteger(status) ? status : null;
}
