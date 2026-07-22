import { isMarketplaceNonRecordTitle } from "../../src/lib/arbitrage/marketplaceProductClassification.mjs";

export const EBAY_VINYL_CATEGORY_ID = "176985";
export const EBAY_PURCHASE_SOURCE_ID = "ebay-purchase";
export const DEFAULT_EBAY_MIN_SELLER_FEEDBACK_SCORE = 25;
export const DEFAULT_EBAY_MIN_SELLER_FEEDBACK_PERCENTAGE = 97;

export function ebayPurchaseOfferVerification(candidate) {
  return candidate?.shippingDestinationVerified === true &&
    candidate?.productIdentityVerification === "detail_aspects"
    ? "official_api"
    : "discovery_lead";
}

export function assessEbayPurchaseDetail(detail) {
  if (!isObject(detail)) {
    return { evidence: [], reason: "detail_missing", status: "unknown" };
  }
  const aspects = (Array.isArray(detail.localizedAspects) ? detail.localizedAspects : [])
    .flatMap((aspect) => {
      const name = cleanText(aspect?.name);
      const values = uniqueStrings([
        ...stringArray(aspect?.value),
        cleanText(aspect?.value),
      ]);
      return name && values.length > 0 ? values.map((value) => ({ name, value })) : [];
    });
  const evidence = aspects.map((aspect) => `${aspect.name}: ${aspect.value}`);
  const identityAspects = aspects.filter((aspect) =>
    /^(?:format|material|record format|type|product type|item type)$/i.test(aspect.name),
  );
  const identityText = normalizeWords(identityAspects.map((aspect) => aspect.value).join(" "));
  const allAspectValueText = normalizeWords(
    aspects.map((aspect) => `${aspect.name} ${aspect.value}`).join(" "),
  );
  const detailTitleText = normalizeWords(cleanText(detail.title) ?? "");
  const descriptionText = normalizeWords(
    `${cleanText(detail.shortDescription) ?? ""} ${cleanText(detail.description) ?? ""}`,
  );
  const accessoryText = `${detailTitleText} ${allAspectValueText} ${descriptionText}`.trim();
  const accessorySignal = /\b(?:decal|sticker|non\s+adhesive\s+label|paper\s+label|label\s+decal|replacement\s+(?:sleeve|jacket|cover)|sleeve\s+only|jacket\s+only|cover\s+only|record\s+mailer|record\s+protector|record\s+cleaning|cleaning\s+(?:brush|cloth|fluid|kit)|record\s+(?:weight|stabilizer|clamp|divider|storage|display|frame|bowl)|turntable\s+(?:platter\s+)?mat|platter\s+mat|mat\s+for\s+(?:a\s+)?turntables?|record\s+mat|lp\s+mat|slipmat|replica\s+record|miniature\s+record|wall\s+(?:art|clock|decor)|decorative\s+wall|vinyl\s+(?:record\s+)?clock|record\s+coasters?|(?:tote|canvas|shoulder|shopping)\s+bags?|earrings?|keychains?|jewel(?:ry|lery)|phone\s+case)\b/;
  const accessoryProductType = identityAspects.some((aspect) => {
    if (!/^(?:type|product type|item type)$/i.test(aspect.name)) return false;
    return /^(?:decal|label|mat|record mat|slipmat|sticker|sleeve)$/i.test(aspect.value.trim());
  });
  if (
    accessoryProductType ||
    accessorySignal.test(accessoryText) ||
    isMarketplaceNonRecordTitle(accessoryText)
  ) {
    return { evidence, reason: "detail_identifies_accessory", status: "rejected" };
  }

  const typeValues = identityAspects
    .filter((aspect) => /^(?:type|product type|item type)$/i.test(aspect.name))
    .map((aspect) => normalizeWords(aspect.value));
  const formatValues = identityAspects
    .filter((aspect) => /^(?:format|record format)$/i.test(aspect.name))
    .map((aspect) => normalizeWords(aspect.value));
  const materialValues = identityAspects
    .filter((aspect) => /^material$/i.test(aspect.name))
    .map((aspect) => normalizeWords(aspect.value));
  const bindingValues = aspects
    .filter((aspect) => /^binding$/i.test(aspect.name))
    .map((aspect) => normalizeWords(aspect.value));
  const itemKeywordValues = aspects
    .filter((aspect) => /^item type keyword$/i.test(aspect.name))
    .map((aspect) => normalizeWords(aspect.value));
  const recordProductType = /^(?:album|box set|ep|lp|maxi single|record|single|vinyl record|vinyl records)$/;
  const recordFormat = /\b(?:vinyl|record|lp|33 rpm|45 rpm|12 inch|10 inch|7 inch)\b/;
  const nonRecordMediaFormat = /\b(?:8 track|audio cd|blu ray|cassette|cd|compact disc|digital|download|dvd|mp3)\b/;
  const hasRecordProductType = typeValues.some((value) => recordProductType.test(value));
  const hasRecordFormat = formatValues.some((value) => recordFormat.test(value));
  const hasVinylMaterial = materialValues.some((value) => /\bvinyl\b/.test(value));
  const hasArtistAspect = aspects.some(
    (aspect) => /^artist$/i.test(aspect.name) && Boolean(normalizeWords(aspect.value)),
  );
  const hasReleaseTitleAspect = aspects.some(
    (aspect) => /^(?:album name|record title|release title)$/i.test(aspect.name) && Boolean(normalizeWords(aspect.value)),
  );
  const recordSpecificAspectCount = new Set(
    aspects
      .filter(
        (aspect) => /^(?:catalog number|record grading|record size|speed)$/i.test(aspect.name) && Boolean(normalizeWords(aspect.value)),
      )
      .map((aspect) => normalizeWords(aspect.name)),
  ).size;
  const explicitNonRecordType = typeValues.some((value) => !recordProductType.test(value));
  const explicitNonRecordFormat =
    (formatValues.length > 0 && !hasRecordFormat) ||
    formatValues.some((value) => nonRecordMediaFormat.test(value));
  if (explicitNonRecordType || explicitNonRecordFormat) {
    return { evidence, reason: "detail_identifies_accessory", status: "rejected" };
  }
  if (
    hasRecordProductType &&
    (hasRecordFormat || (formatValues.length === 0 && hasVinylMaterial)) &&
    hasArtistAspect &&
    hasReleaseTitleAspect &&
    recordSpecificAspectCount >= 1
  ) {
    return { evidence, reason: null, status: "verified" };
  }
  const hasItemNameAspect = aspects.some(
    (aspect) => /^item name$/i.test(aspect.name) && Boolean(normalizeWords(aspect.value)),
  );
  const hasRecordBinding = bindingValues.some((value) => /\b(?:lp record|vinyl record)\b/.test(value));
  const hasVinylItemKeyword = itemKeywordValues.some((value) => /\b(?:lp|record|vinyl)\b/.test(value));
  const multiAspectRecordEvidence =
    typeValues.length === 0 &&
    (
      (hasRecordFormat && hasArtistAspect && hasReleaseTitleAspect && recordSpecificAspectCount >= 2) ||
      (
        hasRecordBinding &&
        hasVinylItemKeyword &&
        hasArtistAspect &&
        hasItemNameAspect &&
        hasReleaseTitleAspect &&
        recordSpecificAspectCount >= 1
      )
    );
  if (multiAspectRecordEvidence) {
    return { evidence, reason: null, status: "verified" };
  }
  return { evidence, reason: "record_format_aspects_missing", status: "unknown" };
}

const DEFAULT_ENDPOINT_ROOT = "https://api.ebay.com";
const DEFAULT_MARKETPLACE_ID = "EBAY_US";
const DEFAULT_DELIVERY_COUNTRY = "US";
const DEFAULT_CURRENCY = "USD";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES_PER_LANE = 4;
const DEFAULT_MAX_LANES = 9;
const DEFAULT_MAX_CANDIDATES = 5_000;
const DEFAULT_MAX_DETAIL_REQUESTS = 0;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGE_SIZE = 200;
const MAX_PAGES_PER_LANE = 10;
const MAX_LANES = 12;
const MAX_CANDIDATES = 5_000;

export const DEFAULT_EBAY_PURCHASE_LANES = Object.freeze([
  Object.freeze({ id: "all-item-2-15", query: "vinyl record", minItemPrice: 2, maxItemPrice: 14.99, maxAllInPrice: 300, sort: "price" }),
  Object.freeze({ id: "all-item-15-30", query: "vinyl record", minItemPrice: 15, maxItemPrice: 29.99, maxAllInPrice: 300, sort: "price" }),
  Object.freeze({ id: "all-item-30-60", query: "vinyl record", minItemPrice: 30, maxItemPrice: 59.99, maxAllInPrice: 300, sort: "price" }),
  Object.freeze({ id: "all-item-60-100", query: "vinyl record", minItemPrice: 60, maxItemPrice: 99.99, maxAllInPrice: 300, sort: "price" }),
  Object.freeze({ id: "all-item-100-250", query: "vinyl record", minItemPrice: 100, maxItemPrice: 250, maxAllInPrice: 300, sort: "price" }),
  Object.freeze({ id: "jazz-newly-listed", query: "jazz vinyl", maxAllInPrice: 300, sort: "newlyListed" }),
  Object.freeze({ id: "rock-newly-listed", query: "rock vinyl", maxAllInPrice: 300, sort: "newlyListed" }),
  Object.freeze({ id: "hip-hop-newly-listed", query: "hip hop vinyl", maxAllInPrice: 300, sort: "newlyListed" }),
  Object.freeze({ id: "soundtrack-newly-listed", query: "soundtrack vinyl", maxAllInPrice: 300, sort: "newlyListed" }),
]);

/**
 * Resolve an eBay application token without exposing credential material.
 * A purpose-specific static token takes precedence over client credentials.
 */
export async function getEbayApplicationToken(options = {}) {
  const env = options.env ?? process.env;
  const staticToken = cleanText(
    env.EBAY_BROWSE_ACCESS_TOKEN ??
      env.EBAY_APPLICATION_ACCESS_TOKEN ??
      env.EBAY_APP_ACCESS_TOKEN,
  );
  if (staticToken) {
    return {
      available: true,
      credentialSource: "static_application_token",
      expiresInSeconds: null,
      status: "available",
      token: staticToken,
    };
  }

  const clientId = cleanText(env.EBAY_CLIENT_ID);
  const clientSecret = cleanText(env.EBAY_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    return {
      available: false,
      credentialSource: null,
      expiresInSeconds: null,
      reason:
        "Missing EBAY_BROWSE_ACCESS_TOKEN or the EBAY_CLIENT_ID / EBAY_CLIENT_SECRET application credential pair.",
      status: "unavailable",
      token: null,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      available: false,
      credentialSource: "client_credentials",
      expiresInSeconds: null,
      reason: "No fetch implementation is available for eBay application-token retrieval.",
      status: "failed",
      token: null,
    };
  }

  const endpointRoot = cleanEndpoint(options.endpointRoot ?? DEFAULT_ENDPOINT_ROOT);
  const tokenUrl = new URL("/identity/v1/oauth2/token", endpointRoot);
  const requestTimeoutMs = boundedInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    100,
    120_000,
  );
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      tokenUrl,
      {
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "https://api.ebay.com/oauth/api_scope",
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: options.signal,
      },
      requestTimeoutMs,
    );
  } catch (error) {
    return {
      available: false,
      credentialSource: "client_credentials",
      expiresInSeconds: null,
      reason: `eBay application-token request failed: ${errorMessage(error)}`,
      status: "failed",
      token: null,
    };
  }

  const payloadResult = await readJsonResponse(response);
  const token = cleanText(payloadResult.value?.access_token);
  if (!response.ok || !token) {
    return {
      available: false,
      credentialSource: "client_credentials",
      expiresInSeconds: null,
      httpStatus: response.status,
      reason: apiErrorMessage(response, payloadResult.value, payloadResult.error).replace(
        "eBay Browse API",
        "eBay application-token request",
      ),
      status: "failed",
      token: null,
    };
  }

  return {
    available: true,
    credentialSource: "client_credentials",
    expiresInSeconds: nonNegativeInteger(payloadResult.value.expires_in),
    status: "available",
    token,
  };
}

/**
 * Discover active eBay listings that can be purchased as new vinyl records.
 *
 * This adapter deliberately does not inspect sold/completed listings. Its
 * purchasePrice is item price plus the lowest explicitly quoted shipping
 * charge, before tax. Callers must not add inbound shipping a second time.
 */
export async function discoverEbayPurchases(options = {}) {
  const token = cleanText(options.token);
  if (!token) throw new Error("discoverEbayPurchases requires an eBay application access token.");

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("discoverEbayPurchases requires a fetch implementation.");

  const suppliedLanes = Array.isArray(options.lanes) ? options.lanes : DEFAULT_EBAY_PURCHASE_LANES;
  const normalizedLanes = normalizeLanes(suppliedLanes);
  if (normalizedLanes.length === 0) throw new Error("discoverEbayPurchases requires at least one valid query lane.");

  const maxLanes = boundedInteger(options.maxLanes, DEFAULT_MAX_LANES, 1, MAX_LANES);
  const lanes = normalizedLanes.slice(0, maxLanes);
  const pageSize = boundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const maxPagesPerLane = boundedInteger(
    options.maxPagesPerLane,
    DEFAULT_MAX_PAGES_PER_LANE,
    1,
    MAX_PAGES_PER_LANE,
  );
  const maxCandidates = boundedInteger(
    options.maxCandidates,
    DEFAULT_MAX_CANDIDATES,
    1,
    MAX_CANDIDATES,
  );
  const maxDetailRequests = boundedInteger(
    options.maxDetailRequests,
    DEFAULT_MAX_DETAIL_REQUESTS,
    0,
    MAX_CANDIDATES,
  );
  const requestTimeoutMs = boundedInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    100,
    120_000,
  );
  const requestOptions = {
    categoryId: cleanText(options.categoryId) ?? EBAY_VINYL_CATEGORY_ID,
    currency: cleanText(options.currency)?.toUpperCase() ?? DEFAULT_CURRENCY,
    deliveryCountry: cleanText(options.deliveryCountry)?.toUpperCase() ?? DEFAULT_DELIVERY_COUNTRY,
    deliveryPostalCode: cleanText(options.deliveryPostalCode),
    endpointRoot: cleanEndpoint(options.endpointRoot ?? DEFAULT_ENDPOINT_ROOT),
    marketplaceId: cleanText(options.marketplaceId) ?? DEFAULT_MARKETPLACE_ID,
    minSellerFeedbackPercentage: options.minSellerFeedbackPercentage,
    minSellerFeedbackScore: options.minSellerFeedbackScore,
    pageSize,
  };

  const candidateByKey = new Map();
  const candidateOrder = [];
  const laneReports = [];
  const pageReports = [];
  const errors = [];
  const rejectedByReason = new Map();
  let requestsMade = 0;
  let rawItemsSeen = 0;
  let duplicateCount = 0;
  let rateLimited = false;
  let retryAfterMs = null;
  let globalStopReason = null;

  for (const lane of lanes) {
    if (globalStopReason) break;
    const report = createLaneReport(lane);
    laneReports.push(report);

    for (let pageIndex = 0; pageIndex < maxPagesPerLane; pageIndex += 1) {
      const offset = pageIndex * pageSize;
      const url = buildEbayPurchaseSearchUrl(lane, { ...requestOptions, offset });
      const diagnosticUrl = redactEbayPurchaseDiagnosticUrl(url);
      const pageReport = {
        error: null,
        failureKind: null,
        httpStatus: null,
        laneId: lane.id,
        offset,
        pageNumber: pageIndex + 1,
        rawItemCount: 0,
        requestedUrl: diagnosticUrl,
        resolvedUrl: null,
        status: "attempted",
        totalReported: null,
      };
      pageReports.push(pageReport);
      report.pagesAttempted += 1;
      requestsMade += 1;

      let response;
      try {
        response = await fetchWithTimeout(
          fetchImpl,
          url,
          {
            headers: ebayBrowseHeaders(token, requestOptions),
            signal: options.signal,
          },
          requestTimeoutMs,
        );
      } catch (error) {
        const message = errorMessage(error);
        pageReport.error = message;
        pageReport.failureKind = "request_error";
        pageReport.status = "error";
        report.stopReason = "request_error";
        report.errors.push(message);
        errors.push({ laneId: lane.id, message, status: null });
        break;
      }

      const payloadResult = await readJsonResponse(response);
      pageReport.httpStatus = response.status;
      pageReport.resolvedUrl = redactEbayPurchaseDiagnosticUrl(
        cleanText(response.url) ?? url,
      );
      if (!response.ok) {
        const message = apiErrorMessage(response, payloadResult.value, payloadResult.error);
        pageReport.error = message;
        pageReport.failureKind =
          response.status === 429
            ? "rate_limited"
            : response.status === 401 || response.status === 403
              ? "authentication_error"
              : "http_error";
        pageReport.status = "error";
        report.errors.push(message);
        errors.push({ laneId: lane.id, message, status: response.status });

        if (response.status === 429) {
          rateLimited = true;
          retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after"));
          report.stopReason = "rate_limited";
          globalStopReason = "rate_limited";
        } else if (response.status === 401 || response.status === 403) {
          report.stopReason = "authentication_error";
          globalStopReason = "authentication_error";
        } else {
          report.stopReason = "http_error";
        }
        break;
      }

      if (payloadResult.error || !isObject(payloadResult.value)) {
        const message = payloadResult.error ?? "eBay Browse API returned a non-object payload.";
        pageReport.error = message;
        pageReport.failureKind = "invalid_response";
        pageReport.status = "error";
        report.stopReason = "invalid_response";
        report.errors.push(message);
        errors.push({ laneId: lane.id, message, status: response.status });
        break;
      }

      const payload = payloadResult.value;
      const summaries = Array.isArray(payload.itemSummaries) ? payload.itemSummaries : [];
      const reportedTotal = nonNegativeInteger(payload.total);
      pageReport.rawItemCount = summaries.length;
      pageReport.status = "available";
      pageReport.totalReported = reportedTotal;
      report.pagesSucceeded += 1;
      report.rawItemCount += summaries.length;
      report.totalReported = maxNullable(report.totalReported, reportedTotal);
      rawItemsSeen += summaries.length;

      for (const item of summaries) {
        const assessed = assessEbayPurchaseItem(item, lane, requestOptions);
        if (!assessed.accepted) {
          incrementMap(report.rejectedByReason, assessed.reason);
          incrementMap(rejectedByReason, assessed.reason);
          continue;
        }

        const candidate = assessed.candidate;
        const key = ebayPurchaseDedupeKey(candidate);
        const existing = candidateByKey.get(key);
        if (existing) {
          duplicateCount += 1;
          report.duplicateCount += 1;
          const discoveredByLanes = uniqueStrings([...existing.discoveredByLanes, lane.id]);
          if (candidate.purchasePrice < existing.purchasePrice) {
            candidateByKey.set(key, {
              ...candidate,
              discoveredByLanes,
              discoverySequence: existing.discoverySequence,
            });
          } else {
            existing.discoveredByLanes = discoveredByLanes;
          }
          continue;
        }

        const discoverySequence = candidateOrder.length;
        candidateByKey.set(key, {
          ...candidate,
          discoveredByLanes: [lane.id],
          discoverySequence,
        });
        candidateOrder.push(key);
        report.acceptedCount += 1;

        if (candidateByKey.size >= maxCandidates) {
          report.stopReason = "candidate_cap";
          globalStopReason = "candidate_cap";
          break;
        }
      }

      if (globalStopReason) break;

      const hasMore = hasAnotherPage(payload, summaries.length, offset, pageSize);
      if (!hasMore) {
        report.complete = true;
        report.stopReason = "exhausted";
        break;
      }

      if (pageIndex === maxPagesPerLane - 1) {
        report.stopReason = "page_cap";
      }
    }

    if (!report.stopReason) report.stopReason = "page_cap";
    report.coverageRate =
      report.totalReported && report.totalReported > 0
        ? Math.min(1, Math.round((report.rawItemCount / report.totalReported) * 10_000) / 10_000)
        : null;
    report.rejectedByReason = sortedCountObject(report.rejectedByReason);
  }

  const lanesTruncated = normalizedLanes.length > lanes.length;
  const allProcessedLanesComplete = laneReports.length === lanes.length && laneReports.every((report) => report.complete);
  const searchComplete = !lanesTruncated && !globalStopReason && allProcessedLanesComplete;
  const searchStopReason = overallStopReason({
    complete: searchComplete,
    globalStopReason,
    laneReports,
    lanesTruncated,
  });
  const summaryCandidates = candidateOrder
    .map((key) => candidateByKey.get(key))
    .filter(Boolean)
    .map(({ discoverySequence: _discoverySequence, ...candidate }) => candidate);
  const detailVerification = await verifyEbayPurchaseCandidateDetails(summaryCandidates, {
    fetchImpl,
    maxDetailRequests,
    requestOptions,
    requestTimeoutMs,
    signal: options.signal,
    token,
  });
  const candidates = detailVerification.candidates;
  const detailStopReason = detailVerification.diagnostics.stopReason;
  const detailIncomplete = [
    "authentication_error",
    "rate_limited",
    "request_cap",
    "request_errors",
  ].includes(detailStopReason);
  const complete = searchComplete && !detailIncomplete;
  const aggregateStopReason = searchComplete && detailIncomplete ? detailStopReason : searchStopReason;
  const aggregateRateLimited = rateLimited || detailVerification.diagnostics.rateLimited;
  const aggregateRetryAfterMs = retryAfterMs ?? detailVerification.diagnostics.retryAfterMs;

  return {
    candidates,
    complete,
    rateLimited: aggregateRateLimited,
    retryAfterMs: aggregateRetryAfterMs,
    soldDataIncluded: false,
    evidenceScope: "active_purchase_listings_only",
    diagnostics: {
      adapter: "ebay-browse-purchase-discovery",
      buyingOptions: ["FIXED_PRICE"],
      categoryId: requestOptions.categoryId,
      coverageClaim: complete ? "all_configured_lanes_exhausted" : "bounded_api_window_not_exhaustive",
      conditions: ["NEW"],
      conditionIds: ["1000"],
      currency: requestOptions.currency,
      deliveryCountry: requestOptions.deliveryCountry,
      deliveryPostalCodeConfigured: Boolean(requestOptions.deliveryPostalCode),
      detailVerification: detailVerification.diagnostics,
      duplicateCount,
      errors,
      laneReports,
      lanesProcessed: laneReports.length,
      lanesRequested: normalizedLanes.length,
      lanesTruncated,
      limits: {
        maxCandidates,
        maxDetailRequests,
        maxLanes,
        maxPagesPerLane,
        pageSize,
      },
      pageReports,
      rawItemsSeen,
      rejectedByReason: sortedCountObject(rejectedByReason),
      requestMode: "serial",
      requestsMade,
      stopReason: aggregateStopReason,
    },
  };
}

export function buildEbayPurchaseSearchUrl(lane, options = {}) {
  const normalizedLane = normalizeLane(lane, 0);
  if (!normalizedLane) throw new Error("A valid eBay purchase query lane is required.");

  const endpointRoot = cleanEndpoint(options.endpointRoot ?? DEFAULT_ENDPOINT_ROOT);
  const categoryId = cleanText(options.categoryId) ?? EBAY_VINYL_CATEGORY_ID;
  const currency = cleanText(options.currency)?.toUpperCase() ?? DEFAULT_CURRENCY;
  const deliveryCountry = cleanText(options.deliveryCountry)?.toUpperCase() ?? DEFAULT_DELIVERY_COUNTRY;
  const pageSize = boundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = boundedInteger(options.offset, 0, 0, 9_999);
  const filters = [
    "conditionIds:{1000}",
    "buyingOptions:{FIXED_PRICE}",
    `deliveryCountry:${deliveryCountry}`,
    `itemLocationCountry:${deliveryCountry}`,
  ];
  const deliveryPostalCode = cleanText(options.deliveryPostalCode);
  if (deliveryPostalCode) filters.push(`deliveryPostalCode:${deliveryPostalCode}`);

  const minItemPrice = normalizedLane.minItemPrice;
  const maxItemPrice = normalizedLane.maxItemPrice ?? normalizedLane.maxAllInPrice;
  if (minItemPrice !== null || maxItemPrice !== null) {
    const lower = minItemPrice === null ? "" : formatFilterMoney(minItemPrice);
    const upper = maxItemPrice === null ? "" : formatFilterMoney(maxItemPrice);
    filters.push(`price:[${lower}..${upper}]`, `priceCurrency:${currency}`);
  }

  const url = new URL("/buy/browse/v1/item_summary/search", endpointRoot);
  url.searchParams.set("q", normalizedLane.query);
  url.searchParams.set("category_ids", categoryId);
  url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("sort", normalizedLane.sort);
  return url;
}

export function assessEbayPurchaseItem(item, lane = {}, options = {}) {
  if (!isObject(item)) return rejection("invalid_item");
  const title = cleanText(item.title);
  if (!title) return rejection("missing_title");

  const normalizedLane = normalizeLane(lane, 0) ?? {
    id: "ad_hoc",
    maxAllInPrice: null,
    minAllInPrice: null,
    query: "vinyl",
    requiredTitleTokens: [],
    sort: "price",
  };
  const categoryId = cleanText(options.categoryId) ?? EBAY_VINYL_CATEGORY_ID;
  const expectedCurrency = cleanText(options.currency)?.toUpperCase() ?? DEFAULT_CURRENCY;
  if (!matchesVinylCategory(item, categoryId)) return rejection("wrong_category");

  const buyingOptions = stringArray(item.buyingOptions).map((value) => value.toUpperCase());
  if (!buyingOptions.includes("FIXED_PRICE")) return rejection("not_fixed_price");

  const conditionId = cleanText(item.conditionId);
  if (conditionId !== "1000") return rejection("not_new");

  const titleAssessment = assessRecordTitle(title);
  if (
    !titleAssessment.accepted &&
    (titleAssessment.reason !== "record_signal_missing" || options.requireTitleRecordSignal !== false)
  ) {
    return rejection(titleAssessment.reason);
  }
  if (!requiredTokensMatch(title, normalizedLane.requiredTitleTokens)) return rejection("lane_token_mismatch");
  if (explicitlyUnavailable(item)) return rejection("unavailable");

  const itemPrice = positiveMoney(item.price?.value);
  if (itemPrice === null) return rejection("missing_item_price");
  const priceCurrency = cleanText(item.price?.currency)?.toUpperCase();
  if (priceCurrency !== expectedCurrency) return rejection("currency_mismatch");

  const shipping = lowestShipping(item.shippingOptions, expectedCurrency);
  if (!shipping) {
    return rejection(hasNonFixedShippingQuote(item.shippingOptions) ? "shipping_quote_not_fixed" : "shipping_unknown");
  }
  const purchasePrice = roundMoney(itemPrice + shipping.price);
  if (normalizedLane.minAllInPrice !== null && purchasePrice < normalizedLane.minAllInPrice) {
    return rejection("below_lane_price_floor");
  }
  if (normalizedLane.maxAllInPrice !== null && purchasePrice > normalizedLane.maxAllInPrice) {
    return rejection("above_lane_price_ceiling");
  }

  const itemUrl = normalizeEbayItemUrl(item.itemWebUrl);
  if (!itemUrl) return rejection("missing_item_url");
  const deliveryCountry = cleanText(options.deliveryCountry)?.toUpperCase() ?? DEFAULT_DELIVERY_COUNTRY;
  const itemOriginCountry = cleanText(item.itemLocation?.country)?.toUpperCase();
  if (!itemOriginCountry) return rejection("item_origin_unknown");
  if (itemOriginCountry !== deliveryCountry) return rejection("cross_border_origin");
  const sellerFeedbackScore = nonNegativeInteger(item.seller?.feedbackScore);
  const sellerFeedbackPercentage = boundedPercentage(item.seller?.feedbackPercentage);
  const minSellerFeedbackScore = nonNegativeInteger(options.minSellerFeedbackScore) ?? DEFAULT_EBAY_MIN_SELLER_FEEDBACK_SCORE;
  const minSellerFeedbackPercentage = boundedPercentage(options.minSellerFeedbackPercentage) ?? DEFAULT_EBAY_MIN_SELLER_FEEDBACK_PERCENTAGE;
  if (sellerFeedbackScore === null || sellerFeedbackPercentage === null) {
    return rejection("seller_reputation_missing");
  }
  if (
    sellerFeedbackScore < minSellerFeedbackScore ||
    sellerFeedbackPercentage < minSellerFeedbackPercentage
  ) {
    return rejection("seller_reputation_below_threshold");
  }
  const itemId = cleanText(item.itemId) ?? cleanText(item.legacyItemId) ?? itemUrl;
  const identity = inferRecordIdentity(title);

  return {
    accepted: true,
    candidate: {
      artist: identity.artist,
      available: true,
      condition: "new/sealed",
      costs: { inboundShipping: 0 },
      ebayItemId: itemId,
      id: `ebay-purchase:${stableToken(itemId)}`,
      purchasePrice,
      purchasePriceIncludesShipping: true,
      purchasePriceScope: "item_plus_listed_shipping_before_tax",
      productIdentityEvidence: [],
      productIdentityVerification: "summary_only",
      shippingDestinationVerified: Boolean(cleanText(options.deliveryPostalCode)),
      shippingQuoteType: "fixed",
      sellerAccountType: cleanText(item.seller?.sellerAccountType) ?? null,
      sellerFeedbackPercentage,
      sellerFeedbackScore,
      sellerName: cleanText(item.seller?.username) ?? null,
      sourceCountry: itemOriginCountry,
      sourceCurrency: expectedCurrency,
      sourceId: EBAY_PURCHASE_SOURCE_ID,
      sourceItemPrice: roundMoney(itemPrice),
      sourceListingTitle: title,
      sourceName: "eBay",
      sourceShippingPrice: shipping.price,
      sourceUrl: itemUrl,
      title: identity.title,
    },
  };
}

function redactEbayPurchaseDiagnosticUrl(value) {
  try {
    const url = value instanceof URL ? new URL(value.toString()) : new URL(String(value));
    const filter = url.searchParams.get("filter");
    if (filter) {
      const safeFilter = filter
        .split(",")
        .filter((entry) => !/^deliveryPostalCode:/i.test(entry.trim()))
        .join(",");
      if (safeFilter) url.searchParams.set("filter", safeFilter);
      else url.searchParams.delete("filter");
    }
    return url.toString();
  } catch {
    return String(value ?? "").replace(
      /deliveryPostalCode(?::|%3A)[^,%\s&]+/gi,
      "deliveryPostalCode:[redacted]",
    );
  }
}

function normalizeLanes(lanes) {
  const seenIds = new Set();
  const normalized = [];
  for (let index = 0; index < lanes.length; index += 1) {
    const lane = normalizeLane(lanes[index], index);
    if (!lane || seenIds.has(lane.id)) continue;
    seenIds.add(lane.id);
    normalized.push(lane);
  }
  return normalized;
}

function normalizeLane(lane, index) {
  if (!isObject(lane)) return null;
  const query = cleanText(lane.query);
  if (!query) return null;
  return {
    id: cleanIdentifier(lane.id) ?? `lane-${index + 1}`,
    maxAllInPrice: optionalPositiveMoney(lane.maxAllInPrice),
    maxItemPrice: optionalPositiveMoney(lane.maxItemPrice),
    minAllInPrice: optionalPositiveMoney(lane.minAllInPrice),
    minItemPrice: optionalPositiveMoney(lane.minItemPrice),
    query,
    requiredTitleTokens: uniqueStrings(stringArray(lane.requiredTitleTokens).map(normalizeWords).filter(Boolean)),
    sort: normalizeSort(lane.sort),
  };
}

function createLaneReport(lane) {
  return {
    acceptedCount: 0,
    complete: false,
    coverageRate: null,
    duplicateCount: 0,
    errors: [],
    id: lane.id,
    pagesAttempted: 0,
    pagesSucceeded: 0,
    query: lane.query,
    rawItemCount: 0,
    rejectedByReason: new Map(),
    stopReason: null,
    totalReported: null,
  };
}

function assessRecordTitle(title) {
  const normalized = normalizeWords(title);
  if (isMarketplaceNonRecordTitle(normalized)) return { accepted: false, reason: "non_record_title" };
  const hardNoise = [
    /\b(?:audio\s+cd|compact\s+disc|cd\s+only|cassette|8\s*track|dvd|blu\s*ray|minidisc)\b/,
    /\b(?:t[ -]?shirt|hoodie|sweatshirt|poster|calendar|magazine|book|sticker|patch|enamel\s+pin)\b/,
    /\b(?:record\s+player|turntable|stylus|replacement\s+needle|slipmat|cleaning\s+kit|record\s+cleaner)\b/,
    /\b(?:record|vinyl|lp)\s+(?:mailers?|shipping\s+boxes?|protectors?|cleaning\s+(?:brush|cloth|fluid))\b/,
    /\b(?:outer|inner)\s+(?:record\s+|vinyl\s+|lp\s+)?sleeves?(?:\s+protectors?)?\b/,
    /\b(?:record|vinyl|lp)\s+(?:outer|inner)\s+sleeves?\b/,
    /\b(?:cleaning\s+(?:brush|cloth|fluid)|sleeve\s+protector|record\s+mailer)\b/,
    /\b(?:record|vinyl|lp).{0,32}\b(?:weight|stabilizer|clamp|anti[- ]?static\s+brush|replacement\s+(?:sleeve|jacket|cover)|divider\s+tabs?)\b/,
    /\b(?:weight\s+stabilizer|stabilizer\s+clamp|anti[- ]?static\s+brush|replacement\s+(?:sleeve|jacket|cover)|divider\s+tabs?)\b/,
    /\b(?:vinyl|record|lp).{0,40}\b(?:bowl|coasters?|decal|paper\s+label|label\s+decal|non[- ]?adhesive\s+label|turntable\s+(?:platter\s+)?mat|platter\s+mat|record\s+mat|lp\s+mat|floor\s+mat|mouse\s+mat|wall\s+clock)\b/,
    /\b(?:decal|paper\s+label|label\s+decal|non[- ]?adhesive\s+label)\b/,
    /\b(?:sleeve|jacket|cover)\s+only\b/,
    /\b(?:record|vinyl)\s+(?:storage|case|holder|stand|display|frame|rack|shelf|coaster|clock)\b/,
    /\b(?:lot\s+of|job\s+lot|record\s+lot|vinyl\s+lot|record\s+collection|vinyl\s+collection|mystery\s+box|random\s+bundle)\b/,
  ];
  if (hardNoise.some((pattern) => pattern.test(normalized))) return { accepted: false, reason: "non_record_title" };

  const hasRecordSignal =
    /\bvinyl\b/.test(normalized) ||
    /\blp\b/.test(normalized) ||
    /\bphonograph\s+record\b/.test(normalized) ||
    /\b(?:33(?:\s+1\s+3)?|45)\s*rpm\b/.test(normalized) ||
    /(?:^|\s)(?:7|10|12)\s*(?:inch|inches)(?:\s|$)/.test(normalized);
  return hasRecordSignal ? { accepted: true, reason: null } : { accepted: false, reason: "record_signal_missing" };
}

async function verifyEbayPurchaseCandidateDetails(candidates, context) {
  const maxDetailRequests = Math.min(context.maxDetailRequests, candidates.length);
  const selection = selectDetailCandidates(candidates, maxDetailRequests);
  const candidateUpdates = new Map();
  const rejectedIndexes = new Set();
  const errors = [];
  let requestsMade = 0;
  let verifiedCount = 0;
  let rejectedCount = 0;
  let unknownCount = 0;
  let rateLimited = false;
  let retryAfterMs = null;
  let stopReason = maxDetailRequests > 0 ? null : "disabled";
  let attemptedCandidateCount = 0;

  for (const { candidate, index } of selection.entries) {
    if (stopReason === "rate_limited" || stopReason === "authentication_error") break;
    attemptedCandidateCount += 1;

    const detailUrl = buildEbayPurchaseDetailUrl(candidate, context.requestOptions.endpointRoot);
    if (!detailUrl) {
      unknownCount += 1;
      errors.push({ itemId: candidate.ebayItemId, message: "A stable eBay item ID was unavailable for detail verification.", status: null });
      continue;
    }

    requestsMade += 1;
    let response;
    try {
      response = await fetchWithTimeout(
        context.fetchImpl,
        detailUrl,
        {
          headers: ebayBrowseHeaders(context.token, context.requestOptions),
          signal: context.signal,
        },
        context.requestTimeoutMs,
      );
    } catch (error) {
      unknownCount += 1;
      errors.push({ itemId: candidate.ebayItemId, message: errorMessage(error), status: null });
      continue;
    }

    const payloadResult = await readJsonResponse(response);
    if (!response.ok) {
      const message = apiErrorMessage(response, payloadResult.value, payloadResult.error);
      errors.push({ itemId: candidate.ebayItemId, message, status: response.status });
      unknownCount += 1;
      if (response.status === 429) {
        rateLimited = true;
        retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after"));
        stopReason = "rate_limited";
      } else if (response.status === 401 || response.status === 403) {
        stopReason = "authentication_error";
      }
      continue;
    }
    if (payloadResult.error || !isObject(payloadResult.value)) {
      unknownCount += 1;
      errors.push({
        itemId: candidate.ebayItemId,
        message: payloadResult.error ?? "eBay Browse item detail returned a non-object payload.",
        status: response.status,
      });
      continue;
    }

    const assessment = assessEbayPurchaseDetail(payloadResult.value);
    if (assessment.status === "rejected") {
      rejectedCount += 1;
      rejectedIndexes.add(index);
      continue;
    }
    if (assessment.status === "verified") {
      verifiedCount += 1;
      candidateUpdates.set(index, {
        ...candidate,
        productIdentityEvidence: assessment.evidence,
        productIdentityVerification: "detail_aspects",
      });
      continue;
    }

    unknownCount += 1;
    candidateUpdates.set(index, {
      ...candidate,
      productIdentityEvidence: assessment.evidence,
    });
  }

  if (!stopReason) {
    stopReason = candidates.length > maxDetailRequests
      ? "request_cap"
      : errors.length > 0
        ? "request_errors"
        : "exhausted";
  }
  const verifiedCandidates = candidates.flatMap((candidate, index) => {
    if (rejectedIndexes.has(index)) return [];
    return [candidateUpdates.get(index) ?? candidate];
  });
  return {
    candidates: verifiedCandidates,
    diagnostics: {
      attemptedCandidateCount,
      errors,
      maxDetailRequests: context.maxDetailRequests,
      rateLimited,
      rejectedCount,
      requestsMade,
      retryAfterMs,
      selectedCandidateCount: selection.entries.length,
      selectedLaneCount: selection.laneCount,
      selectionMode: "lane_round_robin",
      skippedCount: Math.max(0, candidates.length - attemptedCandidateCount),
      stopReason,
      unknownCount,
      verifiedCount,
    },
  };
}

function selectDetailCandidates(candidates, maxDetailRequests) {
  const buckets = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const laneId = cleanText(candidate?.discoveredByLanes?.[0]) ?? "unassigned";
    if (!buckets.has(laneId)) buckets.set(laneId, []);
    buckets.get(laneId).push({ candidate, index, laneId });
  }

  const positions = new Map([...buckets.keys()].map((laneId) => [laneId, 0]));
  const entries = [];
  while (entries.length < maxDetailRequests) {
    let selectedInRound = false;
    for (const [laneId, bucket] of buckets) {
      if (entries.length >= maxDetailRequests) break;
      const position = positions.get(laneId) ?? 0;
      if (position >= bucket.length) continue;
      entries.push(bucket[position]);
      positions.set(laneId, position + 1);
      selectedInRound = true;
    }
    if (!selectedInRound) break;
  }

  return {
    entries,
    laneCount: new Set(entries.map((entry) => entry.laneId)).size,
  };
}

function buildEbayPurchaseDetailUrl(candidate, endpointRoot) {
  const itemId = cleanText(candidate?.ebayItemId);
  if (!itemId || /^https?:/i.test(itemId)) return null;
  return new URL(`/buy/browse/v1/item/${encodeURIComponent(itemId)}`, endpointRoot);
}

function ebayBrowseHeaders(token, options) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": options.marketplaceId,
    ...(options.deliveryPostalCode
      ? {
          "X-EBAY-C-ENDUSERCTX": `contextualLocation=${encodeURIComponent(
            `country=${options.deliveryCountry},zip=${options.deliveryPostalCode}`,
          )}`,
        }
      : {}),
  };
}

function lowestShipping(options, expectedCurrency) {
  const costs = [];
  for (const option of Array.isArray(options) ? options : []) {
    if (cleanText(option?.shippingCostType)?.toUpperCase() !== "FIXED") continue;
    const value = nonNegativeMoney(option?.shippingCost?.value);
    const currency = cleanText(option?.shippingCost?.currency)?.toUpperCase();
    if (value === null || currency !== expectedCurrency) continue;
    costs.push(roundMoney(value));
  }
  if (costs.length === 0) return null;
  return { price: Math.min(...costs) };
}

function hasNonFixedShippingQuote(options) {
  return (Array.isArray(options) ? options : []).some((option) => {
    const type = cleanText(option?.shippingCostType)?.toUpperCase();
    return type && type !== "FIXED";
  });
}

function explicitlyUnavailable(item) {
  if (item.itemEndDate) {
    const end = Date.parse(item.itemEndDate);
    if (Number.isFinite(end) && end <= Date.now()) return true;
  }
  const statuses = [
    item.estimatedAvailabilityStatus,
    ...(Array.isArray(item.estimatedAvailabilities)
      ? item.estimatedAvailabilities.map((entry) => entry?.estimatedAvailabilityStatus)
      : []),
  ]
    .map((value) => cleanText(value)?.toUpperCase())
    .filter(Boolean);
  return statuses.some((status) => /OUT_OF_STOCK|UNAVAILABLE|SOLD_OUT/.test(status));
}

function matchesVinylCategory(item, categoryId) {
  const leafCategoryIds = uniqueStrings(stringArray(item.leafCategoryIds));
  if (leafCategoryIds.length > 0) return leafCategoryIds.includes(categoryId);
  const categoryIds = uniqueStrings(
    Array.isArray(item.categories) ? item.categories.map((entry) => cleanText(entry?.categoryId)) : [],
  );
  // The category is also enforced on the API request. Missing response-side
  // category fields are therefore unknown rather than contradictory evidence.
  return categoryIds.length === 0 || categoryIds.includes(categoryId);
}

function requiredTokensMatch(title, requiredTokens) {
  if (requiredTokens.length === 0) return true;
  const normalized = ` ${normalizeWords(title)} `;
  return requiredTokens.every((token) => normalized.includes(` ${token} `));
}

function inferRecordIdentity(value) {
  const title = cleanText(value) ?? "Untitled eBay vinyl listing";
  const parts = title.split(/\s+(?:-|–|—|\|)\s+/).map(cleanText).filter(Boolean);
  if (parts.length >= 2 && parts[0].length <= 120) {
    return { artist: parts[0], title: parts.slice(1).join(" - ") };
  }
  return { artist: "Unknown Artist", title };
}

function ebayPurchaseDedupeKey(candidate) {
  const itemId = cleanText(candidate.ebayItemId)?.toLowerCase();
  if (itemId) return `item:${itemId}`;
  const url = canonicalUrl(candidate.sourceUrl);
  if (url) return `url:${url}`;
  return `fallback:${normalizeWords(candidate.sourceListingTitle)}:${candidate.purchasePrice}`;
}

function hasAnotherPage(payload, itemCount, offset, pageSize) {
  if (cleanText(payload.next)) return true;
  const total = nonNegativeInteger(payload.total);
  if (total !== null) return offset + itemCount < total;
  return itemCount === pageSize;
}

function overallStopReason({ complete, globalStopReason, laneReports, lanesTruncated }) {
  if (globalStopReason) return globalStopReason;
  if (lanesTruncated) return "lane_cap";
  if (complete) return "exhausted";
  if (laneReports.some((report) => report.stopReason === "page_cap")) return "page_cap";
  if (laneReports.some((report) => report.stopReason === "request_error")) return "request_error";
  if (laneReports.some((report) => report.stopReason === "http_error")) return "http_error";
  if (laneReports.some((report) => report.stopReason === "invalid_response")) return "invalid_response";
  return "incomplete";
}

async function readJsonResponse(response) {
  try {
    const text = await response.text();
    if (!text.trim()) return { error: null, value: {} };
    return { error: null, value: JSON.parse(text) };
  } catch (error) {
    return { error: `Invalid JSON response: ${errorMessage(error)}`, value: null };
  }
}

function apiErrorMessage(response, payload, parseError) {
  const messages = Array.isArray(payload?.errors)
    ? payload.errors.map((error) => cleanText(error?.message) ?? cleanText(error?.longMessage)).filter(Boolean)
    : [];
  const detail = messages.join("; ") || parseError || cleanText(response.statusText) || "Request failed";
  return `eBay Browse API failed (${response.status}): ${detail}`;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("eBay Browse API request timed out.")), timeoutMs);
  try {
    const { signal: _signal, ...requestInit } = init;
    return await fetchImpl(url, { ...requestInit, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

function parseRetryAfterMs(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const seconds = Number(cleaned);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(cleaned);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function normalizeEbayItemUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!/(?:^|\.)ebay\.(?:com|co\.uk|ca|com\.au|de|fr|it|es)$/i.test(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function cleanEndpoint(value) {
  const url = new URL(String(value));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("eBay endpoint must use HTTP or HTTPS.");
  return url.origin;
}

function normalizeSort(value) {
  const cleaned = cleanText(value);
  return ["price", "-price", "newlyListed", "distance"].includes(cleaned) ? cleaned : "price";
}

function stableToken(value) {
  return String(value).trim().replace(/[^a-z0-9|_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "listing";
}

function normalizeWords(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIdentifier(value) {
  const cleaned = cleanText(value)?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned ? cleaned.slice(0, 80) : null;
}

function cleanText(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
}

function positiveMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function optionalPositiveMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  return positiveMoney(value);
}

function nonNegativeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function boundedPercentage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function formatFilterMoney(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function maxNullable(left, right) {
  if (right === null) return left;
  return left === null ? right : Math.max(left, right);
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCountObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const cleaned = cleanText(value);
    const key = cleaned?.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rejection(reason) {
  return { accepted: false, reason };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
