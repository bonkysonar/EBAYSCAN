const WALMART_ORIGIN = "https://www.walmart.com";
const PRODUCT_URL_KEYS = [
  "canonicalUrl",
  "canonicalURL",
  "productPageUrl",
  "productUrl",
  "itemPageUrl",
  "productLink",
  "url",
];

export function isFirstPartyWalmartOffer(item) {
  return item?.soldByWalmart === true;
}

export function extractWalmartStructuredPayloads(html) {
  const source = String(html ?? "");
  const payloads = [];
  const parsedBodies = new Set();

  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = parseAttributes(match[1]);
    const body = decodeScriptEntities(match[2]).trim();
    const id = attributes.id?.toLowerCase() ?? "";
    const type = attributes.type?.toLowerCase() ?? "";
    const looksStructured =
      id === "__next_data__" ||
      type.startsWith("application/ld+json") ||
      (type.startsWith("application/json") && /\b(?:usItemId|searchResult|priceInfo|product)\b/i.test(body));
    if (!looksStructured || !body || parsedBodies.has(body)) continue;

    const parsed = safelyParseJson(body);
    if (parsed !== null) {
      payloads.push(parsed);
      parsedBodies.add(body);
    }
  }

  for (const marker of source.matchAll(/(?:window|self)?\s*\.?\s*__NEXT_DATA__\s*=/g)) {
    const body = balancedJsonAfter(source, (marker.index ?? 0) + marker[0].length);
    if (!body || parsedBodies.has(body)) continue;
    const parsed = safelyParseJson(body);
    if (parsed !== null) {
      payloads.push(parsed);
      parsedBodies.add(body);
    }
  }

  return payloads;
}

export function parseWalmartCatalogPage(input, fallbackPageUrl = null) {
  const normalized = normalizeParserInput(input, fallbackPageUrl);
  const payloads = [
    ...normalized.payloads,
    ...(normalized.html ? extractWalmartStructuredPayloads(normalized.html) : []),
  ];
  const products = [];
  const paginationCandidates = [];

  for (const payload of payloads) {
    walkStructuredData(payload, (node, path) => {
      const pagination = parsePaginationNode(node, path);
      if (pagination) paginationCandidates.push(pagination);
      const product = normalizeWalmartProduct(node, normalized.pageUrl);
      if (product) products.push(product);
    });
  }

  return {
    items: dedupeWalmartProducts(products),
    pagination: selectPagination(paginationCandidates, normalized.pageUrl),
    payloadCount: payloads.length,
  };
}

export function assessWalmartAbsolutePrice(price, thresholds = {}) {
  const normalizedPrice = finitePrice(price);
  const unconditionalMax = finitePrice(thresholds.unconditionalMax) ?? 15;
  const conditionalMax = Math.max(
    unconditionalMax,
    finitePrice(thresholds.conditionalMax) ?? 20,
  );
  const tier =
    normalizedPrice !== null && normalizedPrice <= unconditionalMax
      ? "unconditional"
      : normalizedPrice !== null && normalizedPrice <= conditionalMax
        ? "conditional"
        : "ineligible";

  return {
    eligible: tier !== "ineligible",
    price: normalizedPrice,
    requiresDemandSupport: tier === "conditional",
    tier,
  };
}

function normalizeParserInput(input, fallbackPageUrl) {
  if (typeof input === "string") {
    return { html: input, pageUrl: normalizePageUrl(fallbackPageUrl), payloads: [] };
  }

  if (Array.isArray(input)) {
    return { html: null, pageUrl: normalizePageUrl(fallbackPageUrl), payloads: [input] };
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    const isOptionsObject = ["html", "pageUrl", "payload", "payloads"].some((key) =>
      Object.prototype.hasOwnProperty.call(input, key),
    );
    if (!isOptionsObject) {
      return {
        html: null,
        pageUrl: normalizePageUrl(fallbackPageUrl),
        payloads: [input],
      };
    }

    return {
      html: typeof input.html === "string" ? input.html : null,
      pageUrl: normalizePageUrl(input.pageUrl ?? fallbackPageUrl),
      payloads: [
        ...(input.payload === null || input.payload === undefined ? [] : [input.payload]),
        ...(Array.isArray(input.payloads) ? input.payloads : []),
      ].filter((payload) => payload && typeof payload === "object"),
    };
  }

  return { html: null, pageUrl: normalizePageUrl(fallbackPageUrl), payloads: [] };
}

function normalizeWalmartProduct(node, pageUrl) {
  if (!isObject(node)) return null;

  const title = firstCleanString(node.name, node.productName, node.productTitle, node.title);
  if (!title) return null;

  const rawUrl = firstCleanString(...PRODUCT_URL_KEYS.map((key) => node[key]));
  let canonicalUrl = normalizeProductUrl(rawUrl, pageUrl);
  const schemaProduct = schemaTypes(node).some(
    (type) => type === "product" || type.endsWith("/product"),
  );
  let usItemId = cleanIdentifier(node.usItemId ?? node.productId ?? node.itemId);
  if (!usItemId) usItemId = itemIdFromUrl(canonicalUrl);

  const sku = cleanIdentifier(node.sku ?? node.offerId);
  const upc = cleanGtin(node.upc ?? node.gtin14 ?? node.gtin13 ?? node.gtin12 ?? node.gtin ?? node.barcode);
  const currentPrice = firstPrice(
    node.priceInfo?.currentPrice,
    node.priceInfo?.price,
    node.currentPrice,
    node.salePrice,
    node.offerPrice,
    node.productPrice,
    node.offers?.price,
    node.price,
  );
  const rawWasPrice = firstPrice(
    node.priceInfo?.wasPrice,
    node.priceInfo?.comparisonPrice,
    node.priceInfo?.listPrice,
    node.priceInfo?.originalPrice,
    node.wasPrice,
    node.compareAtPrice,
    node.comparisonPrice,
    node.strikeThroughPrice,
    node.listPrice,
    node.originalPrice,
  );
  const wasPrice =
    rawWasPrice !== null && (currentPrice === null || rawWasPrice > currentPrice)
      ? rawWasPrice
      : null;

  if (!usItemId && canonicalUrl) usItemId = itemIdFromUrl(canonicalUrl);
  if (!canonicalUrl && usItemId) canonicalUrl = `${WALMART_ORIGIN}/ip/${encodeURIComponent(usItemId)}`;

  const stableId =
    usItemId
      ? `walmart:item:${usItemId}`
      : upc
        ? `gtin:${upc}`
        : sku && schemaProduct
          ? `walmart:sku:${sku}`
          : canonicalUrl
            ? `walmart:url:${new URL(canonicalUrl).pathname.toLowerCase()}`
            : null;
  const productEvidence =
    usItemId ||
    canonicalUrl ||
    (schemaProduct && (sku || upc));
  const pricingEvidence = currentPrice !== null || node.priceInfo || node.offers;
  const strongPartialProduct = Boolean(usItemId && canonicalUrl);
  if (
    !stableId ||
    !productEvidence ||
    (!pricingEvidence && !schemaProduct && !strongPartialProduct)
  ) {
    return null;
  }

  const sellerName = firstCleanString(
    node.sellerName,
    node.sellerDisplayName,
    node.seller?.displayName,
    node.seller?.name,
    node.offers?.seller?.name,
    typeof node.offers?.seller === "string" ? node.offers.seller : null,
  );
  const sellerId = cleanIdentifier(
    node.sellerId ??
      node.seller?.id ??
      node.seller?.sellerId ??
      node.offers?.seller?.sellerId,
  );
  const stock = parseStock(node);
  const rating = boundedNumber(
    firstNumber(
      node.averageRating,
      node.rating,
      node.ratingValue,
      node.reviewsAverageRating,
      node.aggregateRating?.ratingValue,
    ),
    0,
    5,
  );
  const reviewCount = nonNegativeInteger(
    firstNumber(
      node.numberOfReviews,
      node.reviewCount,
      node.ratingCount,
      node.reviewsCount,
      node.aggregateRating?.reviewCount,
      node.aggregateRating?.ratingCount,
    ),
  );

  return {
    available: stock.available,
    badges: collectBadges(node),
    canonicalUrl,
    currency: cleanCurrency(
      node.priceInfo?.currentPrice?.currencyUnit ??
        node.priceInfo?.currentPrice?.currency ??
        node.priceInfo?.currencyUnit ??
        node.currency ??
        node.offers?.priceCurrency ??
        "USD",
    ),
    currentPrice,
    fulfillment: collectFulfillmentMethods(node),
    inventoryQuantity: stock.inventoryQuantity,
    rating,
    reviewCount,
    sellerId,
    sellerName,
    sku,
    soldByWalmart: sellerName ? isWalmartSeller(sellerName) : null,
    stableId,
    stockStatus: stock.status,
    title,
    unitPrice: firstPrice(node.priceInfo?.unitPrice, node.unitPrice),
    upc,
    usItemId,
    wasPrice,
  };
}

function dedupeWalmartProducts(products) {
  const byStableId = new Map();
  for (const product of products) {
    const existing = byStableId.get(product.stableId);
    byStableId.set(product.stableId, existing ? mergeProducts(existing, product) : product);
  }
  return [...byStableId.values()];
}

function mergeProducts(existing, incoming) {
  const currentPrice = existing.currentPrice ?? incoming.currentPrice;
  const possibleWasPrices = [existing.wasPrice, incoming.wasPrice]
    .filter((price) => price !== null && (currentPrice === null || price > currentPrice));
  return {
    ...existing,
    available: mergeAvailability(existing.available, incoming.available),
    badges: uniqueStrings([...existing.badges, ...incoming.badges]),
    canonicalUrl: existing.canonicalUrl ?? incoming.canonicalUrl,
    currency: existing.currency ?? incoming.currency,
    currentPrice,
    fulfillment: uniqueStrings([...existing.fulfillment, ...incoming.fulfillment]),
    inventoryQuantity: existing.inventoryQuantity ?? incoming.inventoryQuantity,
    rating: existing.rating ?? incoming.rating,
    reviewCount: existing.reviewCount ?? incoming.reviewCount,
    sellerId: existing.sellerId ?? incoming.sellerId,
    sellerName: existing.sellerName ?? incoming.sellerName,
    sku: existing.sku ?? incoming.sku,
    soldByWalmart: existing.soldByWalmart ?? incoming.soldByWalmart,
    stockStatus: mergeStockStatus(existing.stockStatus, incoming.stockStatus),
    unitPrice: existing.unitPrice ?? incoming.unitPrice,
    upc: existing.upc ?? incoming.upc,
    usItemId: existing.usItemId ?? incoming.usItemId,
    wasPrice: possibleWasPrices.length ? Math.max(...possibleWasPrices) : null,
  };
}

function mergeAvailability(existing, incoming) {
  if (existing === true || incoming === true) return true;
  if (existing === false && incoming === false) return false;
  return existing ?? incoming ?? null;
}

function mergeStockStatus(existing, incoming) {
  const statuses = new Set([existing, incoming]);
  if (statuses.has("in_stock")) return "in_stock";
  if (statuses.has("limited_stock")) return "limited_stock";
  if (statuses.has("out_of_stock") && !statuses.has("unknown")) return "out_of_stock";
  return "unknown";
}

function parsePaginationNode(node, path) {
  if (!isObject(node)) return null;
  const maxPage = positiveInteger(
    firstNumber(node.maxPage, node.totalPages, node.pageCount, node.numPages, node.lastPage),
  );
  const currentPage = positiveInteger(
    firstNumber(node.currentPage, node.pageNumber, node.page, node.current),
  );
  const pageSize = positiveInteger(
    firstNumber(node.pageSize, node.pageLimit, node.itemsPerPage, node.limit),
  );
  const totalCount = nonNegativeInteger(
    firstNumber(node.totalCount, node.totalResults, node.totalItems, node.resultCount),
  );
  const explicitNextPage = positiveInteger(
    firstNumber(node.nextPage, node.nextPageNumber),
  );
  const explicitNextPageUrl = firstCleanString(node.nextPageUrl, node.nextUrl, node.next);
  const hasNextPage = firstBoolean(node.hasNextPage, node.hasNext, node.moreResults);
  const pathSuggestsPagination = path.some((segment) =>
    /(?:pagination|pageInfo|paging)/i.test(segment),
  );

  if (
    maxPage === null &&
    explicitNextPage === null &&
    explicitNextPageUrl === null &&
    hasNextPage === null
  ) {
    return null;
  }
  if (!pathSuggestsPagination && maxPage === null) return null;

  return {
    currentPage,
    explicitNextPage,
    explicitNextPageUrl,
    hasNextPage,
    maxPage,
    pageSize,
    totalCount,
  };
}

function selectPagination(candidates, pageUrl) {
  const urlPage = pageNumberFromUrl(pageUrl);
  const best = [...candidates].sort((left, right) => {
    const leftScore = paginationScore(left);
    const rightScore = paginationScore(right);
    return rightScore - leftScore || (right.maxPage ?? 0) - (left.maxPage ?? 0);
  })[0] ?? null;
  const currentPage = best?.currentPage ?? urlPage ?? 1;
  const maxPage = best?.maxPage ?? null;
  const explicitHasNext = best?.hasNextPage ?? null;
  const hasNextPage =
    explicitHasNext ??
    (maxPage !== null
      ? currentPage < maxPage
      : best
        ? best.explicitNextPage !== null || Boolean(best.explicitNextPageUrl)
        : false);
  const nextPage =
    hasNextPage
      ? best?.explicitNextPage ?? (maxPage === null || currentPage < maxPage ? currentPage + 1 : null)
      : null;
  const nextPageUrl =
    hasNextPage
      ? normalizeNextPageUrl(best?.explicitNextPageUrl, pageUrl) ??
        (nextPage !== null ? buildPageUrl(pageUrl, nextPage) : null)
      : null;

  return {
    currentPage,
    hasNextPage: Boolean(hasNextPage),
    maxPage,
    nextPage,
    nextPageUrl,
    pageSize: best?.pageSize ?? null,
    totalCount: best?.totalCount ?? null,
  };
}

function paginationScore(candidate) {
  return (
    (candidate.maxPage !== null ? 8 : 0) +
    (candidate.currentPage !== null ? 4 : 0) +
    (candidate.totalCount !== null ? 2 : 0) +
    (candidate.pageSize !== null ? 1 : 0) +
    (candidate.explicitNextPage !== null || candidate.explicitNextPageUrl ? 2 : 0)
  );
}

function buildPageUrl(pageUrl, pageNumber) {
  if (!pageUrl) return null;
  try {
    const parsed = new URL(pageUrl, WALMART_ORIGIN);
    parsed.searchParams.set("page", String(pageNumber));
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeNextPageUrl(value, pageUrl) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = new URL(value, pageUrl ?? WALMART_ORIGIN);
    if (!isWalmartHostname(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function pageNumberFromUrl(pageUrl) {
  if (!pageUrl) return null;
  try {
    return positiveInteger(Number(new URL(pageUrl, WALMART_ORIGIN).searchParams.get("page")));
  } catch {
    return null;
  }
}

function parseStock(node) {
  const explicitAvailable = firstBoolean(
    node.isInStock,
    node.inStock,
    node.isAvailable,
    typeof node.available === "boolean" ? node.available : null,
  );
  const rawStatus = firstNestedString(
    node.availabilityStatusDisplayValue,
    node.availabilityStatus,
    node.availabilityStatusV2,
    node.stockStatus,
    node.inventoryStatus,
    node.offers?.availability,
    typeof node.availability === "string" ? node.availability : null,
  );
  const status = normalizeStockStatus(rawStatus, explicitAvailable);
  const available =
    explicitAvailable ??
    (status === "in_stock" || status === "limited_stock"
      ? true
      : status === "out_of_stock"
        ? false
        : null);
  const inventoryQuantity = nonNegativeInteger(
    firstNumber(node.availableQuantity, node.inventoryQuantity, node.stockQuantity),
  );
  return { available, inventoryQuantity, status };
}

function normalizeStockStatus(value, explicitAvailable) {
  const normalized = String(value ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(?:out ?of ?stock|unavailable|sold out|not available)\b/.test(normalized)) {
    return "out_of_stock";
  }
  if (/\b(?:limited|low stock|few left|only \d+ left)\b/.test(normalized)) {
    return "limited_stock";
  }
  if (/\b(?:in ?stock|available|availability instock)\b/.test(normalized)) {
    return "in_stock";
  }
  if (explicitAvailable === true) return "in_stock";
  if (explicitAvailable === false) return "out_of_stock";
  return "unknown";
}

function collectFulfillmentMethods(node) {
  const methods = new Set();
  const containers = [
    node.fulfillment,
    node.fulfillmentType,
    node.fulfillmentTypes,
    node.fulfillmentSummary,
    node.fulfillmentOptions,
    node.fulfillmentDetails,
    node.shippingOption,
    node.deliveryOption,
  ];

  for (const container of containers) {
    collectFulfillmentFromValue(container, methods);
  }

  return [...methods];
}

function collectFulfillmentFromValue(value, methods, key = null, seen = new WeakSet()) {
  if (value === null || value === undefined) return;
  const source = `${key ?? ""} ${typeof value === "string" ? value : ""}`.toLowerCase();
  const explicitlyUnavailable =
    value === false ||
    (isObject(value) &&
      (value.available === false ||
        value.isAvailable === false ||
        /\b(?:unavailable|not available|disabled)\b/i.test(
          firstNestedString(value.status, value.availabilityStatus) ?? "",
        )));

  if (!explicitlyUnavailable) {
    if (/\b(?:shipping|shipped|ship)\b/.test(source)) methods.add("shipping");
    if (/\b(?:pickup|curbside)\b/.test(source)) methods.add("pickup");
    if (/\b(?:delivery|delivered)\b/.test(source)) methods.add("delivery");
  }

  if (explicitlyUnavailable && isObject(value)) return;
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectFulfillmentFromValue(entry, methods, key, seen));
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    collectFulfillmentFromValue(childValue, methods, childKey, seen);
  }
}

function collectBadges(node) {
  const preferredBadges = [];
  const fallbackBadges = [];
  const containers = [
    node.badge,
    node.badges,
    node.badgeInfo,
    node.badgesInfo,
    node.badging,
  ];

  for (const container of containers) {
    walkValues(container, (value, key) => {
      if (typeof value === "string" && (!key || /(?:text|name|label|badge)/i.test(key))) {
        const cleaned = cleanBadge(value);
        if (cleaned) preferredBadges.push(cleaned);
      } else if (
        typeof value === "string" &&
        key &&
        (/(?:key)/i.test(key) ||
          (/(?:type)/i.test(key) && !/^(?:badge|flag|label|tag)$/i.test(value.trim())))
      ) {
        const cleaned = cleanBadge(value);
        if (cleaned) fallbackBadges.push(cleaned);
      }
      if (
        value === true &&
        key &&
        /\b(?:best|popular|rollback|clearance|reduced|sale|exclusive)\b/i.test(key)
      ) {
        fallbackBadges.push(cleanBadge(key));
      }
    });
  }

  for (const [key, value] of Object.entries(node)) {
    if (
      value === true &&
      /^(?:is)?(?:bestSeller|rollback|clearance|reducedPrice|exclusive)$/i.test(key)
    ) {
      fallbackBadges.push(cleanBadge(key));
    }
  }

  return uniqueStrings([...preferredBadges, ...fallbackBadges].filter(Boolean));
}

function cleanBadge(value) {
  const cleaned = String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^is\s+/i, "")
    .trim();
  if (!cleaned || cleaned.length > 80) return null;
  if (
    /^(?:badge|base badge|flag|flags|label|module\s*\d*|prod(?:uct)? tile badge(?: module\s*\d*)?|text|tag)$/i.test(
      cleaned,
    )
  ) {
    return null;
  }
  return cleaned;
}

function walkStructuredData(root, visitor) {
  const seen = new WeakSet();
  const visit = (value, path) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) visitor(value, path);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, String(index)]));
      return;
    }
    for (const [key, entry] of Object.entries(value)) visit(entry, [...path, key]);
  };
  visit(root, []);
}

function walkValues(root, visitor, key = null, seen = new WeakSet()) {
  if (root === null || root === undefined) return;
  visitor(root, key);
  if (typeof root !== "object" || seen.has(root)) return;
  seen.add(root);
  if (Array.isArray(root)) {
    root.forEach((value) => walkValues(value, visitor, key, seen));
    return;
  }
  for (const [childKey, value] of Object.entries(root)) {
    walkValues(value, visitor, childKey, seen);
  }
}

function firstPrice(...values) {
  for (const value of values) {
    const price = finitePrice(value);
    if (price !== null) return price;
  }
  return null;
}

function finitePrice(value, seen = new WeakSet()) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/(?:^|[$\s])([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  if (typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const key of ["price", "value", "amount", "displayValue", "priceString", "displayPrice"]) {
    const price = finitePrice(value[key], seen);
    if (price !== null) return price;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number =
      typeof value === "string"
        ? Number(value.match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/)?.[0]?.replace(/,/g, ""))
        : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(?:true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
  }
  return null;
}

function firstNestedString(...values) {
  for (const value of values) {
    const nested = nestedString(value);
    if (nested) return nested;
  }
  return null;
}

function nestedString(value, seen = new WeakSet()) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const key of ["value", "display", "displayValue", "status", "availability", "label", "text"]) {
    const result = nestedString(value[key], seen);
    if (result) return result;
  }
  return null;
}

function firstCleanString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeProductUrl(value, pageUrl) {
  if (!value) return null;
  try {
    const parsed = new URL(value, pageUrl ?? WALMART_ORIGIN);
    if (!isWalmartHostname(parsed.hostname)) return null;
    parsed.hash = "";
    if (/\/ip\//i.test(parsed.pathname)) parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function itemIdFromUrl(value) {
  if (!value) return null;
  try {
    const pathname = new URL(value, WALMART_ORIGIN).pathname;
    return cleanIdentifier(pathname.match(/\/ip\/(?:[^/]+\/)?([a-z0-9_-]+)\/?$/i)?.[1]);
  } catch {
    return null;
  }
}

function normalizePageUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value), WALMART_ORIGIN);
    if (!isWalmartHostname(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isWalmartHostname(value) {
  return /(?:^|\.)walmart\.com$/i.test(String(value ?? ""));
}

function isWalmartSeller(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return /^(?:walmart|walmart com|walmart inc|walmart stores|walmart stores inc)$/.test(normalized);
}

function schemaTypes(node) {
  const values = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return values.map((value) => String(value ?? "").toLowerCase());
}

function cleanIdentifier(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned && cleaned.length <= 200 ? cleaned : null;
}

function cleanGtin(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\D/g, "");
  return cleaned.length >= 8 && cleaned.length <= 14 ? cleaned : null;
}

function cleanCurrency(value) {
  const cleaned = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : null;
}

function positiveInteger(value) {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : null;
}

function nonNegativeInteger(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function boundedNumber(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value).toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseAttributes(value) {
  const attributes = {};
  for (const match of String(value ?? "").matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function decodeScriptEntities(value) {
  return String(value ?? "")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function safelyParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function balancedJsonAfter(source, startIndex) {
  let start = startIndex;
  while (start < source.length && /\s/.test(source[start])) start += 1;
  if (source[start] !== "{" && source[start] !== "[") return null;

  const opening = source[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
