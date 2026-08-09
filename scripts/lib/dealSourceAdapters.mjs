const REDDIT_HELPER_HOSTS = new Set([
  "bsky.app",
  "dealsonvinyl.com",
  "discord.gg",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "vinyl.fyi",
]);
const AMAZON_ASIN = /^[A-Z0-9]{10}$/i;

export function parseRedditAtomFeed(xml) {
  const entries = [];
  for (const match of String(xml ?? "").matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1];
    const title = cleanText(decodeXml(textBetween(block, "title")));
    const discussionUrl = decodeXml(block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? textBetween(block, "id"));
    const content = decodeXml(textBetween(block, "content"));
    const publishedAt = cleanText(textBetween(block, "updated") || textBetween(block, "published")) || null;
    const expired = /\bexpired\b/i.test(`${title} ${content}`) || /<category\b[^>]*(?:term|label)=["'][^"']*expired/i.test(block);
    if (!title) continue;

    entries.push({
      directUrl: bestExternalDealUrl(content),
      discussionUrl: normalizeHttpUrl(discussionUrl),
      expired,
      price: firstPrice(title),
      publishedAt,
      title,
    });
  }
  return entries;
}

export function parseOldRedditDealPage(html, pageUrl = "https://old.reddit.com/r/VinylDeals/new/") {
  const entries = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html ?? "").matchAll(anchorPattern)) {
    const attributes = match[1];
    const className = attribute(attributes, "class");
    if (!/(?:^|\s)title(?:\s|$)/i.test(className)) continue;

    const title = cleanText(stripTags(match[2]));
    const href = attribute(attributes, "href");
    const nearby = String(html).slice(Math.max(0, match.index - 500), Math.min(String(html).length, match.index + match[0].length + 700));
    if (!title) continue;

    entries.push({
      directUrl: normalizeHttpUrl(href, pageUrl),
      discussionUrl: normalizeHttpUrl(attribute(attributes, "data-permalink"), pageUrl),
      expired: /\bexpired\b/i.test(nearby),
      price: firstPrice(title),
      publishedAt: null,
      title,
    });
  }
  return entries;
}

export function extractVinylPriceDropCards(html, pageUrl = "https://vinylpricedrop.com/deals") {
  const cards = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html ?? "").matchAll(pattern)) {
    const attributes = match[1];
    if (!/(?:^|\s)card(?:\s|$)/i.test(attribute(attributes, "class"))) continue;
    const detailUrl = normalizeHttpUrl(attribute(attributes, "href"), pageUrl);
    if (!detailUrl || !/^https?:\/\/(?:www\.)?vinylpricedrop\.com\/deals\/(?!type\/)/i.test(detailUrl)) continue;
    const titleBlock = match[2].match(/<h[1-6]\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ?? match[2];
    const title = cleanText(stripTags(titleBlock));
    if (title) cards.push({ detailUrl, title });
  }
  return dedupeBy(cards, (card) => card.detailUrl);
}

export function extractSlickdealsDealCards(
  html,
  pageUrl = "https://slickdeals.net/search",
) {
  const source = String(html ?? "");
  const cardStarts = [...source.matchAll(/<div\b([^>]*)>/gi)]
    .filter((match) => hasClassToken(match[1], "dealCardListView") && attribute(match[1], "data-threadid"))
    .map((match) => ({ attributes: match[1], index: match.index ?? 0 }));
  const cards = [];

  for (const [index, start] of cardStarts.entries()) {
    const block = source.slice(start.index, cardStarts[index + 1]?.index ?? source.length);
    const threadId = attribute(start.attributes, "data-threadid").trim();
    const titleAnchor = [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].find((match) => {
      if (!hasClassToken(match[1], "dealCardListView__title")) return false;
      const detailUrl = normalizeHttpUrl(attribute(match[1], "href"), pageUrl);
      return slickdealsThreadId(detailUrl) === threadId;
    });
    if (!titleAnchor) continue;

    const detailUrl = normalizeHttpUrl(attribute(titleAnchor[1], "href"), pageUrl);
    const title = cleanText(attribute(titleAnchor[1], "title") || stripTags(titleAnchor[2]));
    const semanticCurrentPrice = firstPrice(
      classValue(block, "dealCardListView__finalPrice", { preferTitle: true }),
    );
    const titleCurrentPrice = firstPrice(title);
    const currentPrice =
      semanticCurrentPrice !== null &&
      titleCurrentPrice !== null &&
      Math.abs(titleCurrentPrice - semanticCurrentPrice) < 1
        ? titleCurrentPrice
        : semanticCurrentPrice ?? titleCurrentPrice;
    if (!detailUrl || !title || currentPrice === null) continue;

    const parsedOriginalPrice = firstPrice(
      classValue(block, "dealCardListView__listPrice", { preferTitle: true }),
    );
    const originalPrice = parsedOriginalPrice !== null && parsedOriginalPrice > currentPrice
      ? parsedOriginalPrice
      : null;
    const savingsText = classValue(block, "dealCardListView__savings");
    const advertisedDiscount = Number(savingsText.match(/\b([0-9]{1,2})\s*%\s*off\b/i)?.[1]);
    const publishedText = classValue(block, "slickdealsTimestamp", { preferTitle: true });

    cards.push({
      currentPrice,
      detailUrl,
      discountPercent:
        Number.isFinite(advertisedDiscount) && advertisedDiscount > 0 && advertisedDiscount < 100
          ? advertisedDiscount
          : originalPrice !== null
            ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
            : null,
      expired: /(?:[?&]|%3A)Expired(?::|%3A)(?:True|true)\b/i.test(detailUrl) || /\bexpired\b/i.test(block),
      originalPrice,
      publishedAt: publishedText || null,
      storeName: classValue(block, "dealCardListView__store") || null,
      threadId,
      title,
    });
  }

  return dedupeBy(cards, (card) => card.threadId);
}

export function parseVinylPriceDropDetail(html, detailUrl, fallbackTitle = "") {
  const source = String(html ?? "");
  const h1Match = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1Match?.[1] ?? "";
  const title = cleanText(fallbackTitle) || cleanText(stripTags(h1));
  const expired = /\bdrop\s+expired\b/i.test(stripTags(source));
  const directUrl = bestExternalDealUrl(h1 || source);
  const priceRegionStart = h1Match?.index === undefined ? 0 : h1Match.index + h1Match[0].length;
  const priceRegionEndCandidates = [source.search(/price\s+history/i), source.search(/related\s+deals/i)].filter((index) => index > priceRegionStart);
  const priceRegionEnd = priceRegionEndCandidates.length ? Math.min(...priceRegionEndCandidates) : Math.min(source.length, priceRegionStart + 5_000);
  const priceRegion = stripTags(source.slice(priceRegionStart, priceRegionEnd));
  const prices = allPrices(priceRegion);
  const currentPrice = prices[0] ?? null;
  const originalPrice = prices.find((price, index) => index > 0 && currentPrice !== null && price > currentPrice) ?? null;

  return {
    currentPrice,
    detailUrl: normalizeHttpUrl(detailUrl),
    directUrl,
    discountPercent:
      currentPrice !== null && originalPrice !== null ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : null,
    expired,
    originalPrice,
    title,
  };
}

export function splitDealArtistTitle(rawTitle) {
  const cleaned = cleanText(
    String(rawTitle ?? "")
      .replace(/^(?:(?:\[[^\]]+\]|\([^)]*\))\s*)+/g, "")
      .replace(/\s+(?:@|[-–—])?\s*\$\s*[0-9][0-9,.]*(?:\s.*)?$/i, "")
      .replace(/\s+[-–—]\s*$/, "")
      .replace(/\s*\|\s*direct\b.*$/i, ""),
  );
  const parts = cleaned.match(/^(.{2,100}?)\s+(?:[-–—])\s+(.{2,})$/);
  const quotedParts = parts
    ? null
    : cleaned.match(/^(.{2,100}?)\s+["“]([^"”]{2,})["”](?:\s|$)/);
  return {
    artist: cleanText(parts?.[1] ?? quotedParts?.[1] ?? "Unknown Artist"),
    title: cleanText(parts?.[2] ?? quotedParts?.[2] ?? cleaned),
  };
}

function bestExternalDealUrl(html) {
  const candidates = [];
  for (const match of String(html ?? "").matchAll(/<a\b([^>]*)>/gi)) {
    const href = decodeXml(attribute(match[1], "href"));
    const url = normalizeHttpUrl(href);
    if (!url) continue;
    const host = new URL(url).hostname.toLowerCase();
    if (REDDIT_HELPER_HOSTS.has(host) || host.endsWith("vinylpricedrop.com")) continue;
    let score = 10;
    if (/amazon\.[^/]+\/dp\//i.test(url)) score += 100;
    if (/\b(?:direct|buy\s+now|shop\s+now)\b/i.test(stripTags(match[0]))) score += 20;
    if (/^(?:www\.)?amazon\./i.test(host) || host === "a.co") score += 10;
    candidates.push({ score, url });
  }
  const best = candidates.sort((left, right) => right.score - left.score)[0]?.url;
  return best ? canonicalizeRetailDealUrl(best) : null;
}

export function canonicalizeRetailDealUrl(value) {
  const parsed = new URL(value);
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:tag|linkcode|creativeasin|ascsubtag|ref|ref_|utm_.+|psc)$/i.test(key)) parsed.searchParams.delete(key);
  }
  const asin = extractAmazonAsin(parsed);
  if (asin) return `https://${normalizedAmazonHost(parsed.hostname)}/dp/${asin}`;
  return parsed.toString();
}

export function extractAmazonAsin(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? value : new URL(String(value));
  } catch {
    return null;
  }
  if (!isAmazonHost(parsed.hostname)) return null;

  const pathMatch = parsed.pathname.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  );
  if (pathMatch && AMAZON_ASIN.test(pathMatch[1])) return pathMatch[1].toUpperCase();
  for (const key of ["asin", "ASIN"]) {
    const candidate = parsed.searchParams.get(key);
    if (candidate && AMAZON_ASIN.test(candidate)) return candidate.toUpperCase();
  }
  return null;
}

function isAmazonHost(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/^www\./, "");
  return /^amazon\.(?:com|ca|com\.mx|co\.uk|de|fr|it|es|nl|se|pl|com\.be|co\.jp|com\.au|in|sg|ae|sa|com\.br|com\.tr)$/.test(
    host,
  );
}

function normalizedAmazonHost(hostname) {
  return `www.${String(hostname ?? "").toLowerCase().replace(/^www\./, "")}`;
}

function slickdealsThreadId(value) {
  if (!value) return null;
  try {
    return new URL(value).pathname.match(/^\/f\/(\d+)(?:-|\/|$)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

function hasClassToken(attributes, className) {
  return attribute(attributes, "class").split(/\s+/).includes(className);
}

function classValue(block, className, { preferTitle = false } = {}) {
  const source = String(block ?? "");
  for (const match of source.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    if (!hasClassToken(match[2], className)) continue;
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = source.toLowerCase().indexOf(`</${match[1].toLowerCase()}`, contentStart);
    const title = cleanText(attribute(match[2], "title"));
    const content = contentEnd < 0 ? "" : cleanText(stripTags(source.slice(contentStart, contentEnd)));
    return preferTitle ? title || content : content || title;
  }
  return "";
}

function allPrices(value) {
  return [...String(value ?? "").matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/g)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((price) => Number.isFinite(price) && price > 0);
}

function firstPrice(value) {
  return allPrices(value)[0] ?? null;
}

function textBetween(xml, tagName) {
  return String(xml ?? "").match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1] ?? "";
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function attribute(attributes, name) {
  return decodeXml(String(attributes ?? "").match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "");
}

function normalizeHttpUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value), baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripTags(value) {
  return decodeXml(String(value ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function cleanText(value) {
  return decodeXml(value).replace(/\s+/g, " ").trim();
}

function dedupeBy(values, keyFor) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
