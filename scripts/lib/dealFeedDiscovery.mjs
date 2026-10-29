import { canonicalizeRetailDealUrl, extractAmazonAsin } from "./dealSourceAdapters.mjs";
import { publicDiscoveryUrl } from "./webSaleDiscovery.mjs";

// Publisher RSS. `q`, not `search`, is the working keyword parameter. Keep both
// newest and popular streams: neither promises complete historical coverage.
export const SLICKDEALS_FEED_URLS = Object.freeze([
  "https://slickdeals.net/newsearch.php?q=vinyl&searcharea=deals&searchin=first&sort=newest&rss=1",
  "https://slickdeals.net/newsearch.php?q=vinyl&mode=popdeals&rss=1",
]);

/** Advertised prices are leads, never observed retail availability or value. */
export function parseSlickdealsFeed(xml) {
  const document = String(xml ?? "");
  if (!/<rss\b/i.test(document) || !/<channel\b/i.test(document) || !/<\/channel\s*>/i.test(document) || !/<\/rss\s*>/i.test(document) ||
      [...document.matchAll(/<item\b[^>]*>/gi)].length !== [...document.matchAll(/<\/item\s*>/gi)].length) {
    throw Object.assign(new Error("Slickdeals did not return a complete RSS feed"), { failureKind: "invalid_feed" });
  }
  const deals = [];
  for (const match of document.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = plain(tag(block, "title"));
    const discussionUrl = publicDiscoveryUrl(decode(tag(block, "link")));
    if (!title || !discussionUrl || !/^https:\/\/(?:www\.)?slickdeals\.net\/f\/\d+(?:-|\/|$)/i.test(discussionUrl)) continue;
    const content = decode(tag(block, "content:encoded") || tag(block, "description"));
    const description = plain(content);
    const titlePrice = firstPrice(title.split(/\b(?:shipping|delivery)\b/i)[0]);
    // Body copy commonly contains the cents omitted from a rounded headline.
    // Only an explicit item-price phrase before the shipping sentence qualifies.
    const itemCopy = description.split(/\b(?:shipping|delivery)\b/i)[0];
    const describedPrice = firstPrice(itemCopy.match(/\b(?:for|priced?\s+at|on\s+sale\s+(?:for|at))\s*[:*]?\s*\$\s*[\d,.]+/i)?.[0]);
    const useDescription = describedPrice !== null && (titlePrice === null || Math.abs(titlePrice - describedPrice) < 1);
    const price = useDescription ? describedPrice : titlePrice;
    const publishedTime = Date.parse(plain(tag(block, "pubDate")));
    const expired = /^\s*(?:\[\s*expired\s*\]|expired\s*[:\-])/i.test(title) ||
      /\b(?:this\s+deal\s+has\s+expired|deal\s+is\s+expired)\b/i.test(description) ||
      [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].some(entry => /^expired(?:\s+deals?)?$/i.test(plain(entry[1])));
    deals.push({
      directUrl: directRetailUrl(content),
      discussionUrl,
      expired,
      price,
      priceSource: useDescription ? "publisher_item_price" : price !== null ? "publisher_title" : null,
      publishedAt: Number.isFinite(publishedTime) ? new Date(publishedTime).toISOString() : null,
      title,
    });
  }
  return deals;
}

export async function discoverSlickdealsFeeds({ fetchPage, now = Date.now(), maxAgeHours = 48 } = {}) {
  const timestamp = Number(new Date(now));
  if (!Number.isFinite(timestamp) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error("Invalid feed freshness window");
  const results = await Promise.all(SLICKDEALS_FEED_URLS.map(async url => {
    try {
      const page = await fetchPage(url);
      const deals = parseSlickdealsFeed(page.html);
      return { deals, page: { purpose: "publisher-feed", role: "catalog", requestedUrl: url, resolvedUrl: page.url, status: "available" } };
    } catch (error) {
      return { deals: [], page: { purpose: "publisher-feed", role: "catalog", requestedUrl: url, status: "error", failureKind: error.failureKind ?? "network_error", error: error.message } };
    }
  }));
  const unique = new Map();
  for (const result of results) {
    for (const deal of result.deals) {
      const key = new URL(deal.discussionUrl).pathname.match(/^\/f\/\d+/i)?.[0];
      const previous = unique.get(key);
      if (previous) {
        // One bounded stream may retain an older active copy after another has
        // marked the thread expired. Preserve identity but honor that warning.
        if (deal.expired && !previous.expired) unique.set(key, { ...previous, expired: true, status: "expired" });
        continue;
      }
      const age = timestamp - Date.parse(deal.publishedAt);
      const status = deal.expired ? "expired" : !Number.isFinite(age) || age < -300000 ? "undated" :
        age > maxAgeHours * 3600000 ? "stale" : deal.price === null ? "price_missing" : "discovery_lead";
      unique.set(key, { ...deal, feedUrl: result.page.requestedUrl, status });
    }
  }
  const outcomes = [...unique.values()];
  return {
    outcomes,
    pages: results.map(result => result.page),
    stats: {
      adapter: "slickdeals-publisher-rss",
      evidenceScope: "bounded_publisher_feeds_not_retailer_verification",
      feedCount: results.length,
      feedSuccessCount: results.filter(result => result.page.status === "available").length,
      feedErrorCount: results.filter(result => result.page.status !== "available").length,
      feedEntryCount: results.reduce((sum, result) => sum + result.deals.length, 0),
      uniqueDealCount: outcomes.length,
      activeDealCount: outcomes.filter(deal => deal.status === "discovery_lead").length,
      expiredDealCount: outcomes.filter(deal => deal.status === "expired").length,
      staleDealCount: outcomes.filter(deal => deal.status === "stale").length,
      undatedDealCount: outcomes.filter(deal => deal.status === "undated").length,
      priceMissingCount: outcomes.filter(deal => deal.status === "price_missing").length,
    },
  };
}

function directRetailUrl(content) {
  // Inspect feed fields only. Never follow the feed's redirect/tracking links.
  // The first retailer anchor owns the price; do not attach an alternative
  // retailer later in the post to the first retailer's advertised price.
  for (const anchor of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = anchor[1];
    const retailer = attribute(attrs, "data-product-exitWebsite").toLowerCase();
    const href = publicDiscoveryUrl(attribute(attrs, "href"));
    const asin = attribute(attrs, "data-aps-asin");
    if (retailer === "amazon.com" && /^[A-Z0-9]{10}$/i.test(asin)) return `https://www.amazon.com/dp/${asin.toUpperCase()}`;
    if (href && !/\.(?:png|jpg|gif|webp)(?:\?|$)/i.test(href)) {
      const host = new URL(href).hostname.replace(/^www\./, "");
      if (["amazon.com", "walmart.com", "target.com"].includes(host) && /\/(?:dp|gp\/product|ip|p)\//i.test(new URL(href).pathname)) {
        return canonicalizeRetailDealUrl(href);
      }
      if (retailer && retailer !== "slickdeals.net") {
        if (host === retailer && /\/(?:products?|albums?|items?)\//i.test(new URL(href).pathname)) return href;
        // The primary retailer is behind a redirect we cannot verify here.
        return null;
      }
    }
  }
  // Some publisher descriptions supply an explicit Amazon URL as plain text.
  const plainAmazon = plain(content).match(/\b(?:https:\/\/)?(?:www\.)?amazon\.com\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\b|\/)/i)?.[0];
  if (!plainAmazon) return null;
  const candidate = plainAmazon.startsWith("https://") ? plainAmazon : `https://${plainAmazon}`;
  return extractAmazonAsin(candidate) ? canonicalizeRetailDealUrl(candidate) : null;
}

function tag(xml, name) {
  return String(xml).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";
}
function attribute(attrs, name) {
  return decode(String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "");
}
function decode(value) {
  return String(value ?? "").trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => {
      const code = number[0].toLowerCase() === "x" ? parseInt(number.slice(1), 16) : Number(number);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
    }).replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, "&");
}
function plain(value) { return decode(decode(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function firstPrice(value) {
  const text = String(value ?? "");
  const match = text.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?!\d|\.\d)/);
  if (match && (/\s*off\b/i.test(text.slice(match.index + match[0].length, match.index + match[0].length + 8)) || /\bsave\s*$/i.test(text.slice(0, match.index)))) return null;
  return match && Number(match[1].replace(/,/g, "")) > 0 ? Number(match[1].replace(/,/g, "")) : null;
}
