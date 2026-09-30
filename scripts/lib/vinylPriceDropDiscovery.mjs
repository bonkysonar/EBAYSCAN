import { extractVinylPriceDropCards, parseVinylPriceDropDetail } from "./dealSourceAdapters.mjs";

/** Check every homepage card. The optional feed budget applies only to extras. */
export async function discoverVinylPriceDrop({ fetchPage, mapConcurrent, concurrency = 3, extraLimit = 30 }) {
  const origin = "https://vinylpricedrop.com";
  const pages = [];
  const indexes = await Promise.all([
    ["homepage", `${origin}/`], ["feed", `${origin}/deals`], ["sitewide", `${origin}/deals/type/sitewide`],
  ].map(async ([kind, url]) => {
    try {
      const page = await fetchPage(url);
      const cards = extractVinylPriceDropCards(page.html, page.url);
      pages.push({ purpose: `${kind}-index`, role: kind === "sitewide" ? "sale" : "catalog", requestedUrl: url, resolvedUrl: page.url, status: "available" });
      return { kind, cards };
    } catch (error) {
      pages.push({ purpose: `${kind}-index`, role: kind === "sitewide" ? "sale" : "catalog", requestedUrl: url, status: "error", failureKind: error.failureKind ?? "network_error", error: error.message });
      return { kind, cards: [] };
    }
  }));
  const home = indexes[0].cards;
  const homeIds = new Set(home.map(card => card.detailUrl));
  const sitewideIds = new Set(indexes[2].cards.map(card => card.detailUrl));
  const extras = indexes[1].cards.filter(card => !homeIds.has(card.detailUrl) && !sitewideIds.has(card.detailUrl));
  const cards = [...new Map([...home, ...extras.slice(0, extraLimit), ...indexes[2].cards].map(card => [card.detailUrl, card])).values()];
  const outcomes = await mapConcurrent(cards, concurrency, async (card) => {
    const base = { ...card, homepage: homeIds.has(card.detailUrl), dealType: sitewideIds.has(card.detailUrl) ? "sitewide" : "product" };
    try {
      const page = await fetchPage(card.detailUrl);
      const detail = parseVinylPriceDropDetail(page.html, page.url, card.title);
      return { ...base, ...detail, status: detail.expired ? "expired" : base.dealType === "product" && detail.currentPrice === null ? "price_missing" : "discovery_lead" };
    } catch (error) {
      pages.push({ purpose: "deal-detail", role: base.dealType === "sitewide" ? "sale" : "catalog", requestedUrl: card.detailUrl, status: "error", failureKind: error.failureKind ?? "network_error", error: error.message });
      return { ...base, status: "access_failed", error: error.message };
    }
  });
  const homeOutcomes = outcomes.filter(row => row.homepage);
  return {
    outcomes, pages,
    stats: {
      adapter: "vinyl-price-drop-homepage-and-feed",
      evidenceScope: "homepage_cards_and_bounded_feed_not_full_catalog",
      homepageCardCount: home.length,
      homepageCheckedCount: homeOutcomes.filter(row => row.status !== "access_failed").length,
      homepageFailedCount: homeOutcomes.filter(row => row.status === "access_failed").length,
      homepageComplete: home.length > 0 && homeOutcomes.every(row => row.status !== "access_failed"),
      feedExtraCount: extras.length, feedExtraCheckedCount: Math.min(extraLimit, extras.length),
      feedExtraDeferredCount: Math.max(0, extras.length - extraLimit),
      sitewideCardCount: sitewideIds.size,
      detailPageCount: outcomes.filter(row => row.status !== "access_failed").length,
      detailErrorCount: outcomes.filter(row => row.status === "access_failed").length,
      expiredDealCount: outcomes.filter(row => row.status === "expired").length,
    },
  };
}
