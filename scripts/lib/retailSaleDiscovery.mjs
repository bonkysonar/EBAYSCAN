const SALE_LINK_TERMS =
  /\b(?:sitewide|site-wide|storewide|store-wide|sale|sales|on\s+sale|clearance|outlet|deals?|specials?|last\s+chance|closeout|warehouse|overstock|discount|promo(?:tion)?s?|offers?|bogo|buy\s+more\s+save\s+more)\b/i;
const SALE_PATH_TERMS =
  /(?:^|[-_/])(?:sale|sales|on-sale|clearance|outlet|deals?|specials?|last-chance|closeout|warehouse(?:-sale)?|overstock|discounted|promotions?|offers?|bogo|buy-more-save-more)(?:$|[-_/])/i;
const NON_DISCOVERY_PATH = /\/(?:account|cart|checkout|login|pages\/contact|policies|products?)\b/i;
const COMMON_SALE_HINT_PREFIX = ["/sale", "/sales", "/clearance"];
const SHOPIFY_COLLECTION_HINT_ORDER = [
  "/collections/sale",
  "/collections/clearance",
  "/collections/outlet",
  "/collections/last-chance",
  "/collections/warehouse-sale",
  "/collections/50-off",
  "/collections/vinyl-sale",
  "/collections/record-sale",
];

export function sourceEntryUrls(sourceOrUrl, options = {}) {
  return sourceEntryTargets(sourceOrUrl, options).map((target) => target.url);
}

export function sourceEntryTargetsWithPriorRechecks(sourceOrUrl, options = {}) {
  const targets = sourceEntryTargets(sourceOrUrl, options);
  if (typeof sourceOrUrl === "string") return targets;
  const source = sourceOrUrl ?? {};
  const baseUrl = source.url ?? source.baseUrl;
  const base = normalizeHttpUrl(baseUrl, baseUrl);
  if (!base) return targets;
  const baseHost = normalizedHostname(base);
  const seen = new Set(targets.map((target) => target.url));
  for (const value of source.priorSaleUrls ?? []) {
    const url = normalizeHttpUrl(value, base);
    if (!url || normalizedHostname(url) !== baseHost || seen.has(url)) continue;
    seen.add(url);
    targets.push({ purpose: "prior-campaign-recheck", role: "sale", url });
  }
  return targets;
}

export function sourceEntryTargets(sourceOrUrl, options = {}) {
  const source = typeof sourceOrUrl === "string" ? { url: sourceOrUrl } : sourceOrUrl ?? {};
  const configured = normalizeHttpUrl(source.url ?? source.baseUrl);
  if (!configured) return [];

  const parsed = new URL(configured);
  const homepage = `${parsed.origin}/`;
  const maxHintUrls = Number.isFinite(options.maxHintUrls) ? Math.max(0, Math.floor(options.maxHintUrls)) : 4;
  const hintTargets = uniqueTargets(
    rankedSalePathHints(source)
      .map((hint) => normalizeHttpUrl(hint, homepage))
      .filter(
        (url) =>
          url &&
          new URL(url).hostname.replace(/^www\./i, "") === parsed.hostname.replace(/^www\./i, ""),
      )
      .map((url) => ({ purpose: "configured-sale-hint", url })),
  )
    .filter((target) => target.url !== configured && target.url !== homepage)
    .slice(0, maxHintUrls);
  const targets = [
    { purpose: "configured", url: configured },
    { purpose: "homepage", url: homepage },
    ...hintTargets,
  ];
  return uniqueTargets(targets);
}

function rankedSalePathHints(source) {
  const hints = Array.isArray(source.salePathHints) ? source.salePathHints : [];
  if (!isShopifySource(source)) return hints;

  const suffixStart = commonSaleHintSuffixStart(hints);
  if (suffixStart < 0) return hints;

  const sourceSpecificHints = hints.slice(0, suffixStart);
  const genericHints = hints.slice(suffixStart);
  const shopifyRank = new Map(SHOPIFY_COLLECTION_HINT_ORDER.map((path, index) => [path, index]));
  const rankedGenericHints = genericHints
    .map((hint, index) => ({
      hint,
      index,
      rank: shopifyRank.get(normalizedHintPath(hint)) ?? SHOPIFY_COLLECTION_HINT_ORDER.length,
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ hint }) => hint);
  return [...sourceSpecificHints, ...rankedGenericHints];
}

function isShopifySource(source) {
  return source.sourceType === "shopify-store" || source.crawlType === "shopify-store";
}

function commonSaleHintSuffixStart(hints) {
  const paths = hints.map(normalizedHintPath);
  for (let index = 0; index <= paths.length - COMMON_SALE_HINT_PREFIX.length; index += 1) {
    if (COMMON_SALE_HINT_PREFIX.every((path, offset) => paths[index + offset] === path)) return index;
  }
  return -1;
}

function normalizedHintPath(value) {
  try {
    const url = new URL(String(value), "https://sale-hint.invalid/");
    return url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    return String(value).trim().toLowerCase().split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  }
}

function normalizedHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSaleSpecificUrl(value, source = {}) {
  const url = normalizeHttpUrl(value, source.url ?? source.baseUrl);
  if (!url) return false;
  const parsed = new URL(url);
  return SALE_PATH_TERMS.test(`${parsed.pathname}${parsed.search}`) || matchesConfiguredSaleRule(parsed, source);
}

export function discoverSaleLinks(html, pageUrl, maxLinks = 5, source = {}) {
  const page = normalizeHttpUrl(pageUrl);
  if (!page || !html || maxLinks <= 0) return [];

  const pageHost = new URL(page).hostname.replace(/^www\./i, "");
  const candidates = [];
  const anchors = [...String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,600}?)<\/a>/gi)];

  for (const match of anchors) {
    const href = decodeHtmlAttribute(match[1]);
    if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel):/i.test(href)) continue;

    let url;
    try {
      url = new URL(href, page);
    } catch {
      continue;
    }

    if (!/^https?:$/.test(url.protocol)) continue;
    const targetHost = url.hostname.replace(/^www\./i, "");
    if (targetHost !== pageHost) continue;
    if (NON_DISCOVERY_PATH.test(url.pathname)) continue;

    url.hash = "";
    const label = cleanText(stripTags(match[2]));
    const searchable = `${label} ${url.pathname.replace(/[-_/]+/g, " ")}`;
    const configuredRule = matchesConfiguredSaleRule(url, source);
    if (!SALE_LINK_TERMS.test(searchable) && !SALE_PATH_TERMS.test(url.pathname) && !configuredRule) continue;

    candidates.push({
      score: saleLinkScore(label, url) + (configuredRule ? 90 : 0),
      url: url.toString(),
    });
  }

  const byUrl = new Map();
  for (const candidate of candidates) {
    const current = byUrl.get(candidate.url);
    if (!current || candidate.score > current.score) byUrl.set(candidate.url, candidate);
  }

  return [...byUrl.values()]
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .slice(0, maxLinks)
    .map((candidate) => candidate.url);
}

export function httpFailureKind(status) {
  if (status === 404 || status === 410) return "not_found";
  if ([401, 403, 412, 418, 429].includes(status)) return "blocked";
  if (status >= 500) return "server_error";
  return "http_error";
}

export function hasCouponSignal(text) {
  return /\b(?:(?:promo|coupon|discount)\s+code|use\s+(?:promo\s+)?code|code\s*[:\-]\s*[A-Z0-9][A-Z0-9_-]{2,}|code\s+[A-Z0-9][A-Z0-9_-]{2,}\s+(?:at\s+checkout|to\s+save|for\s+\d)|auto(?:matically)?\s+applied)\b/i.test(
    String(text ?? ""),
  );
}

export function extractPromoCode(text) {
  const match = String(text ?? "").match(
    /\b(?:(?:promo|coupon|discount)\s+code|use\s+(?:promo\s+)?code)\s*[:\-]?\s*([A-Z0-9][A-Z0-9_-]{2,})\b|\bcode\s*[:\-]\s*([A-Z0-9][A-Z0-9_-]{2,})\b/i,
  );
  return (match?.[1] ?? match?.[2])?.toUpperCase() ?? null;
}

export function hasCoherentSaleClaim(text, scope = "any") {
  const value = cleanText(text);
  if (!value) return false;
  const economicPattern = /\b(?:[1-9]\d?\s*(?:%|percent)\s*off|bogo|buy\s+(?:one|1)\s+get\s+(?:one|1)|promo\s+code|coupon\s+code|use\s+code)\b/gi;
  const claimPattern =
    scope === "sitewide"
      ? /\b(?:sitewide|site-wide|storewide|store-wide|entire\s+(?:site|store)|everything)\b/gi
      : scope === "vinyl-wide"
        ? /\b(?:all\s+(?:vinyl|records|lps|music)|vinyl\s+(?:sale|discount|deals?))\b/gi
        : /\b(?:sitewide|site-wide|storewide|store-wide|entire\s+(?:site|store)|everything|all\s+(?:vinyl|records|lps|music)|vinyl\s+(?:sale|discount|deals?))\b/gi;
  const nonVinylContext = /\b(?:apparel|clothing|t-?shirts?|hoodies?|merch(?:andise)?|accessories|cds?|cassettes?|tapes?|books?|posters?|homeware)\b/i;
  const offers = [...value.matchAll(economicPattern)];
  const claims = [...value.matchAll(claimPattern)];

  for (const offer of offers) {
    for (const claim of claims) {
      const offerStart = offer.index ?? 0;
      const claimStart = claim.index ?? 0;
      const offerEnd = offerStart + offer[0].length;
      const claimEnd = claimStart + claim[0].length;
      const gap = Math.max(0, Math.max(offerStart, claimStart) - Math.min(offerEnd, claimEnd));
      if (gap > 64) continue;
      const span = value.slice(Math.min(offerStart, claimStart), Math.max(offerEnd, claimEnd));
      if (!nonVinylContext.test(span)) return true;
    }
  }
  return false;
}

export function verifiedSalePathOffer(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  let path;
  try {
    path = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    path = url.pathname.toLowerCase();
  }
  const normalizedPath = path.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (/\b(?:up-to|as-much-as)-?\d{2}(?:-percent)?-off\b/.test(normalizedPath)) return null;

  const match = normalizedPath.match(/(?:^|-)([3-8]\d)(?:-(?:percent|pct))?-off(?:-|$)/);
  if (!match) return null;
  const discountPercent = Number(match[1]);
  if (!Number.isFinite(discountPercent)) return null;

  return {
    discountPercent,
    evidence: `Retailer URL slug advertises ${discountPercent}% off select items, but the current discount is not confirmed: ${url.pathname}`,
    purchaseOfferVerification: "campaign_advertised",
    saleVerification: "discovery-lead",
    scope: "collection",
  };
}

function saleLinkScore(label, url) {
  const text = `${label} ${url.pathname}`;
  let score = 0;
  if (/\b(?:sitewide|site-wide|storewide|store-wide|entire\s+site|everything)\b/i.test(text)) score += 100;
  if (/\b(?:all\s+(?:vinyl|records|lps|music)|vinyl\s+sale)\b/i.test(text)) score += 80;
  if (/\b(?:bogo|buy\s+more\s+save\s+more|[3-9][0-9]\s*%\s*off)\b/i.test(text)) score += 70;
  if (/\b(?:clearance|closeout|warehouse|overstock|last\s+chance|outlet)\b/i.test(text)) score += 50;
  if (SALE_PATH_TERMS.test(url.pathname)) score += 30;
  if (SALE_LINK_TERMS.test(label)) score += 20;
  if (url.search) score -= 5;
  return score;
}

function matchesConfiguredSaleRule(url, source) {
  const path = `${url.pathname}${url.search}`;
  if ((source.salePathHints ?? []).some((hint) => {
    const normalized = normalizeHttpUrl(hint, url.origin);
    return normalized && path.startsWith(new URL(normalized).pathname);
  })) {
    return true;
  }
  return (source.saleUrlPatterns ?? []).some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(url.toString());
    } catch {
      return url.toString().toLowerCase().includes(String(pattern).toLowerCase());
    }
  });
}

export function hasBogoOfferSignal(text) {
  const value = String(text ?? "");
  if (/\b(?:buy\s+one\s+get\s+one|buy\s+1\s+get\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(value)) return true;
  if (/\bBOGO\b/.test(value)) return true;
  return (
    /\bbogo\b.{0,30}\b(?:deal|free|off|offer|promotion|sale)\b/i.test(value) ||
    /\b(?:deal|offer|promotion|sale)\b.{0,30}\bbogo\b/i.test(value)
  );
}

export function dedupeSaleCampaigns(events, priorityFor = () => 0, identityFor = null) {
  const byCampaign = new Map();
  for (const event of events ?? []) {
    const key =
      identityFor?.(event) ??
      event.fingerprint ??
      `${event.sourceId ?? "unknown"}|${event.sourceUrl ?? ""}|${event.title ?? ""}`;
    const current = byCampaign.get(key);
    if (!current || priorityFor(event) > priorityFor(current)) byCampaign.set(key, event);
  }
  return [...byCampaign.values()];
}

function normalizeHttpUrl(value, baseUrl) {
  try {
    const parsed = new URL(String(value), baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target.url || seen.has(target.url)) return false;
    seen.add(target.url);
    return true;
  });
}

function decodeHtmlAttribute(value) {
  return String(value).replace(/&amp;/gi, "&").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"');
}

function cleanText(value) {
  return String(value).replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, " ");
}
