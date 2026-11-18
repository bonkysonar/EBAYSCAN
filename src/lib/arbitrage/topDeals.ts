import { publicDiscoveryUrl } from "../../../scripts/lib/webSaleDiscovery.mjs";
import { consideration, slowerSaleWithMargin } from "./decisionList.mjs";
import { recordOutcomeForFind, saleOutcomeForCampaign, type ReviewFeedback } from "./reviewFeedback";
import type { NormalizedSaleCampaign } from "./saleCampaigns";
import type { RetailCampaignRadarPayload, RetailDealRadarPayload, RetailMarkdownPayload } from "./dealRadar";
import type { ArbitrageScoredFind, ArbitrageSettings } from "./types";

const HOUR = 3_600_000;
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fresh = (stamp: string | null | undefined, now: number, hours: number) => {
  const age = now - Date.parse(stamp ?? "");
  return age >= -300_000 && age < hours * HOUR;
};
const current = (feed: RetailCampaignRadarPayload | RetailDealRadarPayload | RetailMarkdownPayload | null, now: number) =>
  feed && feed.status !== "unavailable" && Date.parse(feed.expiresAt) > now;
const key = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
function albumIdentity(artist: string, title: string) {
  const parts = title.split(/\s+[-–—]\s+/);
  const album = parts.length > 1 && key(parts[0]) === key(artist) ? parts.slice(1).join(" — ") : title;
  const shortTitle = album.replace(/\s*[(\[][^)\]]*(?:vinyl|\blp\b)[^)\]]*[)\]]/gi, "").replace(/\s+\d*LP\s*$/i, "").trim() || album;
  return { key: key(artist) + "|" + key(shortTitle), name: artist === "Unknown Artist" ? album : artist + " — " + album };
}

export type DealPick = {
  key: string; name: string; url: string; value: string; source: string; terms: string;
  checked: string; tier: number; score: number;
};

function bestFive(rows: DealPick[]) {
  const seen = new Set<string>();
  return rows.sort((a, b) => a.tier - b.tier || b.score - a.score ||
    Date.parse(b.checked) - Date.parse(a.checked) || a.name.localeCompare(b.name))
    .filter(row => {
      if (seen.has(row.key)) return false;
      seen.add(row.key);
      return true;
    }).slice(0, 5);
}

export function topAlbums(finds: ArbitrageScoredFind[], radar: RetailDealRadarPayload | null,
  feedback: ReviewFeedback, settings: ArbitrageSettings, now: number, markdowns: RetailMarkdownPayload | null = null) {
  const rows: DealPick[] = [];
  const excluded = new Set<string>();
  for (const find of finds) {
    const album = albumIdentity(find.artist, find.title);
    if (find.dismissedAt || find.learningSuppressed || recordOutcomeForFind(feedback, find)) {
      excluded.add(album.key);
      continue;
    }
    const url = publicDiscoveryUrl(find.sourceUrl);
    if (!url || !fresh(find.soldEvidence?.capturedAt, now, 6) || !fresh(find.activeEvidence?.capturedAt, now, 6)) continue;
    const review = consideration(find, now, settings);
    const slow = slowerSaleWithMargin(find, now, settings);
    if (!review.qualifies && !slow) continue;
    const profit = find.expectedNetProfit!;
    const status = slow ? "Slow sales" : find.decision === "BUY" ? "Buy" : "Review";
    rows.push({ ...album, url,
      value: dollars.format(find.purchasePriceUsd ?? find.purchasePrice), source: find.purchaseRetailerName || find.sourceName,
      terms: [status, "+" + dollars.format(profit) + " est. net", Math.round(find.roiRatio! * 100) + "% ROI", ...review.remainingChecks].join(" · "),
      checked: find.soldEvidence!.capturedAt!, tier: slow ? 2 : find.decision === "BUY" ? 0 : 1, score: profit });
  }
  if (current(markdowns, now) && markdowns?.evidenceScope === "in_stock_retail_markdowns") {
    for (const item of markdowns.items) {
      const url = publicDiscoveryUrl(item.url);
      if (!url || !item.artist || !item.title || !(item.price > 0 && item.compareAt > item.price)) continue;
      const discount = 100 * (1 - item.price / item.compareAt);
      rows.push({ ...albumIdentity(item.artist, item.title),
        url, value: dollars.format(item.price), source: item.retailer,
        terms: Math.round(discount) + "% below " + dollars.format(item.compareAt) + " · In stock · resale unverified",
        checked: markdowns.checkedAt, tier: 3, score: discount });
    }
  }
  if (current(radar, now) && radar?.evidenceScope === "advertised_deals_not_retailer_or_resale_verification") {
    for (const item of radar.items) {
      const url = publicDiscoveryUrl(item.retailerUrl) || publicDiscoveryUrl(item.discussionUrl);
      if (!url || !item.title || !item.artist || !fresh(item.publishedAt, now, 48) ||
        !(Number.isFinite(item.advertisedPrice) && item.advertisedPrice > 0) || item.currency !== "USD" ||
        /\b(?:box[ -]?set|vinyl lot|album bundle|albums? collection)\b/i.test(item.title)) continue;
      rows.push({ ...albumIdentity(item.artist, item.title),
        url, value: dollars.format(item.advertisedPrice), source: item.retailerUrl && publicDiscoveryUrl(item.retailerUrl)
          ? new URL(url).hostname.replace(/^www\./, "") : item.publisher,
        terms: "Advertised price · resale unverified", checked: item.publishedAt, tier: 4, score: -item.advertisedPrice });
    }
  }
  return bestFive(rows.filter(row => !excluded.has(row.key)));
}

const conditional = /\b(?:first (?:order|purchase)|newsletter|sign up|subscribe|members? only|new customers? only|free shipping only|expired|sale ended)\b/i;

export function topSales(campaigns: NormalizedSaleCampaign[], radar: RetailCampaignRadarPayload | null,
  feedback: ReviewFeedback, now: number) {
  const rows: DealPick[] = [];
  const excluded = new Set<string>();
  const add = (store: string, link: string, label: string, scope: string, discount: number, upTo: boolean, checked: string, live: boolean) => {
    const url = publicDiscoveryUrl(link);
    if (!url || !label || conditional.test(label) || !(discount > 0 && discount <= 100)) return;
    const broad = scope === "sitewide" || scope === "vinyl-wide";
    rows.push({ key: key(store), name: store, url, value: (upTo ? "Up to " : "") + discount + "% off",
      source: scope === "sitewide" ? "Storewide" : scope === "vinyl-wide" ? "Music-wide" : "Selected titles",
      terms: label, checked, tier: live ? (broad ? 0 : 1) : (broad ? 2 : 3), score: discount });
  };
  for (const c of campaigns) {
    const outcome = saleOutcomeForCampaign(feedback, c);
    if (outcome && outcome !== "confirmed") { excluded.add(publicDiscoveryUrl(c.sourceUrl) ?? c.sourceUrl); continue; }
    const seen = c.lastSeenAt || c.capturedAt;
    if (c.saleVerification !== "retailer-page" || !["ongoing", "new", "changed", "evergreen"].includes(c.saleStatus) ||
      c.saleMissCount || c.saleObservedThisRun === false || !fresh(seen, now, 24) || c.campaignTerms?.termsUnresolved) continue;
    const terms = c.saleEvidence || c.saleSignal || "";
    const code = c.salePromoCode || c.saleCode;
    add(c.sourceName, c.sourceUrl, code && !terms.toUpperCase().includes(code.toUpperCase()) ? terms + " · Code " + code : terms,
      c.saleScope || "collection", c.saleDiscountPercent ?? 0, c.saleDiscountQualifier === "up_to", seen, false);
  }
  if (current(radar, now) && radar?.evidenceScope === "retailer_advertisements") {
    for (const item of radar.items) {
      const match = item.label.match(/(up to\s+)?(\d{1,2})\s*%\s*off/i);
      if (!match) continue;
      const scope = /\b(?:site[ -]?wide|store[ -]?wide|almost everything)\b/i.test(item.label) ? "sitewide" :
        /\b(?:all (?:vinyl|music|LPs)|off music\b)/i.test(item.label) ? "vinyl-wide" : "collection";
      add(item.retailer, item.url, item.label, scope, Number(match[2]), Boolean(match[1]), radar.checkedAt, true);
    }
  }
  return bestFive(rows.filter(row => !excluded.has(row.url)));
}
