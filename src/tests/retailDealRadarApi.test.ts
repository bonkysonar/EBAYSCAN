import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownRadar, createRetailCampaignRadar, createRetailDealRadar } from "../server/retailDealRadarApi";
import { advertisedCollectionLinks } from "../../scripts/lib/retailSaleDiscovery.mjs";
import { SLICKDEALS_FEED_URLS } from "../../scripts/lib/dealFeedDiscovery.mjs";

const now = Date.parse("2026-10-28T20:00:00Z");
const item = (id: number, title: string, date = "Wed, 28 Oct 2026 12:00:00 GMT") => `<item><title><![CDATA[${title}]]></title><link>https://slickdeals.net/f/${id}-vinyl</link><pubDate>${date}</pubDate><description>Shipping free on $35+</description></item>`;
const feed = (items: string) => `<rss><channel>${items}</channel></rss>`;
afterEach(() => vi.useRealTimers());

describe("live retailer campaigns", () => {
  it("connects matching named sale headings and accepts explicit storewide announcements", () => {
    const html = `<h2>Up to 50% off The Opener</h2></div><div><a href="/collections/opener">Shop The Opener</a>
      <h2>Up to 70% off Sale Vinyl</h2><a href="/collections/toys">Shop Toys</a>
      <div class="announcement-bar__message "><p>15% off (almost) everything with code &#39;VINYL&#39; at checkout <button>More</button></p></div>`;
    expect(advertisedCollectionLinks(html, "https://records.example/")).toEqual([
      { url: "https://records.example/collections/opener", label: "Up to 50% off The Opener" },
      { url: "https://records.example/", label: "15% off (almost) everything with code 'VINYL' at checkout" },
    ]);
  });

  it("uses in-stock USD markdowns on exact physical variants and expires the cached price", async () => {
    let clock = now;
    let currency = "USD";
    const url = "https://store.bluenote.com/collections/sale";
    const campaigns = createRetailCampaignRadar({ now: () => clock, fetchImpl: async input => String(input).includes("bluenote.com")
      ? new Response('<a href="/collections/sale">50% off vinyl</a>', { headers: { "content-type": "text/html" } })
      : new Response("", { status: 404 }) });
    const variant = { id: 20, title: "Vinyl LP", price: "15", compare_at_price: "30", available: true };
    const product = { title: "Artist - Summer Vinyl LP", product_type: "Vinyl LP", handle: "artist-summer-vinyl", vendor: "Artist",
      variants: [variant, { ...variant, id: 21, available: false }, { ...variant, id: 22, compare_at_price: "15" }] };
    const fetchImpl = vi.fn(async input => Response.json(String(input).endsWith("/cart.js") ? { currency } : { products: [product] }));
    const read = createMarkdownRadar(campaigns, fetchImpl, () => clock);
    const [payload] = await Promise.all([read(), read()]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(payload.sources[0].url).toBe(url + "/products.json?limit=50");
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ price: 15, compareAt: 30, url: "https://store.bluenote.com/products/artist-summer-vinyl?variant=20" });
    clock += 300000;
    currency = "CAD";
    expect(await read()).toMatchObject({ status: "unavailable", items: [] });
  });
  it("keeps distinct official collection tiers and full terms, and drops stale or external offers", async () => {
    let clock = now;
    let offline = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (offline || !String(input).includes("udiscovermusic.com")) return new Response("blocked", { status: 403 });
      return new Response(`<a href="/collections/20-sale">20% off in cart (exclusions apply)</a>
        <a href="/collections/20-sale">20% off</a><a href="/collections/50-sale"><b>50%</b> off vinyl</a>
        <a href="https://other.example/collections/sale">80% off</a>
        <a href="/collections/apparel">70% off</a><script><a href="/collections/old">90% off</a></script>`,
        { headers: { "content-type": "text/html" } });
    });
    const read = createRetailCampaignRadar({ fetchImpl, now: () => clock });
    const [payload] = await Promise.all([read(), read()]);
    expect(payload.status).toBe("partial");
    expect(payload.items.map(item => item.label)).toEqual(["20% off in cart (exclusions apply)", "50% off vinyl"]);
    expect(fetchImpl).toHaveBeenCalledTimes(payload.sources.length);
    expect(payload.sources.length).toBeGreaterThanOrEqual(5);
    offline = true;
    clock += 300000;
    expect(await read()).toMatchObject({ status: "unavailable", items: [] });
  });
});

describe("independent live deal radar", () => {
  it("surfaces both reported physical albums without waiting for research and rejects toys/expired ages", async () => {
    const xml = feed(item(1, 'Talking Heads "Little Creatures" (Vinyl w/ AutoRip MP3) $9.99') +
      item(2, "$12.99 | AC/DC: High Voltage (Vinyl w/ AutoRip MP3) at Amazon") +
      item(3, "Youtooz Kaiju No. 8 Vinyl Figure $12.99") +
      item(4, 'Artist "Expired Album" Vinyl $10', "Mon, 05 Oct 2026 12:00:00 GMT"));
    const fetchImpl = vi.fn(async () => new Response(xml));
    const read = createRetailDealRadar({ fetchImpl, now: () => now });
    const payload = await read();
    expect(payload.status).toBe("available");
    expect(payload.items.map(row => row.artist)).toEqual(["Talking Heads", "AC/DC"]);
    expect(payload.items[0].advertisedPrice).toBe(9.99);
    expect(payload.items[0]).not.toHaveProperty("profit");
    expect(payload.items[0]).not.toHaveProperty("available");
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it("uses only fixed feed URLs, shares in-flight work, and refreshes after five minutes", async () => {
    let clock = now;
    const fetchImpl = vi.fn(async () => new Response(feed(item(1, "Artist - Album Vinyl $12"))));
    const read = createRetailDealRadar({ fetchImpl, now: () => clock });
    await Promise.all([read(), read(), read()]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(call => (call as unknown[])[0])).toEqual([...SLICKDEALS_FEED_URLS]);
    clock += 299999;
    await read();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    clock += 1;
    await read();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("keeps the newest discussion for an exact retailer URL while preserving variants and unknown URLs", async () => {
    const linkedItem = (id: number, hour: number, asin?: string) => item(id, 'Artist "Album" (Vinyl) $12', `Wed, 28 Oct 2026 ${hour}:00:00 GMT`)
      .replace("Shipping free on $35+", asin ? `&lt;a href=&quot;https://www.amazon.com/dp/${asin}&quot;&gt;Amazon&lt;/a&gt;` : "Retailer link not supplied");
    const xml = feed(linkedItem(1, 12, "B000000001") + linkedItem(2, 15, "B000000001") + linkedItem(3, 13, "B000000002") + linkedItem(4, 14) + linkedItem(5, 16));
    const read = createRetailDealRadar({ now: () => now, fetchImpl: vi.fn(async () => new Response(xml)) });
    const payload = await read();
    expect(payload.items.map(row => row.id)).toEqual(["/f/5", "/f/2", "/f/4", "/f/3"]);
    expect(payload.items.filter(row => row.retailerUrl === "https://www.amazon.com/dp/B000000001")).toHaveLength(1);
    expect(payload.items.filter(row => row.retailerUrl === null)).toHaveLength(2);
  });

  it("bounds hung requests to eight seconds and exposes unknown coverage", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const read = createRetailDealRadar({ fetchImpl, now: () => now });
    const result = read();
    await vi.advanceTimersByTimeAsync(8000);
    const payload = await result;
    expect(payload).toMatchObject({ status: "unavailable", items: [] });
    expect(payload.sources.every(source => source.reason === "Publisher request timed out")).toBe(true);
  });

  it("keeps a working feed visible during partial failure and never reuses expired cache after a failure", async () => {
    let clock = now;
    let failAll = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (failAll || String(input).includes("popdeals")) return new Response("blocked", { status: 403 });
      return new Response(feed(item(1, "Artist - Album Vinyl $12")));
    });
    const read = createRetailDealRadar({ fetchImpl, now: () => clock });
    expect(await read()).toMatchObject({ status: "partial", items: [{ artist: "Artist" }] });
    clock += 300001;
    failAll = true;
    expect(await read()).toMatchObject({ status: "unavailable", items: [] });
  });

  it("does not call a 200 browser challenge a successful empty feed", async () => {
    const read = createRetailDealRadar({ now: () => now, fetchImpl: vi.fn(async () => new Response("<html>Challenge</html>")) });
    expect(await read()).toMatchObject({ status: "unavailable", items: [] });
  });

  it("bounds feed body bytes even without a content-length header", async () => {
    const read = createRetailDealRadar({ now: () => now, fetchImpl: vi.fn(async () => new Response("x".repeat(2_000_001))) });
    expect(await read()).toMatchObject({ status: "unavailable", items: [] });
  });
});
