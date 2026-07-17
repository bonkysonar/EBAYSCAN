const PRODUCT_URL_KEYS = [
  "canonical",
  "canonicalUrl",
  "canonicalURL",
  "canonical_url",
  "productUrl",
  "productURL",
  "product_url",
  "productPageUrl",
  "product_page_url",
  "productHref",
  "pdpUrl",
  "pdpURL",
  "pdp_url",
  "buyUrl",
  "buy_url",
  "url",
];

const NON_PRODUCT_SCHEMA_TYPES = new Set([
  "article",
  "breadcrumblist",
  "collectionpage",
  "event",
  "imageobject",
  "listitem",
  "offer",
  "organization",
  "person",
  "searchresultspage",
  "service",
  "webpage",
  "website",
]);

const NOISE_PATH_SEGMENTS = new Set([
  "breadcrumb",
  "breadcrumbs",
  "facet",
  "facets",
  "filter",
  "filters",
  "footer",
  "header",
  "menu",
  "navigation",
  "seo",
]);

export function extractStructuredRetailPayloads(html) {
  return extractStructuredPayloadDescriptors(html).map((descriptor) => descriptor.payload);
}

export function parseStructuredRetailCatalog(input, fallbackPageUrl = null) {
  const normalized = normalizeParserInput(input, fallbackPageUrl);
  const descriptors = [
    ...normalized.descriptors,
    ...(normalized.html ? extractStructuredPayloadDescriptors(normalized.html) : []),
  ];
  const candidates = [];

  for (const descriptor of descriptors) {
    walkStructuredData(descriptor.payload, (node, path) => {
      const candidate = normalizeStructuredProduct(node, {
        pageUrl: normalized.pageUrl,
        path,
        sourceKind: descriptor.kind,
      });
      if (candidate) candidates.push(candidate);
    });
  }

  return {
    items: dedupeStructuredProducts(candidates),
    payloadCount: descriptors.length,
  };
}

function extractStructuredPayloadDescriptors(html) {
  const source = String(html ?? "");
  const descriptors = [];
  const parsedBodies = new Set();

  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = parseAttributes(match[1]);
    const id = String(attributes.id ?? "").trim().toLowerCase();
    const type = String(attributes.type ?? "").split(";")[0].trim().toLowerCase();
    const kind =
      id === "__next_data__"
        ? "next_data"
        : type === "application/ld+json"
          ? "json_ld"
          : type === "application/json" || /^application\/[^;\s]+\+json$/.test(type)
            ? "application_json"
            : null;
    const body = stripScriptWrappers(match[2]);
    if (!kind || !body || parsedBodies.has(body)) continue;

    const payload = safelyParseJson(body);
    if (payload === null) continue;
    descriptors.push({ kind, payload });
    parsedBodies.add(body);
  }

  for (const marker of source.matchAll(/(?:(?:window|self|globalThis)\s*\.\s*)?__NEXT_DATA__\s*=/g)) {
    const body = balancedJsonAfter(source, (marker.index ?? 0) + marker[0].length);
    if (!body || parsedBodies.has(body)) continue;
    const payload = safelyParseJson(body);
    if (payload === null) continue;
    descriptors.push({ kind: "next_data", payload });
    parsedBodies.add(body);
  }

  return descriptors;
}

function normalizeParserInput(input, fallbackPageUrl) {
  const pageUrl = normalizePageUrl(fallbackPageUrl);
  if (typeof input === "string") {
    const directPayload = safelyParseJson(input.trim());
    return directPayload === null
      ? { descriptors: [], html: input, pageUrl }
      : { descriptors: [{ kind: "direct_json", payload: directPayload }], html: null, pageUrl };
  }

  if (Array.isArray(input)) {
    return {
      descriptors: [{ kind: "direct_json", payload: input }],
      html: null,
      pageUrl,
    };
  }

  if (isObject(input)) {
    const isOptionsObject = ["html", "pageUrl", "payload", "payloads"].some((key) =>
      Object.prototype.hasOwnProperty.call(input, key),
    );
    if (!isOptionsObject) {
      return {
        descriptors: [{ kind: "direct_json", payload: input }],
        html: null,
        pageUrl,
      };
    }

    return {
      descriptors: [
        ...(input.payload === null || input.payload === undefined
          ? []
          : [{ kind: "direct_json", payload: input.payload }]),
        ...(Array.isArray(input.payloads)
          ? input.payloads.map((payload) => ({ kind: "direct_json", payload }))
          : []),
      ].filter((descriptor) => descriptor.payload && typeof descriptor.payload === "object"),
      html: typeof input.html === "string" ? input.html : null,
      pageUrl: normalizePageUrl(input.pageUrl ?? fallbackPageUrl),
    };
  }

  return { descriptors: [], html: null, pageUrl };
}

function normalizeStructuredProduct(node, context) {
  if (!isObject(node)) return null;

  const types = schemaTypes(node);
  const schemaProduct = types.some((type) =>
    ["product", "productgroup", "productmodel"].includes(type),
  );
  if (!schemaProduct && types.some((type) => NON_PRODUCT_SCHEMA_TYPES.has(type))) return null;
  if (!schemaProduct && pathLooksLikeNoise(context.path)) return null;

  const title = firstCleanText(
    node.title,
    node.name,
    node.productTitle,
    node.product_title,
    node.product_name,
  );
  if (!title || isNoiseTitle(title)) return null;

  const rawCanonicalUrl = firstUrlValue(...PRODUCT_URL_KEYS.map((key) => node[key]));
  let canonicalUrl = normalizeHttpUrl(rawCanonicalUrl, context.pageUrl);
  if (canonicalUrl && isObviousNonProductUrl(canonicalUrl)) canonicalUrl = null;

  const sku = cleanIdentifier(
    node.sku ??
      node.SKU ??
      node.productSku ??
      node.product_sku ??
      node.merchantSku,
  );
  const explicitUpc = cleanGtin(node.upc ?? node.UPC ?? node.barcode);
  const explicitGtin = cleanGtin(
    node.gtin14 ??
      node.gtin13 ??
      node.gtin12 ??
      node.gtin8 ??
      node.gtin ??
      explicitUpc,
  );
  const upc = explicitUpc ?? (explicitGtin?.length === 12 ? explicitGtin : null);
  const gtin = explicitGtin ?? upc;
  const productId = cleanIdentifier(
    node.productId ??
      node.productID ??
      node.product_id ??
      node.itemId ??
      node.itemID ??
      node.item_id ??
      node.usItemId,
  );
  const tcin = cleanIdentifier(node.tcin ?? node.TCIN);
  const offers = collectOfferObjects(node.offers);
  const currentPrice = firstPrice(
    node.currentPrice,
    node.current_price,
    node.priceInfo?.currentPrice,
    node.priceInfo?.salePrice,
    node.priceData?.currentPrice,
    node.priceData?.salePrice,
    node.pricing?.currentPrice,
    node.pricing?.current,
    node.pricing?.salePrice,
    node.salePrice,
    node.sale_price,
    node.offerPrice,
    node.offer_price,
    node.lowPrice,
    selectOfferPrice(offers),
    node.price,
  );
  const rawRegularPrice = firstPrice(
    node.regularPrice,
    node.regular_price,
    node.priceInfo?.regularPrice,
    node.priceInfo?.wasPrice,
    node.priceInfo?.comparisonPrice,
    node.priceInfo?.listPrice,
    node.priceData?.regularPrice,
    node.priceData?.originalPrice,
    node.priceData?.listPrice,
    node.pricing?.regularPrice,
    node.pricing?.originalPrice,
    node.pricing?.listPrice,
    node.originalPrice,
    node.original_price,
    node.listPrice,
    node.list_price,
    node.wasPrice,
    node.was_price,
    node.compareAtPrice,
    node.compare_at_price,
    node.comparisonPrice,
    node.strikeThroughPrice,
    node.msrp,
    selectOfferRegularPrice(offers),
  );
  const regularPrice =
    rawRegularPrice !== null && (currentPrice === null || rawRegularPrice > currentPrice)
      ? rawRegularPrice
      : null;
  const availability = normalizeAvailability(
    firstAvailabilityValue(
      node.availability,
      node.availabilityStatus,
      node.availability_status,
      node.availabilityStatusDisplayValue,
      node.availabilityStatusV2,
      node.stockStatus,
      node.stock_status,
      node.stock,
      node.inventoryStatus,
      node.inventory_status,
      node.isInStock,
      node.inStock,
      node.isAvailable,
      typeof node.available === "boolean" ? node.available : null,
      ...offers.map((offer) => offer.availability),
      ...offers.map((offer) => offer.availabilityStatus),
      ...offers.map((offer) => offer.inStock),
      ...offers.map((offer) => offer.available),
    ),
  );
  const available =
    availability === "in_stock" || availability === "limited_stock"
      ? true
      : availability === "out_of_stock"
        ? false
        : null;
  const imageUrl = normalizeHttpUrl(
    firstImageValue(
      node.imageUrl,
      node.imageURL,
      node.image_url,
      node.primaryImageUrl,
      node.primary_image_url,
      node.thumbnailUrl,
      node.thumbnail_url,
      node.primaryImage,
      node.thumbnail,
      node.image,
      node.images,
    ),
    context.pageUrl,
  );
  const currency = cleanCurrency(
    firstCleanText(
      node.priceCurrency,
      node.currency,
      node.currencyCode,
      node.priceInfo?.currency,
      node.priceInfo?.currencyUnit,
      node.priceInfo?.currentPrice?.currency,
      node.priceInfo?.currentPrice?.currencyUnit,
      ...offers.map((offer) => offer.priceCurrency),
      ...offers.map((offer) => offer.currency),
    ),
  );

  const identityEvidence = [canonicalUrl, sku, gtin, upc, productId, tcin].filter(Boolean);
  const commerceEvidence =
    currentPrice !== null ||
    regularPrice !== null ||
    availability !== "unknown" ||
    offers.some((offer) => firstPrice(offer.price, offer.lowPrice, offer.currentPrice) !== null);
  const schemaEvidence = schemaProduct && (identityEvidence.length > 0 || commerceEvidence || imageUrl);
  const genericEvidence = identityEvidence.length > 0 && commerceEvidence;
  if (!schemaEvidence && !genericEvidence) return null;

  const stableId = buildStableId({ canonicalUrl, gtin, productId, sku, tcin, upc });
  if (!stableId) return null;

  return {
    available,
    availability,
    canonicalUrl,
    currency,
    currentPrice,
    gtin,
    imageUrl,
    productId,
    regularPrice,
    sku,
    sourceKinds: [context.sourceKind],
    stableId,
    tcin,
    title,
    upc,
  };
}

function dedupeStructuredProducts(candidates) {
  const items = [];
  const identityToIndex = new Map();

  for (const candidate of candidates) {
    const candidateKeys = identityKeys(candidate);
    const matchingIndexes = [
      ...new Set(
        candidateKeys
          .map((key) => identityToIndex.get(key))
          .filter((index) => index !== undefined && items[index] !== null),
      ),
    ].sort((left, right) => left - right);

    if (matchingIndexes.length === 0) {
      const index = items.length;
      items.push(candidate);
      candidateKeys.forEach((key) => identityToIndex.set(key, index));
      continue;
    }

    const targetIndex = matchingIndexes[0];
    let merged = items[targetIndex];
    for (const index of matchingIndexes.slice(1)) {
      merged = mergeStructuredProducts(merged, items[index]);
      items[index] = null;
    }
    merged = mergeStructuredProducts(merged, candidate);
    items[targetIndex] = merged;

    for (const [key, index] of identityToIndex.entries()) {
      if (matchingIndexes.includes(index)) identityToIndex.set(key, targetIndex);
    }
    identityKeys(merged).forEach((key) => identityToIndex.set(key, targetIndex));
  }

  return items.filter(Boolean);
}

function mergeStructuredProducts(existing, incoming) {
  const currentPrice = minimumNonNull(existing.currentPrice, incoming.currentPrice);
  const regularPrice = maximumNonNull(
    [existing.regularPrice, incoming.regularPrice].filter(
      (price) => price !== null && (currentPrice === null || price > currentPrice),
    ),
  );
  const merged = {
    available: mergeAvailable(existing.available, incoming.available),
    availability: mergeAvailability(existing.availability, incoming.availability),
    canonicalUrl: preferredProductUrl(existing.canonicalUrl, incoming.canonicalUrl),
    currency: existing.currency ?? incoming.currency,
    currentPrice,
    gtin: existing.gtin ?? incoming.gtin,
    imageUrl: preferredImageUrl(existing.imageUrl, incoming.imageUrl),
    productId: existing.productId ?? incoming.productId,
    regularPrice,
    sku: existing.sku ?? incoming.sku,
    sourceKinds: uniqueStrings([...existing.sourceKinds, ...incoming.sourceKinds]),
    stableId: "",
    tcin: existing.tcin ?? incoming.tcin,
    title: preferredTitle(existing.title, incoming.title),
    upc: existing.upc ?? incoming.upc,
  };
  merged.available =
    merged.availability === "in_stock" || merged.availability === "limited_stock"
      ? true
      : merged.availability === "out_of_stock"
        ? false
        : merged.available;
  merged.stableId = buildStableId(merged);
  return merged;
}

function identityKeys(item) {
  return uniqueStrings([
    item.productId ? `product:${normalizeIdentity(item.productId)}` : null,
    item.tcin ? `tcin:${normalizeIdentity(item.tcin)}` : null,
    item.gtin ? `gtin:${item.gtin}` : null,
    item.upc ? `upc:${item.upc}` : null,
    item.sku ? `sku:${normalizeIdentity(item.sku)}` : null,
    item.canonicalUrl ? `url:${normalizeUrlIdentity(item.canonicalUrl)}` : null,
  ].filter(Boolean));
}

function buildStableId(item) {
  return identityKeys(item)[0] ?? null;
}

function normalizeIdentity(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUrlIdentity(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    stripTrackingParameters(parsed);
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().toLowerCase();
  } catch {
    return String(value ?? "").trim().toLowerCase();
  }
}

function preferredProductUrl(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return urlQuality(right) > urlQuality(left) ? right : left;
}

function urlQuality(value) {
  try {
    const parsed = new URL(value);
    const trackingCount = [...parsed.searchParams.keys()].filter((key) =>
      /^(?:utm_.+|ref|ref_|source|campaign|campaignid|cmpid|tracking)$/i.test(key),
    ).length;
    return parsed.pathname.split("/").filter(Boolean).length * 10 - trackingCount;
  } catch {
    return 0;
  }
}

function preferredImageUrl(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  if (left.startsWith("http://") && right.startsWith("https://")) return right;
  return left;
}

function preferredTitle(left, right) {
  const leftScore = titleQuality(left);
  const rightScore = titleQuality(right);
  return rightScore > leftScore ? right : left;
}

function titleQuality(value) {
  const title = String(value ?? "");
  return title.length + (/\b(?:vinyl|record|album|lp|edition|color|colour)\b/i.test(title) ? 20 : 0);
}

function mergeAvailability(left, right) {
  const priority = {
    unknown: 0,
    out_of_stock: 1,
    backorder: 2,
    preorder: 3,
    limited_stock: 4,
    in_stock: 5,
  };
  return priority[right] > priority[left] ? right : left;
}

function mergeAvailable(left, right) {
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return left ?? right ?? null;
}

function collectOfferObjects(value, output = [], seen = new WeakSet(), depth = 0) {
  if (!value || typeof value !== "object" || seen.has(value) || depth > 5) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectOfferObjects(entry, output, seen, depth + 1));
    return output;
  }

  if (
    [
      "price",
      "lowPrice",
      "highPrice",
      "currentPrice",
      "availability",
      "priceCurrency",
      "priceSpecification",
    ].some((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    output.push(value);
  }
  for (const key of ["offers", "items", "offer", "sellerOffers"]) {
    collectOfferObjects(value[key], output, seen, depth + 1);
  }
  return output;
}

function selectOfferPrice(offers) {
  const priced = offers
    .map((offer) => ({
      availability: normalizeAvailability(
        firstAvailabilityValue(
          offer.availability,
          offer.availabilityStatus,
          offer.inStock,
          offer.available,
        ),
      ),
      price: firstPrice(offer.currentPrice, offer.salePrice, offer.lowPrice, offer.price),
    }))
    .filter((offer) => offer.price !== null);
  const available = priced.filter((offer) =>
    ["in_stock", "limited_stock", "preorder", "backorder", "unknown"].includes(
      offer.availability,
    ),
  );
  return minimumNonNull(...(available.length ? available : priced).map((offer) => offer.price));
}

function selectOfferRegularPrice(offers) {
  return maximumNonNull(
    offers.map((offer) =>
      firstPrice(
        offer.regularPrice,
        offer.originalPrice,
        offer.listPrice,
        offer.highPrice,
        offer.wasPrice,
        offer.compareAtPrice,
        offer.priceSpecification?.regularPrice,
        offer.priceSpecification?.listPrice,
      ),
    ),
  );
}

function firstPrice(...values) {
  for (const value of values.flat()) {
    const price = finitePrice(value);
    if (price !== null) return price;
  }
  return null;
}

function finitePrice(value, seen = new WeakSet()) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? roundMoney(value) : null;
  if (typeof value === "string") {
    const cleaned = decodeHtmlEntities(value).replace(/,/g, "").trim();
    if (/%/.test(cleaned) && !/[$\u20ac\u00a3\u00a5]/u.test(cleaned)) return null;
    const match = cleaned.match(/(?:[$\u20ac\u00a3\u00a5]\s*)?([0-9]+(?:\.[0-9]+)?)/u);
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) && number > 0 ? roundMoney(number) : null;
  }
  if (typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const key of [
    "price",
    "value",
    "amount",
    "currentPrice",
    "salePrice",
    "displayValue",
    "priceString",
    "formattedPrice",
    "displayPrice",
    "minPrice",
  ]) {
    const price = finitePrice(value[key], seen);
    if (price !== null) return price;
  }
  return null;
}

function firstAvailabilityValue(...values) {
  for (const value of values.flat()) {
    if (typeof value === "boolean") return value;
    const nested = nestedString(value);
    if (nested) return nested;
  }
  return null;
}

function normalizeAvailability(value) {
  if (value === true) return "in_stock";
  if (value === false) return "out_of_stock";
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\/schema\.org\//g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "unknown";
  if (/\b(?:out of stock|outofstock|sold out|unavailable|discontinued|not available)\b/.test(normalized)) {
    return "out_of_stock";
  }
  if (/\b(?:limited stock|low stock|few left|only \d+ left)\b/.test(normalized)) {
    return "limited_stock";
  }
  if (/\b(?:pre ?order|preorder)\b/.test(normalized)) return "preorder";
  if (/\b(?:back ?order|backorder)\b/.test(normalized)) return "backorder";
  if (/\b(?:in stock|instock|available)\b/.test(normalized)) return "in_stock";
  return "unknown";
}

function firstImageValue(...values) {
  for (const value of values) {
    const image = imageValue(value);
    if (image) return image;
  }
  return null;
}

function imageValue(value, seen = new WeakSet()) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = imageValue(entry, seen);
      if (image) return image;
    }
    return null;
  }
  for (const key of [
    "url",
    "contentUrl",
    "imageUrl",
    "imageURL",
    "src",
    "thumbnailUrl",
    "thumbnail",
  ]) {
    const image = imageValue(value[key], seen);
    if (image) return image;
  }
  return null;
}

function firstUrlValue(...values) {
  for (const value of values) {
    const url = urlValue(value);
    if (url) return url;
  }
  return null;
}

function urlValue(value, seen = new WeakSet()) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const key of ["url", "href", "canonical", "canonicalUrl", "value"]) {
    const url = urlValue(value[key], seen);
    if (url) return url;
  }
  return null;
}

function nestedString(value, seen = new WeakSet()) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const key of [
    "value",
    "displayValue",
    "status",
    "availability",
    "availabilityStatus",
    "label",
    "text",
  ]) {
    const nested = nestedString(value[key], seen);
    if (nested) return nested;
  }
  return null;
}

function cleanIdentifier(value) {
  if (value === null || value === undefined) return null;
  const nested = typeof value === "object" ? nestedString(value) : String(value);
  const cleaned = String(nested ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 160 || /^(?:null|undefined|unknown|n\/a)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function cleanGtin(value) {
  const cleaned = cleanIdentifier(value)?.replace(/[^0-9]/g, "") ?? "";
  return /^(?:[0-9]{8}|[0-9]{12,14})$/.test(cleaned) ? cleaned : null;
}

function cleanCurrency(value) {
  const cleaned = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : null;
}

function firstCleanText(...values) {
  for (const value of values.flat()) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const cleaned = decodeHtmlEntities(String(value))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) return cleaned;
  }
  return null;
}

function isNoiseTitle(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 3 || normalized.length > 300) return true;
  if (/^\$?[0-9]+(?:\.[0-9]{1,2})?$/.test(normalized)) return true;
  return /^(?:account|cart|checkout|contact us|continue shopping|customer service|help|home|loading|log in|login|menu|my account|order history|privacy policy|search|shop now|sign in|sign up|terms(?: and conditions)?|view details)$/.test(
    normalized,
  );
}

function pathLooksLikeNoise(path) {
  return path.some((segment) =>
    NOISE_PATH_SEGMENTS.has(
      String(segment ?? "")
        .replace(/[^a-z0-9]+/gi, "")
        .toLowerCase(),
    ),
  );
}

function isObviousNonProductUrl(value) {
  try {
    const parsed = new URL(value);
    if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(parsed.pathname)) return true;
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return /^(?:\/$|\/(?:account|cart|checkout|contact|help|login|privacy|search|signin|terms)(?:\/|$))/.test(
      path,
    );
  } catch {
    return true;
  }
}

function normalizeHttpUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const parsed = new URL(decodeHtmlEntities(String(value)), baseUrl ?? undefined);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    stripTrackingParameters(parsed);
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizePageUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripTrackingParameters(parsed) {
  for (const key of [...parsed.searchParams.keys()]) {
    if (
      /^(?:utm_.+|ref(?:errer)?|ref_|source|campaign|campaignid|cmpid|tracking|fbclid|gclid|mc_[ce]id)$/i.test(
        key,
      )
    ) {
      parsed.searchParams.delete(key);
    }
  }
}

function schemaTypes(node) {
  const values = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return values
    .map((value) =>
      String(value ?? "")
        .toLowerCase()
        .split(/[\/#:]/)
        .filter(Boolean)
        .at(-1),
    )
    .filter(Boolean);
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
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(root, []);
}

function parseAttributes(value) {
  const attributes = {};
  for (const match of String(value ?? "").matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
  )) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attributes;
}

function stripScriptWrappers(value) {
  return String(value ?? "")
    .trim()
    .replace(/^<!--/, "")
    .replace(/-->$/, "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function safelyParseJson(value) {
  const source = String(value ?? "").trim();
  if (!source || !/^[\[{]/.test(source)) return null;
  try {
    return JSON.parse(source);
  } catch {
    const decoded = decodeHtmlEntities(source);
    if (decoded === source) return null;
    try {
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

function balancedJsonAfter(source, offset) {
  const start = source.slice(offset).search(/[\[{]/);
  if (start < 0) return null;
  const absoluteStart = offset + start;
  const opening = source[absoluteStart];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = absoluteStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth === 0) return source.slice(absoluteStart, index + 1);
  }
  return null;
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function minimumNonNull(...values) {
  const finite = values.flat().filter((value) => Number.isFinite(value));
  return finite.length ? Math.min(...finite) : null;
}

function maximumNonNull(values) {
  const finite = values.flat().filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
