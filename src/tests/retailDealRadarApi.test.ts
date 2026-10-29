import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetailDealRadar } from "../server/retailDealRadarApi";
import { SLICKDEALS_FEED_URLS } from "../../scripts/lib/dealFeedDiscovery.mjs";

const now = Date.parse("2026-10-28T20:00:00Z");
const item = (id: number, title: string, date = "Wed, 28 Oct 2026 12:00:00 GMT") => `<item><title><![CDATA[${title}]]></title><link>https://slickdeals.net/f/${id}-vinyl</link><pubDate>${date}</pubDate><description>Shipping free on $35+</description></item>`;
const feed = (items: string) => `<rss><channel>${items}</channel></rss>`;
afterEach(() => vi.useRealTimers());

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
