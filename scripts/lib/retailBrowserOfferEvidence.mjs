import { normalizeResearchArtist, normalizeResearchTitle } from "../../src/lib/arbitrage/soldResearchLinks.mjs";

const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DISCOVERY_SOURCES = new Set(["reddit-vinyl-deals", "slickdeals-vinyl-records", "vinyl-price-drop"]);
const sourceHosts = { "reddit-vinyl-deals": "reddit.com", "slickdeals-vinyl-records": "slickdeals.net", "vinyl-price-drop": "vinylpricedrop.com" };
const key = value => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const artistKey = value => /^\s*various(?:\s+artists?)?\s*$/i.test(String(value ?? ""))
  ? "variousartists" : key(normalizeResearchArtist(value).replace(/^the\s+/i, ""));
const fresh = (at, now) => { const age = Number(new Date(now)) - Date.parse(at); return Number.isFinite(age) && age >= -300000 && age <= MAX_AGE_MS; };
const safeUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      !/(?:^|\/)(?:account|checkout|cart|buyer_flags)(?:[/.]|$)/i.test(url.pathname) ? url : null;
  } catch { return null; }
};

/** Exact U.S. product identities only; this module never fetches a retailer. */
export function retailerProductIdentity(value) {
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let productId, retailerId;
  if (host === "amazon.com") {
    productId = url.pathname.match(/^\/(?:[^/]+\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    retailerId = "amazon";
  } else if (host === "target.com") {
    productId = url.pathname.match(/^\/p\/(?:[^/]+\/)?-\/A-(\d+)\/?$/)?.[1];
    retailerId = "target";
  } else if (host === "walmart.com") {
    productId = url.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d+)\/?$/)?.[1];
    retailerId = "walmart";
  }
  if (!productId) return null;
  // A requested seller/condition/variant override is a distinct offer, not tracking.
  if ([...url.searchParams.keys()].some(name => /^(?:seller|sellerid|smid|condition|selectedsellerid|selected|variant|variantid|offerlistingid|account|token|session|sessionid|email|address|zip|postalcode|auth)$/i.test(name))) return null;
  if (url.searchParams.has("preselect") && (retailerId !== "target" || url.searchParams.get("preselect") !== productId)) return null;
  url.hostname = `www.${host}`;
  if (retailerId === "amazon") url.pathname = `/dp/${productId}`;
  url.search = ""; url.hash = "";
  return { retailerId, productId, key: `${retailerId}:${productId}`, canonicalUrl: url.href };
}

export function isRetailerOfferSource(sourceId, retailerId) {
  return sourceId === retailerId || DISCOVERY_SOURCES.has(sourceId);
}

const field = (block, value, max = 500) => typeof value === "string" && value.trim().length > 0 && value.length <= max && block.includes(value);
const newCondition = text => /\b(?:buy\s+new|condition\s*:?\s*new|new\s*[:(]|new\s+(?:vinyl|record|sealed)|brand\s+new)\b/i.test(text) || /^new$/i.test(text.trim());
const nonNew = text => /\b(?:used|pre[- ]?owned|renewed|refurbished|open[- ]?box|like\s+new)\b/i.test(text);
const foreignCurrency = text => /(?:\b(?:CAD|AUD|NZD|GBP|EUR|JPY|MXN|INR)\b|CA\$|C\$|AU\$|A\$|NZ\$|[£€¥])/i.test(text);
const productOnlySnippet = text => !/(?:\b(?:deliver(?:ing)?\s+to|ship(?:ping)?\s+to|address|zip\s*code|postal\s*code|account|email|phone)\b|@|\b\d{5}(?:-\d{4})?\b)/i.test(text);
const sellerPatterns = {
  amazon: { seller: /^(?:sold\s+by|shipper\s*\/\s*seller)\s*:?\s*Amazon\.com\s*$/i, fulfiller: /^(?:(?:ships?|dispatched)\s+from|shipper\s*\/\s*seller)\s*:?\s*Amazon\.com\s*$/i },
  target: { seller: /^(?:sold\s*(?:&|and)?\s*(?:shipped\s*)?by\s*:?\s*)Target(?:\.com)?\s*$/i, fulfiller: /^(?:(?:ships?\s+from|shipped\s+by|sold\s*(?:&|and)\s*shipped\s+by)\s*:?\s*)Target(?:\.com)?\s*$/i },
  walmart: { seller: /^(?:sold\s*(?:&|and)?\s*(?:shipped\s*)?by\s*:?\s*)Walmart(?:\.com)?\s*$/i, fulfiller: /^(?:(?:ships?\s+from|shipped\s+by|fulfilled\s+by|sold\s*(?:&|and)\s*shipped\s+by)\s*:?\s*)Walmart(?:\.com)?\s*$/i },
};

function discoveryLink(page, identity, now) {
  const link = page.discoveryLinkEvidence;
  if (!link) return null;
  const source = safeUrl(link.sourceUrl), clicked = safeUrl(link.linkUrl);
  const resolved = retailerProductIdentity(link.resolvedUrl);
  if (!DISCOVERY_SOURCES.has(page.sourceId) || !source || !clicked || !resolved || resolved.key !== identity.key ||
      source.hostname.replace(/^www\./, "") !== sourceHosts[page.sourceId] || !fresh(link.capturedAt, now) ||
      !field(String(link.visibleText ?? ""), link.linkText, 500) || String(link.visibleText).length > 2000) return false;
  return { sourceUrl: source.href, linkUrl: clicked.href, resolvedUrl: link.resolvedUrl, capturedAt: link.capturedAt,
    linkText: link.linkText, visibleText: link.linkText };
}

/** Validate selected visible product/offer fields. Missing facts remain unverified. */
export function validateRetailerOfferPage(page, now = new Date()) {
  try {
    const p = page.productEvidence, e = page.retailerOfferEvidence;
    const identity = retailerProductIdentity(page.url);
    if (!identity || !e || !p || !isRetailerOfferSource(page.sourceId, identity.retailerId) ||
        e.retailerId !== identity.retailerId || String(e.productId).toUpperCase() !== identity.productId ||
        page.outcome !== "available" || !fresh(page.capturedAt, now) ||
        typeof page.visibleText !== "string" || page.visibleText.length > 200000 ||
        typeof page.purchaseBlockText !== "string" || page.purchaseBlockText.length > 20000 ||
        !page.visibleText.includes(page.purchaseBlockText)) return null;
    const block = page.purchaseBlockText;
    if (/\b(?:prime\s+(?:exclusive|price)|member(?:ship)?\s+(?:only|price)|coupon|subscribe\s*(?:&|and)|with\s+(?:prime|code)|apply\s+(?:code|discount))\b/i.test(block)) return null;
    const heading = page.productHeadingText ?? page.visibleText.split(/\r?\n/).find(line => key(line).includes(key(p.title)));
    const artistText = page.artistText ?? page.visibleText.split(/\r?\n/).find(line => key(line).includes(artistKey(p.artist)));
    const albumKey = key(normalizeResearchTitle(p.title));
    const headingKey = key(normalizeResearchTitle(heading));
    const artistLabel = artistKey(String(artistText ?? "").split(/\bFormat\s*:/i)[0].replace(/^\s*by\s+/i, "").replace(/\s*\(Artist\)\s*$/i, ""));
    const headingMatches = [albumKey, artistKey(p.artist) + albumKey, "the" + artistKey(p.artist) + albumKey].includes(headingKey);
    const artistMatches = [artistKey(p.artist), artistKey(p.artist) + albumKey].includes(artistLabel);
    if (!artistKey(p.artist) || !albumKey || !headingMatches || !artistMatches || !field(page.visibleText, heading, 1000) ||
        !field(page.visibleText, artistText, 1000) || !key(artistText).includes(artistKey(p.artist)) || !key(heading).includes(key(p.title)) ||
        /verifying your connection|checking your browser|verify you are human|access denied|captcha/i.test(page.visibleText)) return null;
    if (e.selectedFormat !== true || !field(page.visibleText, e.selectedFormatText) ||
        !/\b(?:vinyl|\d?\s*[x×]?\s*lp)\b/i.test(e.selectedFormatText) ||
        !/^(?:vinyl|\d?\s*[x×]?\s*lp)$/i.test(p.format ?? "") ||
        /\b(?:cd|cassette|dvd|blu[- ]?ray|digital\s+only)\b/i.test(`${e.selectedFormatText} ${p.format}`) ||
        e.condition !== "new" || !field(block, e.conditionText) || !newCondition(e.conditionText) || nonNew(block)) return null;
    if (e.editionText && !field(page.visibleText, e.editionText, 1000)) return null;
    const patterns = sellerPatterns[identity.retailerId];
    if (!field(block, e.sellerText) || !patterns.seller.test(e.sellerText.trim()) ||
        !field(block, e.fulfillerText) || !patterns.fulfiller.test(e.fulfillerText.trim())) return null;
    if (p.available !== true || !field(block, e.availabilityText) || !field(block, e.purchaseActionText) ||
        e.availabilityText.length > 100 || /[\r\n]/.test(e.availabilityText) || !productOnlySnippet(e.availabilityText) ||
        !/\b(?:in\s+stock|available\s+now|arrives?|delivery|ships?)\b/i.test(e.availabilityText) ||
        !/^\s*(?:add\s+to\s+cart|buy\s+now)\s*$/i.test(e.purchaseActionText) ||
        /out\s+of\s+stock|sold\s+out|(?:currently\s+)?unavailable|not\s+(?:in\s+stock|available)|pre[- ]?order|back[- ]?order|coming\s+soon/i.test(block)) return null;
    if (!(Number.isFinite(p.price) && p.price > 0) || p.currency !== "USD" || foreignCurrency(`${heading}\n${block}`) ||
        !field(block, e.priceText) || /\b(?:shipping|delivery|save|savings|coupon|spend|minimum|from|list|was|reg(?:ular)?)\b/i.test(e.priceText)) return null;
    const prices = [...e.priceText.matchAll(/(?:^|[^\d.,])\$\s*(\d+(?:\.\d{2})?)(?![\d.,])/g)].map(match => Number(match[1]));
    if (prices.length !== 1 || Math.abs(prices[0] - p.price) > 0.001) return null;
    if (e.currencyText && (!field(block, e.currencyText) || foreignCurrency(e.currencyText) || !/\bUSD\b|US\s*\$|\$/i.test(e.currencyText))) return null;
    if (p.variantId && String(p.variantId).toUpperCase() !== identity.productId) return null;
    const barcode = p.barcode ? String(p.barcode) : null;
    const barcodeText = barcode ? page.barcodeText ?? page.visibleText.split(/\r?\n/).find(line => line.includes(barcode)) : null;
    if (barcode && (!/^\d{8,14}$/.test(barcode) || !field(page.visibleText, barcodeText, 200))) return null;
    const link = discoveryLink(page, identity, now);
    if (link === false) return null;
    const shipping = e.shippingEvidence;
    let shippingEvidence;
    if (shipping) {
      if (!field(block, shipping.visibleText, 160) || /[\r\n]/.test(shipping.visibleText) || !productOnlySnippet(shipping.visibleText) || shipping.currency !== "USD" ||
          !Number.isFinite(shipping.amount) || shipping.amount < 0 ||
          !/shipping|delivery/i.test(shipping.visibleText) ||
          /\b(?:over|above|minimum|member|prime|circle|with|if|spend|qualif\w*|orders?|eligible|eligibility)\b|at\s+least|\b(?:no|not|without)\b/i.test(shipping.visibleText) || foreignCurrency(shipping.visibleText)) return null;
      const amountMatch = shipping.amount === 0 ? /\bfree\b/i.test(shipping.visibleText) :
        new RegExp(`\\$\\s*${shipping.amount.toFixed(2).replace(".", "\\.")}(?![\\d.,])`).test(shipping.visibleText);
      if (!amountMatch) return null;
      shippingEvidence = { amount: shipping.amount, currency: "USD", visibleText: shipping.visibleText };
    }
    // Persist only the verified product fields; never the surrounding account,
    // address, recommendations, delivery-personalization or checkout page.
    const evidence = { retailerId: identity.retailerId, productId: identity.productId, selectedFormat: true,
      selectedFormatText: e.selectedFormatText, ...(e.editionText ? { editionText: e.editionText } : {}), condition: "new", conditionText: e.conditionText,
      priceText: e.priceText, ...(e.currencyText ? { currencyText: e.currencyText } : {}),
      availabilityText: e.availabilityText, purchaseActionText: e.purchaseActionText,
      sellerText: e.sellerText, fulfillerText: e.fulfillerText, ...(shippingEvidence ? { shippingEvidence } : {}) };
    const purchaseBlockText = [...new Set([e.conditionText, e.priceText, e.currencyText,
      e.availabilityText, e.purchaseActionText, e.sellerText, e.fulfillerText, shippingEvidence?.visibleText].filter(Boolean))].join("\n");
    return { sourceId: page.sourceId, url: identity.canonicalUrl, outcome: "available", capturedAt: page.capturedAt,
      evidenceScope: "selected_product_fields", productHeadingText: heading, artistText, purchaseBlockText,
      visibleText: [heading, artistText, e.selectedFormatText, e.editionText, purchaseBlockText, barcodeText].filter(Boolean).join("\n"),
      ...(barcodeText ? { barcodeText } : {}),
      productEvidence: { artist: p.artist, title: p.title, format: p.format, price: p.price, currency: "USD", available: true, barcode },
      retailerOfferEvidence: evidence, ...(link ? { discoveryLinkEvidence: link } : {}) };
  } catch { return null; }
}

/** Exact product identity bridges discovery provenance to an observed purchase. */
export function verifyRetailerBrowserOffer(find, page, now = new Date()) {
  const observed = validateRetailerOfferPage(page, now);
  if (!observed || observed.sourceId !== find.sourceId ||
      key(normalizeResearchTitle(find.title)) !== key(normalizeResearchTitle(observed.productEvidence.title))) return null;
  const identity = retailerProductIdentity(observed.url), original = retailerProductIdentity(find.sourceUrl);
  const exactDirect = original?.key === identity.key;
  const missingArtist = !String(find.artist ?? "").trim() || /^unknown\s+artist$/i.test(String(find.artist).trim());
  if (missingArtist ? !exactDirect : artistKey(find.artist) !== artistKey(observed.productEvidence.artist)) return null;
  let exactFollowedLink = false;
  try {
    exactFollowedLink = Boolean(observed.discoveryLinkEvidence && safeUrl(find.sourceUrl)?.href === observed.discoveryLinkEvidence.sourceUrl);
  } catch { return null; }
  if ((!exactDirect && !exactFollowedLink) || (original && original.key !== identity.key) ||
      (find.amazonAsin && (identity.retailerId !== "amazon" || String(find.amazonAsin).toUpperCase() !== identity.productId)) ||
      (find.barcode && observed.productEvidence.barcode && String(find.barcode) !== observed.productEvidence.barcode)) return null;
  const p = observed.productEvidence, e = observed.retailerOfferEvidence;
  return { ...find, sourceUrl: observed.url,
    ...(missingArtist ? { artist: p.artist, identityStatus: "resolved", identitySource: "browser_product" } : {}),
    discoveryUrl: find.discoveryUrl ?? (exactFollowedLink ? find.sourceUrl : undefined),
    physicalFormatConfirmed: true, recordFormat: p.format, retailVariantTitle: e.editionText ?? p.format,
    retailEditionText: [observed.productHeadingText, e.editionText].filter(Boolean).join(" "),
    condition: "new/sealed", available: true, purchasePrice: p.price, purchasePriceUsd: p.price,
    sourceCurrency: "USD", sourceCountry: "US", barcode: p.barcode ?? find.barcode,
    purchaseRetailerName: { amazon: "Amazon", target: "Target", walmart: "Walmart" }[e.retailerId],
    purchaseRetailerDomain: `${e.retailerId}.com`, retailerSellerName: { amazon: "Amazon.com", target: "Target", walmart: "Walmart.com" }[e.retailerId], retailerSoldBySource: true,
    costs: { ...find.costs, inboundShipping: e.shippingEvidence?.amount },
    checkoutQuote: undefined, shippingOffer: undefined,
    sourceOriginalPrice: null, sourceDiscountPercent: null,
    appliedSaleCampaignId: null, appliedSaleCode: null, appliedSaleDiscountPercent: null, appliedCampaign: undefined,
    capturedAt: observed.capturedAt, retailObservedAt: observed.capturedAt, retailObservationUrl: observed.url,
    retailObservationMethod: "visible_browser_retailer_offer", retailerOfferObservation: observed,
    purchaseOfferVerification: "direct_retailer", requiresRetailVerification: true,
    retailVerification: { status: "verified", checkedAt: observed.capturedAt, captureMethod: "visible_browser",
      reason: "exact_retailer_offer_observed_in_browser", advertisedPrice: p.price, currency: "USD",
      retailerId: e.retailerId, productId: e.productId, condition: "new", sellerText: e.sellerText, fulfillerText: e.fulfillerText } };
}

export function retailerBrowserOfferIsCurrent(find, now = new Date()) {
  if (find.retailObservationMethod !== "visible_browser_retailer_offer" || !find.retailerOfferObservation) return false;
  const verified = verifyRetailerBrowserOffer(find, find.retailerOfferObservation, now);
  if (!verified) return false;
  const fields = ["sourceId", "sourceUrl", "artist", "title", "purchasePrice", "purchasePriceUsd", "sourceCurrency", "sourceCountry",
    "capturedAt", "retailObservedAt", "retailObservationUrl", "condition", "recordFormat", "retailEditionText", "retailVariantTitle", "physicalFormatConfirmed", "available", "purchaseOfferVerification", "purchaseRetailerName", "purchaseRetailerDomain", "retailerSellerName", "retailerSoldBySource"];
  return fields.every(name => verified[name] === find[name]) && verified.costs.inboundShipping === find.costs?.inboundShipping &&
    JSON.stringify(verified.retailVerification) === JSON.stringify(find.retailVerification) &&
    JSON.stringify(verified.retailerOfferObservation) === JSON.stringify(find.retailerOfferObservation) &&
    !find.checkoutQuote && !find.shippingOffer;
}
