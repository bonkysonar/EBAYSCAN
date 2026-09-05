const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const host = (value) =>
  new URL(value).hostname.toLowerCase().replace(/^www\./, "");
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export const browserObservationUrl = (value) => {
  const url = new URL(value);
  if (!(host(url) === "roughtrade.com" && /^#\d+$/.test(url.hash))) url.hash = "";
  return url.toString().replace(/^https:\/\/www\./, "https://");
};

/** Explicit public-page observations, never cookies, hidden storefront state or a full-catalog claim. */
export function validateBrowserRetailObservations(
  payload,
  sources,
  now = new Date().toISOString(),
) {
  if (
    payload?.version !== 1 ||
    payload?.captureMethod !== "visible_browser" ||
    !Array.isArray(payload.pages)
  )
    throw new Error("Unsupported browser observation document");
  const bySource = new Map(sources.map((source) => [source.id, source]));
  const retailerHosts = new Set(sources.filter((source) => source.group !== "Discovery sources").map((source) => host(source.url ?? source.baseUrl)));
  return payload.pages.map((page) => {
    const source = bySource.get(page.sourceId);
    const age = Date.parse(now) - Date.parse(page.capturedAt);
    if (!source || !Number.isFinite(age) || age < -300000)
      throw new Error(
        `Unknown source or stale browser observation: ${page.sourceId}`,
      );
    const url = new URL(page.url);
    if (
      url.protocol !== "https:" ||
      host(url) !== host(source.url ?? source.baseUrl) ||
      /(?:account|checkout|customer_authentication|cart|buyer_flags)/i.test(
        url.href,
      )
    )
      throw new Error(
        `Browser observation URL does not match source: ${page.sourceId}`,
      );
    if (
      !["available", "not_found"].includes(page.outcome) ||
      typeof page.visibleText !== "string" ||
      page.visibleText.trim().length < 15 ||
      page.visibleText.length > 200000
    )
      throw new Error(`Incomplete browser observation: ${page.sourceId}`);
    if (
      /verifying your connection|checking your browser|verify you are human|access denied|captcha/i.test(
        `${page.title} ${page.visibleText}`,
      )
    )
      throw new Error(
        `Browser challenge is not usable evidence: ${page.sourceId}`,
      );
    if (
      page.outcome === "not_found" &&
      (!/404|not found/i.test(page.title) ||
        !/page.{0,35}(?:no longer exists|not found)|can.t find the page/i.test(
          page.visibleText,
        ))
    )
      throw new Error(
        `Removed page needs visible retailer 404 evidence: ${page.sourceId}`,
      );
    const links = (page.links ?? [])
      .filter((link) => {
        try {
          const target = new URL(link.url);
          return (
            target.protocol === "https:" &&
            (host(target) === host(url) || (source.group === "Discovery sources" && page.role === "discovery" && retailerHosts.has(host(target)))) &&
            !/(?:account|checkout|customer_authentication|cart|buyer_flags)/i.test(
              target.href,
            ) &&
            typeof link.text === "string"
          );
        } catch {
          return false;
        }
      })
      .map((link) => ({ url: link.url, text: link.text.slice(0, 3000) }));
    const productEvidence = validateProductEvidence(page);
    const selectedVariantEvidence = validateSelectedVariantEvidence(page);
    const catalogProducts = (page.catalogProducts ?? [])
      .map((card) => validateCatalogProduct(card, page))
      .filter(Boolean);
    return {
      sourceId: page.sourceId,
      url: url.toString(),
      title: String(page.title ?? "").slice(0, 300),
      visibleText: page.visibleText,
      capturedAt: page.capturedAt,
      outcome: page.outcome,
      links,
      ...(typeof page.purchaseBlockText === "string" && page.visibleText.includes(page.purchaseBlockText) ? {purchaseBlockText:page.purchaseBlockText} : {}),
      ...(typeof page.currencyEvidence === "string" && page.visibleText.includes(page.currencyEvidence) ? {currencyEvidence:page.currencyEvidence} : {}),
      ...(page.role === "discovery" && source.group === "Discovery sources" ? {role:"discovery"} : {}),
      ...(productEvidence ? { productEvidence } : {}),
      ...(selectedVariantEvidence ? {selectedVariantEvidence} : {}),
      ...(catalogProducts.length ? { catalogProducts, role: "catalog" } : {}),
    };
  }).filter((page) => Date.parse(now) - Date.parse(page.capturedAt) <= MAX_AGE_MS);
}

function validateSelectedVariantEvidence(page) {
  const selected = page.selectedVariantEvidence;
  if (!selected) return null;
  const url = new URL(page.url);
  if (host(url) !== "roughtrade.com" || selected.expanded !== true || !/^#\d+$/.test(url.hash) || String(selected.variantId) !== url.hash.slice(1) || typeof selected.visibleText !== "string" || !page.visibleText.includes(selected.visibleText) || (page.purchaseBlockText && !page.purchaseBlockText.includes(selected.visibleText))) throw new Error("Selected variant is not supported by visible expanded offer");
  return {variantId:String(selected.variantId),expanded:true,visibleText:selected.visibleText};
}

function validateCatalogProduct(card, page) {
  if (!card || typeof card.visibleText !== "string" || !card.title)
    throw new Error("Catalog card needs visible album text");
  const normalize = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const text = normalize(card.visibleText);
  const url = new URL(card.url, page.url);
  if (
    page.outcome !== "available" ||
    url.protocol !== "https:" ||
    host(url) !== host(page.url) ||
    /(?:account|checkout|customer_authentication|cart|buyer_flags)/i.test(
      url.href,
    ) ||
    (card.artist && !text.includes(normalize(card.artist))) ||
    !text.includes(normalize(card.title)) ||
    !Number.isFinite(card.price) ||
    card.price <= 0 ||
    !card.visibleText.includes(card.price.toFixed(2))
  )
    throw new Error("Catalog card identity/price/domain mismatch");
  if (
    !/\b(?:vinyl|\d?\s*[x×]?\s*lp)\b/i.test(
      `${card.format} ${card.visibleText}`,
    ) ||
    /\b(?:cd|cassette|blu[ -]?ray|dvd)\b/i.test(card.format ?? "")
  )
    return null;
  const unavailable =
    /out of stock|sold out|unavailable|pre[ -]?order|coming soon|back[ -]?order|special order/i.test(
      card.visibleText,
    );
  const availabilityConfirmed =
    /add to cart|buy now|in stock|available now/i.test(card.visibleText);
  const pageCurrencyEvidence = typeof page.currencyEvidence === "string" && page.visibleText.includes(page.currencyEvidence) ? page.currencyEvidence : "";
  const currency =
    /^[A-Z]{3}$/.test(card.currency ?? "") &&
    new RegExp(`\\b${card.currency}\\b`, "i").test(`${card.visibleText} ${pageCurrencyEvidence}`)
      ? card.currency
      : null;
  return {
    artist: card.artist ? String(card.artist) : null,
    title: String(card.title),
    format: String(card.format),
    price: card.price,
    currency,
    available:
      unavailable || card.available === false
        ? false
        : card.available === true && availabilityConfirmed
          ? true
          : undefined,
    url: url.toString(),
    visibleText: card.visibleText.slice(0, 4000),
  };
}

function validateProductEvidence(page) {
  const evidence = page.productEvidence;
  if (!evidence) return null;
  const selected = validateSelectedVariantEvidence(page);
  const identityText = typeof page.purchaseBlockText === "string" && page.visibleText.includes(page.purchaseBlockText) ? page.purchaseBlockText : page.visibleText;
  const purchaseText = selected?.visibleText ?? identityText;
  const text = purchaseText.replace(/\s+/g, " ").toLowerCase();
  const normalized = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const product = new URL(page.url);
  if (
    page.outcome !== "available" ||
    !/\/(?:products|[a-z]{2}-[a-z]{2}\/product)\//.test(product.pathname) ||
    !evidence.artist ||
    !evidence.title ||
    !normalized(identityText).includes(normalized(evidence.artist)) ||
    !normalized(identityText).includes(normalized(evidence.title))
  )
    throw new Error(
      "Browser product identity is not supported by visible page",
    );
  if (
    !Number.isFinite(evidence.price) ||
    evidence.price <= 0 ||
    !text.includes(evidence.price.toFixed(2)) ||
    !/^[A-Z]{3}$/.test(evidence.currency ?? "")
  )
    throw new Error("Browser product price/currency missing");
  if (
    evidence.available !== true ||
    !/add to cart|buy now|in stock|unit(?:s)? left/.test(text) ||
    /sold out|out of stock/.test(
      text.split(/you may also like|recently viewed/)[0],
    )
  )
    throw new Error("Browser product availability missing");
  if (
    !/\b(?:vinyl|\d?lp)\b/i.test(evidence.format ?? "") ||
    !/\b(?:vinyl|\d?lp)\b/.test(text)
  )
    throw new Error("Browser product format missing");
  if (
    evidence.variantId &&
    (product.searchParams.get("variant") ?? (host(product) === "roughtrade.com" && /^#\d+$/.test(product.hash) ? product.hash.slice(1) : null)) !== String(evidence.variantId)
  )
    throw new Error("Browser product variant does not match URL");
  if (evidence.barcode && !text.includes(String(evidence.barcode)))
    throw new Error("Browser product barcode not shown");
  return {
    artist: evidence.artist,
    title: evidence.title,
    format: evidence.format,
    price: evidence.price,
    originalPrice: evidence.originalPrice ?? null,
    currency: evidence.currency,
    available: true,
    variantId: evidence.variantId ?? null,
    barcode: evidence.barcode ?? null,
    sku: evidence.sku ?? null,
    quantityAvailable: evidence.quantityAvailable ?? null,
    customerLimit: evidence.customerLimit ?? null,
    availabilityEvidence: evidence.availabilityEvidence ?? null,
  };
}

export function browserProductCandidates(pages, source, stableId) {
  const products = pages
    .filter((page) => page.sourceId === source.id && page.productEvidence)
    .map((page) => {
      const evidence = page.productEvidence;
      return {
        id: stableId(source.id, page.url, evidence.variantId ?? evidence.title),
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: page.url,
        sourceListingTitle: `${evidence.artist} - ${evidence.title} ${evidence.format}`,
        artist: evidence.artist,
        title: evidence.title,
        identityStatus: "resolved",
        identitySource: "visible_product_page",
        physicalFormatConfirmed: true,
        condition: "new/sealed",
        available: true,
        purchasePrice: evidence.price,
        sourceOriginalPrice: evidence.originalPrice,
        sourceDiscountPercent:
          evidence.originalPrice > evidence.price
            ? Math.round((1 - evidence.price / evidence.originalPrice) * 100)
            : null,
        sourceCurrency: evidence.currency,
        barcode: evidence.barcode,
        sku: evidence.sku,
        shopifyVariantId: evidence.variantId,
        shopifyVariantTitle: evidence.format,
        quantityAvailable: evidence.quantityAvailable,
        capturedAt: page.capturedAt,
        retailObservedAt: page.capturedAt,
        retailObservationUrl: page.url,
        retailObservationMethod: "visible_browser",
        candidateQualityScore: 95,
        candidateQualityReasons: [
          "Exact available vinyl product observed in normal browser",
        ],
      };
    });
  const cards = pages
    .filter((page) => page.sourceId === source.id)
    .flatMap((page) =>
      (page.catalogProducts ?? [])
        .filter((card) => card.available !== false)
        .filter((card) => !products.some((product) => {
          const cardUrl = new URL(card.url), exactUrl = new URL(product.sourceUrl);
          const cardVariant = cardUrl.searchParams.get("variant") ?? cardUrl.searchParams.get("algolia_object_id");
          return cardUrl.origin === exactUrl.origin && cardUrl.pathname === exactUrl.pathname && card.price === product.purchasePrice && cardVariant && cardVariant === String(product.shopifyVariantId);
        }))
        .map((card) => ({
          id: stableId(source.id, card.url, card.title),
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: card.url,
          sourceListingTitle: `${card.artist ? `${card.artist} - ` : ""}${card.title} ${card.format}`,
          artist: card.artist,
          title: card.title,
          identityStatus: card.artist ? "resolved" : "unresolved",
          identitySource: "visible_catalog_card",
          physicalFormatConfirmed: true,
          recordFormat: "vinyl",
          condition: "new/sealed",
          available: card.available,
          purchasePrice: card.price,
          sourceCurrency: card.currency,
          capturedAt: page.capturedAt,
          retailObservedAt: page.capturedAt,
          retailObservationUrl: page.url,
          retailObservationMethod: "visible_browser_catalog",
          candidateQualityScore: 70,
          candidateQualityReasons: [
            "Bounded visible catalog card; exact product and stock still require verification",
          ],
        })),
    );
  return [...products, ...cards];
}

/** Keep an observed SKU's pressing metadata ahead of a generic parser duplicate. */
export function preferObservedSkuCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const identity = observedSkuIdentity(candidate);
    if (!identity) continue;
    const group = groups.get(identity.key) ?? [];
    group.push({ candidate, identity });
    groups.set(identity.key, group);
  }
  const superseded = new Set();
  for (const group of groups.values()) {
    const observed = group.filter(({ candidate }) =>
      candidate.identitySource === "visible_product_page" &&
      candidate.retailObservationMethod === "visible_browser" &&
      candidate.physicalFormatConfirmed === true,
    );
    if (observed.length !== 1) continue;
    const variants = new Set(group.flatMap(({ identity }) => identity.variants));
    const barcodes = new Set(group.map(({ candidate }) => String(candidate.barcode ?? "").trim()).filter(Boolean));
    const currencies = new Set(group.map(({ candidate }) => String(candidate.sourceCurrency ?? "").trim()).filter(Boolean));
    const prices = new Set(group.map(({ candidate }) => Number(candidate.purchasePrice)));
    // A SKU reused across actual variants is not enough to identify one offer.
    // A changed price is also a separate observation requiring revalidation.
    if (variants.size > 1 || barcodes.size > 1 || currencies.size > 1 ||
        prices.size !== 1 || ![...prices].every((price) => Number.isFinite(price) && price > 0)) continue;
    for (const { candidate } of group) {
      if (candidate !== observed[0].candidate) superseded.add(candidate);
    }
  }
  return candidates.filter((candidate) => !superseded.has(candidate));
}

function observedSkuIdentity(candidate) {
  const sku = String(candidate.sku ?? "").trim();
  if (!sku || !candidate.sourceId) return null;
  try {
    const url = new URL(candidate.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password ||
        !/^\/(?:products\/[^/]+|[a-z]{2}-[a-z]{2}\/product\/[^/]+\/[^/]+)\/?$/.test(url.pathname)) return null;
    const variants = [candidate.shopifyVariantId, url.searchParams.get("variant"),
      url.searchParams.get("algolia_object_id"),
      host(url) === "roughtrade.com" && /^#\d+$/.test(url.hash) ? url.hash.slice(1) : null]
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map(String);
    return { key: JSON.stringify([candidate.sourceId, sku, url.origin, url.pathname.replace(/\/$/, "")]), variants };
  } catch { return null; }
}

export function browserObservationPage(page) {
  const html = `<html><head><title>${escape(page.title)}</title></head><body>${page.visibleText
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => `<p>${escape(line)}</p>`)
    .join(
      "",
    )}${page.links.map((link) => `<a href="${escape(link.url)}">${escape(link.text)}</a>`).join("")}</body></html>`;
  return {
    html,
    url: page.url,
    status: page.outcome === "not_found" ? 404 : 200,
    setCookies: [],
    observationMethod: "visible_browser",
    observedAt: page.capturedAt,
    browserOutcome: page.outcome,
  };
}

export function browserSourceDiagnostics(pages, sourceId) {
  const selected = pages.filter((page) => page.sourceId === sourceId);
  return selected.length
    ? {
        browserObservationCount: selected.length,
        browserObservedAt: selected
          .map((page) => page.capturedAt)
          .sort()
          .at(-1),
        salePageConfirmedRemovedUrls: selected
          .filter((page) => page.outcome === "not_found")
          .map((page) => page.url),
        browserObservedUrls: selected
          .filter((page) => page.outcome === "available")
          .map((page) => page.url),
        browserCatalogCoverage: "bounded_visible_pages",
      }
    : {};
}
