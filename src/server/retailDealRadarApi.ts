import { discoverSlickdealsFeeds } from "../../scripts/lib/dealFeedDiscovery.mjs";
import { splitDealArtistTitle } from "../../scripts/lib/dealSourceAdapters.mjs";
import { assessRecordCandidate } from "../../scripts/lib/candidatePipeline.mjs";
import type { RetailCampaignRadarPayload, RetailDealRadarItem, RetailDealRadarPayload } from "../lib/arbitrage/dealRadar";
import { getActiveRetailSources } from "../lib/arbitrage/vinylShopSources.js";
import { advertisedCollectionLinks } from "../../scripts/lib/retailSaleDiscovery.mjs";

const CACHE_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_FEED_BYTES = 2_000_000;
const MAX_ITEMS = 12;
const MAX_DEAL_AGE_MS = 48 * 60 * 60_000;

/** Independent read-only feed path: no publication, private state, or eBay API. */
export function createRetailDealRadar({ fetchImpl = fetch, now = Date.now }: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  let cached: RetailDealRadarPayload | null = null;
  let pending: Promise<RetailDealRadarPayload> | null = null;
  return async function read(): Promise<RetailDealRadarPayload> {
    const time = now();
    if (cached && Date.parse(cached.expiresAt) > time) return freshItems(cached, time);
    if (pending) return pending;
    pending = update(time).finally(() => { pending = null; });
    return pending;
  };

  async function update(time: number): Promise<RetailDealRadarPayload> {
    const result = await discoverSlickdealsFeeds({ now: time, fetchPage: url => fetchPublicPage(url, fetchImpl, "rss") });
    const items: RetailDealRadarItem[] = [];
    for (const deal of result.outcomes) {
      if (deal.status !== "discovery_lead" || !deal.price || deal.price < 2 || deal.price > 35 || !deal.publishedAt || !deal.discussionUrl) continue;
      const identity = splitDealArtistTitle(deal.title);
      const assessment = assessRecordCandidate({ title: deal.title, url: deal.directUrl ?? deal.discussionUrl,
        source: { id: "slickdeals-vinyl-records", sourceType: "deal-aggregator" } });
      if (!assessment.accepted || identity.title.length < 3) continue;
      // Unparsed promotion copy is not a useful album identity.
      if (identity.artist === "Unknown Artist" && !/\bsoundtrack\b/i.test(identity.title)) continue;
      items.push({ id: new URL(deal.discussionUrl).pathname.match(/^\/f\/\d+/i)![0], artist: identity.artist,
        title: identity.title, advertisedPrice: deal.price, currency: "USD", publishedAt: deal.publishedAt,
        publisher: "Slickdeals", discussionUrl: deal.discussionUrl, retailerUrl: deal.directUrl });
    }
    items.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
    const seenRetailerUrls = new Set<string>();
    const distinctItems = items.filter(item => {
      // Multiple discussion threads can point to the same exact retailer SKU.
      // Keep the newest thread; unknown URLs and distinct variants stay separate.
      if (!item.retailerUrl) return true;
      if (seenRetailerUrls.has(item.retailerUrl)) return false;
      seenRetailerUrls.add(item.retailerUrl);
      return true;
    });
    const successCount = result.pages.filter(page => page.status === "available").length;
    cached = {
      version: 1,
      status: successCount === result.pages.length ? "available" : successCount ? "partial" : "unavailable",
      checkedAt: new Date(time).toISOString(),
      expiresAt: new Date(time + CACHE_MS).toISOString(),
      items: distinctItems.slice(0, MAX_ITEMS),
      sources: result.pages.map(page => ({ url: page.requestedUrl, status: page.status === "available" ? "available" : "error",
        reason: page.status === "available" ? null : page.failureKind === "invalid_feed" ? "Publisher returned an invalid feed" : page.failureKind === "timeout" ? "Publisher request timed out" : "Publisher feed could not be read" })),
      evidenceScope: "advertised_deals_not_retailer_or_resale_verification",
    };
    return cached;
  }

}

export function createRetailCampaignRadar({ fetchImpl = fetch, now = Date.now } = {}) {
  const storeIds = new Set(["sound-of-vinyl", "udiscover-music", "verve-store"]);
  const stores = getActiveRetailSources().filter(store => storeIds.has(store.id) && !store.browserObservationOnly);
  let cached: RetailCampaignRadarPayload | null = null;
  let pending: Promise<RetailCampaignRadarPayload> | null = null;
  return async function read() {
    const time = now();
    if (cached && Date.parse(cached.expiresAt) > time) return cached;
    pending ??= update(time).finally(() => { pending = null; });
    return pending;
  };

  async function update(time: number): Promise<RetailCampaignRadarPayload> {
    const results = await Promise.all(stores.map(async store => {
      const url = new URL("/", store.baseUrl).href;
      try {
        const { html } = await fetchPublicPage(url, fetchImpl, "html");
        const items = advertisedCollectionLinks(html, url).slice(0, 8)
          .map(link => ({ ...link, retailer: store.displayName }));
        return { items, source: { url, status: "available" as const, reason: null } };
      } catch {
        return { items: [], source: { url, status: "error" as const, reason: "Retailer homepage unavailable" } };
      }
    }));
    const sources = results.map(result => result.source);
    const reached = sources.filter(source => source.status === "available").length;
    cached = {
      version: 1, checkedAt: new Date(time).toISOString(), expiresAt: new Date(time + CACHE_MS).toISOString(),
      status: !reached ? "unavailable" : reached === sources.length ? "available" : "partial",
      items: results.flatMap(result => result.items), sources, evidenceScope: "retailer_advertisements",
    };
    return cached;
  }
}

async function fetchPublicPage(url: string, fetchImpl: typeof fetch, type: "rss" | "html"): Promise<{ url: string; html: string }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error("Publisher request timed out"), { failureKind: "timeout" }));
      }, FETCH_TIMEOUT_MS);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: "error", headers: {
          Accept: type === "rss" ? "application/rss+xml, application/xml, text/xml;q=0.9" : "text/html",
          "User-Agent": "RecordScanner/1.0 (public sale discovery)",
        } });
        if (!response.ok) throw new Error(`Publisher HTTP ${response.status}`);
        if (Number(response.headers.get("content-length") ?? 0) > MAX_FEED_BYTES) throw new Error("Publisher feed too large");
        const html = await readBoundedFeed(response);
        if (type === "html" && (!/text\/html/i.test(response.headers.get("content-type") ?? "") ||
            !/<a\s/i.test(html) || /<title[^>]*>\s*(?:just a moment|access denied|challenge|verify you are human)/i.test(html)))
          throw new Error("Retailer homepage unavailable");
        return { url: response.url || url, html };
      })()]);
    } finally {
      if (timer) clearTimeout(timer);
    }
}

async function readBoundedFeed(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_FEED_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error("Publisher feed too large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

function freshItems(payload: RetailDealRadarPayload, now: number): RetailDealRadarPayload {
  return { ...payload, items: payload.items.filter(item => now - Date.parse(item.publishedAt) <= MAX_DEAL_AGE_MS) };
}

export const readRetailDealRadar = createRetailDealRadar();
export const readRetailCampaignRadar = createRetailCampaignRadar();

export function readRetailRadarRequest(requestUrl = "/") {
  return new URL(requestUrl, "http://localhost").searchParams.get("scope") === "campaigns"
    ? readRetailCampaignRadar() : readRetailDealRadar();
}
