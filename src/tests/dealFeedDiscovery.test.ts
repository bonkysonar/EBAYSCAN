import { describe, expect, it } from "vitest";
import { discoverSlickdealsFeeds, parseSlickdealsFeed, SLICKDEALS_FEED_URLS } from "../../scripts/lib/dealFeedDiscovery.mjs";
import { splitDealArtistTitle } from "../../scripts/lib/dealSourceAdapters.mjs";

const now = Date.parse("2026-10-28T20:00:00Z");
const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;
function item({ id = "20187786", title = 'Talking Heads "Little Creatures" (Vinyl w/ AutoRip MP3) $9.99 + Free Shipping w/ Prime or on $35+', date = "Wed, 28 Oct 2026 12:00:00 +0000", body = '<a href="https://slickdeals.net/click?token=opaque" data-product-exitWebsite="amazon.com" data-aps-asin="B0CG7WB74W">Amazon</a> has this vinyl for <b>$9.99</b>. Shipping free with Prime or $35+. Please report the deal if expired.', category = "" } = {}) {
  return `<item><title><![CDATA[${title}]]></title><link>https://slickdeals.net/f/${id}-record?utm_source=rss</link><content:encoded><![CDATA[${body}]]></content:encoded><pubDate>${date}</pubDate>${category}</item>`;
}

describe("publisher deal feeds", () => {
  it("recovers the reported album identities and explicit retailer URLs from RSS fields", () => {
    const deals = parseSlickdealsFeed(rss(item() + item({ id: "20099772", title: "$12.99 | AC/DC: High Voltage (Vinyl w/ AutoRip MP3) at Amazon", body: '<a href="https://www.amazon.com/dp/B00008WT5E?tag=feed">Amazon</a> has High Voltage for $12.99. Shipping free on $35+.' })));
    expect(deals[0]).toMatchObject({ price: 9.99, directUrl: "https://www.amazon.com/dp/B0CG7WB74W", expired: false, publishedAt: "2026-10-28T12:00:00.000Z", priceSource: "publisher_item_price" });
    expect(deals[1]).toMatchObject({ price: 12.99, directUrl: "https://www.amazon.com/dp/B00008WT5E" });
    expect(splitDealArtistTitle(deals[0].title)).toEqual({ artist: "Talking Heads", title: "Little Creatures" });
    expect(splitDealArtistTitle(deals[1].title)).toEqual({ artist: "AC/DC", title: "High Voltage (Vinyl w/ AutoRip MP3)" });
  });

  it("uses precise item prices without treating shipping thresholds or discounts as purchase prices", () => {
    const rounded = parseSlickdealsFeed(rss(item({ title: 'Artist "Album" (Vinyl LP) $25 + Free Shipping on $35+', body: "Amazon has this album on sale for $25.18. Shipping on $35+. Walmart has it for $28." })))[0];
    expect(rounded.price).toBe(25.18);
    for (const title of ["Artist Album Vinyl LP + Free Shipping on $35+", "Artist Album Vinyl LP $10 off", "Save $10 on Artist Album Vinyl LP"]) {
      expect(parseSlickdealsFeed(rss(item({ title, body: "Shipping is free on $35+" })))[0].price).toBeNull();
    }
  });

  it("removes a leading price and known store without discarding digits in artist names", () => {
    expect(splitDealArtistTitle("$10.61 WALMART Garth Brooks - Triple Live - Music & Performance - Vinyl [Exclusive]")).toEqual({ artist: "Garth Brooks", title: "Triple Live - Music & Performance - Vinyl [Exclusive]" });
    expect(splitDealArtistTitle("$14.99 Amazon 10cc - Bloody Tourists (Vinyl)")).toEqual({ artist: "10cc", title: "Bloody Tourists (Vinyl)" });
    expect(splitDealArtistTitle("The 1975 - Being Funny in a Foreign Language (Vinyl) $15.99")).toEqual({ artist: "The 1975", title: "Being Funny in a Foreign Language (Vinyl)" });
  });

  it("does not confuse instructions to report expiry with actual expiry labels", () => {
    const deals = parseSlickdealsFeed(rss(item() + item({ id: "20094582", category: "<category>Expired Deals</category>" })));
    expect(deals.map(deal => deal.expired)).toEqual([false, true]);
  });

  it("keeps missing direct URLs and alternate retailer identity unresolved", () => {
    for (const body of [
      '<a href="http://127.0.0.1/product/secret">Buy</a> $9.99',
      '<a href="https://slickdeals.net/click?opaque=1" data-product-exitWebsite="walmart.com">Walmart</a> has it for $9.99. Alternatively <a href="https://www.amazon.com/dp/B0CG7WB74W">Amazon</a>.',
      '<a href="https://evil.example/products/album" data-product-exitWebsite="amazon.com" data-aps-asin="invalid">Buy</a>',
    ]) expect(parseSlickdealsFeed(rss(item({ body })))[0].directUrl).toBeNull();
  });

  it("keeps expired, stale, undated and unpriced outcomes out of the fresh lead queue", async () => {
    const xml = rss(item() + item({ id: "1001", category: "<category>Expired</category>" }) + item({ id: "1002", date: "Mon, 05 Oct 2026 12:00:00 +0000" }) + item({ id: "1003", date: "" }) + item({ id: "1004", title: "Artist Album Vinyl LP", body: "Price unavailable" }));
    const discovery = await discoverSlickdealsFeeds({ fetchPage: async url => ({ url, html: xml }), now });
    expect(discovery.outcomes.map(deal => deal.status)).toEqual(["discovery_lead", "expired", "stale", "undated", "price_missing"]);
    expect(discovery.stats).toMatchObject({ feedEntryCount: 10, uniqueDealCount: 5, activeDealCount: 1, feedSuccessCount: 2 });
    expect(discovery.outcomes[0]).not.toHaveProperty("available");
    expect(discovery.outcomes[0]).not.toHaveProperty("capturedAt");
  });

  it("reports blocked and malformed responses as failed coverage instead of a healthy empty catalog", async () => {
    const discovery = await discoverSlickdealsFeeds({ now, fetchPage: async url => {
      if (url === SLICKDEALS_FEED_URLS[0]) throw Object.assign(new Error("HTTP 403"), { failureKind: "blocked" });
      return { url, html: "<html>Checking your browser</html>" };
    } });
    expect(discovery.outcomes).toEqual([]);
    expect(discovery.stats).toMatchObject({ feedErrorCount: 2, feedSuccessCount: 0 });
    expect(discovery.pages.map(page => page.failureKind)).toEqual(["blocked", "invalid_feed"]);
  });

  it("honors an expired duplicate in either publisher stream regardless of order", async () => {
    for (const firstExpired of [false, true]) {
      const discovery = await discoverSlickdealsFeeds({ now, fetchPage: async url => ({ url, html: rss(item({ category: (url === SLICKDEALS_FEED_URLS[0]) === firstExpired ? "<category>Expired Deals</category>" : "" })) }) });
      expect(discovery.outcomes).toHaveLength(1);
      expect(discovery.outcomes[0]).toMatchObject({ expired: true, status: "expired", price: 9.99 });
      expect(discovery.stats.activeDealCount).toBe(0);
    }
  });

  it("continues after one failed stream and accepts a genuinely empty valid feed", async () => {
    const discovery = await discoverSlickdealsFeeds({ now, fetchPage: async url => {
      if (url === SLICKDEALS_FEED_URLS[0]) throw new Error("timeout");
      return { url, html: rss("") };
    } });
    expect(discovery.stats).toMatchObject({ feedSuccessCount: 1, feedErrorCount: 1, uniqueDealCount: 0 });
  });

  it("rejects a truncated item instead of silently dropping the publisher's offers", () => {
    expect(() => parseSlickdealsFeed("<rss><channel><item><title>Lost deal</title></channel></rss>")).toThrow("complete RSS feed");
  });
});
