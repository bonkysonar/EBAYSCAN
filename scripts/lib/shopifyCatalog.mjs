const SHOPIFY_COLLECTION_EXCLUSION =
  /\b(?:accessor(?:y|ies)|apparel|bags?|blu\s*ray|books?|cartridges?|cassettes?|cds?|cleaning|clothing|damaged|defective|dvds?|equipment|frames?|gift\s*cards?|gimmicks?|hats?|hoodies?|merch(?:andise)?|movies?|needles?|posters?|pre\s*owned|second\s*hand|shirts?|slipmats?|speakers?|storage|styl(?:us|i)|tapes?|toys?|turntables?|used)\b/i;
const SHOPIFY_SALE_COLLECTION =
  /\b(?:(?:[2-9]\d)\s*(?:off|percent)|bargains?|black\s*friday|boxing\s*day|clearance|closeouts?|deals?|deep\s*cuts?|discount(?:ed|s)?|final\s*sale|last\s*chance|markdowns?|offers?|on\s*sale|outlet|overstock|price\s*drops?|promotions?|reduced|sale|special\s*offers?|special\s*prices?|specials|warehouse)\b/i;

export function selectShopifyCollectionLanes(values, configuredUrl, limit = 6) {
  const configured = shopifyCollection(configuredUrl);
  const expectedOrigin = configured?.origin ?? validOrigin(configuredUrl);
  const byContext = new Map();

  for (const value of [configuredUrl, ...(values ?? [])]) {
    const collection = shopifyCollection(value);
    if (!collection || (expectedOrigin && collection.origin !== expectedOrigin)) continue;
    const key = collection.context.toLowerCase();
    if (!byContext.has(key)) byContext.set(key, collection);
  }

  const configuredKey = configured?.context.toLowerCase() ?? null;
  const assessed = [...byContext.entries()]
    .map(([key, collection]) => ({
      ...collection,
      configured: key === configuredKey,
      excluded: SHOPIFY_COLLECTION_EXCLUSION.test(collection.evidence),
      score: shopifyCollectionScore(collection.evidence),
    }));
  const ranked = assessed
    .filter(
      (collection) =>
        !collection.excluded &&
        (collection.configured || SHOPIFY_SALE_COLLECTION.test(collection.evidence)),
    )
    .sort(
      (left, right) =>
        Number(right.configured) - Number(left.configured) ||
        right.score - left.score ||
        left.url.localeCompare(right.url),
    );
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : ranked.length;
  const selected = ranked.slice(0, normalizedLimit);
  const selectedContexts = new Set(selected.map((collection) => collection.context.toLowerCase()));
  const eligibleContexts = new Set(ranked.map((collection) => collection.context.toLowerCase()));
  const omitted = assessed
    .filter((collection) => !selectedContexts.has(collection.context.toLowerCase()))
    .map((collection) => ({
      context: collection.context,
      reason: collection.excluded
        ? "excluded_non_record_collection"
        : eligibleContexts.has(collection.context.toLowerCase())
          ? "lane_limit_reached"
          : "not_sale_relevant",
      url: collection.url,
    }))
    .sort(
      (left, right) =>
        left.reason.localeCompare(right.reason) || left.url.localeCompare(right.url),
    );

  return {
    candidateCount: byContext.size,
    excludedCount: [...byContext.entries()].filter(
      ([, collection]) => SHOPIFY_COLLECTION_EXCLUSION.test(collection.evidence),
    ).length,
    configuredExcluded:
      configuredKey !== null &&
      SHOPIFY_COLLECTION_EXCLUSION.test(byContext.get(configuredKey)?.evidence ?? ""),
    eligibleCount: ranked.length,
    omitted,
    omittedCount: omitted.length,
    selected: selected.map(({ context, url }) => ({ context, url })),
    stopReason:
      ranked.length > normalizedLimit
        ? "lane_limit_reached"
        : ranked.length === 0
          ? configuredKey !== null &&
            SHOPIFY_COLLECTION_EXCLUSION.test(byContext.get(configuredKey)?.evidence ?? "")
            ? "configured_collection_excluded"
            : "no_sale_relevant_collections"
          : null,
  };
}

export function shopifyCatalogUrls(source, page, limit = 250, options = {}) {
  const configured = new URL(source.url ?? source.baseUrl);
  const origin = configured.origin;
  const collection = configured.pathname.match(/\/collections\/([^/?#]+)/)?.[1] ?? null;
  const query = `limit=${limit}&page=${page}`;
  const includeRootCatalog = options.includeRootCatalog !== false || collection === null;
  return [
    ...(collection ? [{ collectionContext: collection, url: `${origin}/collections/${collection}/products.json?${query}` }] : []),
    ...(includeRootCatalog ? [{ collectionContext: null, url: `${origin}/products.json?${query}` }] : []),
  ];
}

export function normalizeShopifyProducts({ assessment, collectionContext = null, currency = null, origin, products = [], source }) {
  const candidates = [];
  for (const product of products) {
    const pricedVariants = (product.variants ?? [])
      .filter((variant) => variant.available !== false)
      .map((variant) => ({ ...variant, numericPrice: finiteNumber(variant.price) }))
      .filter((variant) => variant.numericPrice !== null);
    const normalizedVariants = pricedVariants
      .map((variant) => {
        const variantTitle = cleanIdentifier(variant.title);
        const listingTitle = combinedVariantTitle(product.title, variantTitle);
        const baseProductUrl = `${origin}/products/${product.handle}`;
        const productUrl =
          variant.id === null || variant.id === undefined
            ? baseProductUrl
            : `${baseProductUrl}?variant=${encodeURIComponent(String(variant.id))}`;
        const explicitVinylVariant = variantExplicitlyIdentifiesVinyl(variantTitle);
        const recordAssessment = assessment({
          context: explicitVinylVariant ? product.vendor ?? "" : product.body_html ?? product.vendor ?? "",
          productType: explicitVinylVariant ? variantTitle : `${product.product_type ?? ""} ${variantTitle ?? ""}`,
          source,
          tags: explicitVinylVariant
            ? ""
            : Array.isArray(product.tags)
              ? product.tags.join(" ")
              : product.tags ?? "",
          title: explicitVinylVariant ? variantTitle : listingTitle,
          url: productUrl,
        });
        return recordAssessment.accepted
          ? { listingTitle, productUrl, recordAssessment, variant, variantTitle }
          : null;
      })
      .filter(Boolean);

    for (const normalized of normalizedVariants) {
      const { listingTitle, productUrl, recordAssessment, variant, variantTitle } = normalized;
      const compareAtPrice = finiteNumber(variant.compare_at_price);
      const inventoryQuantity = finiteNumber(variant.inventory_quantity);
      candidates.push({
        availableVariantCount: normalizedVariants.length,
        barcode: cleanIdentifier(variant.barcode),
        candidateQualityReasons: recordAssessment.reasons,
        candidateQualityScore: recordAssessment.score,
        collectionContext,
        compareAtPrice: compareAtPrice !== null && compareAtPrice > variant.numericPrice ? compareAtPrice : null,
        currency: cleanCurrency(product.currency ?? variant.currency ?? currency),
        handle: product.handle,
        inventoryQuantity:
          inventoryQuantity !== null && inventoryQuantity >= 0 ? inventoryQuantity : null,
        listingTitle,
        price: variant.numericPrice,
        product,
        productUrl,
        sku: cleanIdentifier(variant.sku),
        variantId: variant.id ?? null,
        variantTitle,
      });
    }
  }
  return candidates;
}

export function extractShopifyCurrency(htmlPages) {
  for (const html of htmlPages) {
    const source = String(html ?? "");
    const match =
      source.match(/Shopify\.currency\.active\s*=\s*["']([A-Z]{3})["']/i) ??
      source.match(/["']currency["']\s*:\s*["']([A-Z]{3})["']/i) ??
      source.match(/property=["'](?:og:)?price:currency["'][^>]*content=["']([A-Z]{3})["']/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function shopifyCollection(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/collections\/([^/?#]+)/i);
    if (!match) return null;
    const context = decodeURIComponentSafe(match[1]);
    return {
      context,
      evidence: context.replace(/[-_]+/g, " "),
      origin: parsed.origin,
      url: `${parsed.origin}/collections/${match[1]}`,
    };
  } catch {
    return null;
  }
}

function shopifyCollectionScore(evidence) {
  const text = String(evidence ?? "");
  return (
    (SHOPIFY_SALE_COLLECTION.test(text) ? 500 : 0) +
    (/\bvinyl\s*records?\b/i.test(text) ? 180 : 0) +
    (/\bvinyl\b/i.test(text) ? 120 : 0) +
    (/\blps?\b/i.test(text) ? 100 : 0) +
    (/\brecords?\b/i.test(text) ? 80 : 0) +
    (/\bnew\s*(?:arrivals?|releases?)\b/i.test(text) ? 30 : 0) +
    (/\ball\b/i.test(text) ? 10 : 0)
  );
}

function validOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanIdentifier(value) {
  const cleaned = String(value ?? "").trim();
  return cleaned && cleaned.toLowerCase() !== "default title" ? cleaned : null;
}

function cleanCurrency(value) {
  const cleaned = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : null;
}

function variantExplicitlyIdentifiesVinyl(value) {
  return /\b(?:vinyl|phonograph\s+record|record\s+album|(?:[1-9]\s*(?:[x\u00d7-]\s*)?)?lp|ep|(?:7|10|12)\s*(?:inch|in\.|["\u201d]))\b/i.test(
    String(value ?? ""),
  );
}

function combinedVariantTitle(productTitle, variantTitle) {
  const title = String(productTitle ?? "").trim();
  if (!variantTitle || title.toLowerCase().includes(variantTitle.toLowerCase())) return title;
  return `${title} - ${variantTitle}`;
}
