import { describe, expect, it } from "vitest";
import { getActiveRetailSources, getNoisySources, retailArbitrageSourceCatalog, vinylShopSources } from "../lib/arbitrage/vinylShopSources";

describe("retail arbitrage source catalog", () => {
  it("keeps active crawl targets deduped by domain", () => {
    const activeDomains = getActiveRetailSources().map((source) => source.domain);
    expect(new Set(activeDomains).size).toBe(activeDomains.length);
    expect(vinylShopSources).toHaveLength(activeDomains.length);
  });

  it("excludes discovery-only sources from the active crawl adapter", () => {
    const activeIds = new Set(vinylShopSources.map((source) => source.id));
    const discoveryIds = retailArbitrageSourceCatalog.filter((source) => source.isDiscoveryOnly).map((source) => source.id);

    expect(discoveryIds.length).toBeGreaterThan(0);
    expect(discoveryIds.some((id) => activeIds.has(id))).toBe(false);
  });

  it("uses VinylDeals as the active Reddit feed", () => {
    const activeIds = new Set(vinylShopSources.map((source) => source.id));
    expect(activeIds.has("reddit-vinyl-deals")).toBe(true);
    expect(activeIds.has("reddit-vgm-vinyl")).toBe(false);
  });

  it("keeps the MVD retail outlet active while distributor-only entries remain excluded", () => {
    const activeIds = new Set(vinylShopSources.map((source) => source.id));
    expect(activeIds.has("mvd-shop")).toBe(true);
    expect(activeIds.has("mvd-entertainment")).toBe(false);
  });

  it("uses stricter thresholds for noisy public sources", () => {
    const noisyPublicSources = getNoisySources().filter((source) =>
      ["barnes-noble", "deep-discount", "popmarket", "target", "udiscover-music", "walmart"].includes(source.id),
    );

    expect(noisyPublicSources.map((source) => source.id).sort()).toEqual([
      "barnes-noble",
      "deep-discount",
      "popmarket",
      "target",
      "udiscover-music",
      "walmart",
    ]);
    for (const source of noisyPublicSources) {
      expect(source.defaultDiscountThreshold).toBeGreaterThanOrEqual(0.4);
      expect(source.minNetProfit).toBeGreaterThanOrEqual(12);
      expect(source.minROI).toBeGreaterThanOrEqual(0.45);
    }
  });

  it("uses current official storefronts and productive public Shopify collections", () => {
    const byId = new Map(retailArbitrageSourceCatalog.map((source) => [source.id, source]));

    expect(byId.get("capitol-records-store")).toMatchObject({
      baseUrl: "https://shop.capitolmusic.com/collections/vinyl",
      crawlType: "shopify-store",
      domain: "shop.capitolmusic.com",
    });
    expect(byId.get("def-jam")).toMatchObject({
      baseUrl: "https://defjamshop.com/collections/vinyl",
      crawlType: "shopify-store",
      domain: "defjamshop.com",
    });
    expect(byId.get("emi-store")).toMatchObject({
      baseUrl: "https://emirecords.com/collections/vinyl",
      crawlType: "shopify-store",
      domain: "emirecords.com",
    });
    expect(byId.get("verve-store")).toMatchObject({
      baseUrl: "https://store.ververecords.com/collections/9-98-up-vinyl-collection",
      crawlType: "shopify-store",
      domain: "store.ververecords.com",
    });
    expect(byId.get("rarewaves")).toMatchObject({
      baseUrl: "https://www.rarewaves.com/collections/vinyl",
      crawlType: "shopify-store",
    });
  });

  it("does not regress repaired collection handles to known empty or removed routes", () => {
    const byId = new Map(retailArbitrageSourceCatalog.map((source) => [source.id, source.baseUrl]));

    expect(byId.get("plaid-room-records")).toBe("https://www.plaidroomrecords.com/collections/discounted");
    expect(byId.get("assai-records")).toBe("https://assai.co.uk/collections/a-z-vinyl-offers");
    expect(byId.get("daptone-records")).toBe("https://shopdaptonerecords.com/collections/lps");
    expect(byId.get("colemine-records")).toBe("https://www.coleminerecords.com/collections/lp");
    expect(byId.get("pure-noise-records")).toBe("https://purenoise.merchnow.com/collections/best-selling-vinyl");
    expect(byId.get("equal-vision")).toBe("https://equalvision.com/collections/vinyl-lp");
    expect(byId.get("sumerian-records")).toBe("https://sumerianrecords.com/collections/vinyl-records");
    expect(byId.get("rise-records")).toBe("https://riserecords.com/collections/vinyl-lp");
  });

  it("represents official eBay purchase discovery as an authenticated marketplace source", () => {
    const source = retailArbitrageSourceCatalog.find((entry) => entry.id === "ebay-purchase");

    expect(source).toMatchObject({
      crawlType: "marketplace",
      domain: "ebay.com",
      priority: 1,
      sourceType: "marketplace_retailer",
    });
    expect(source?.notes).toContain("Official Browse API");
    expect(source?.notes).toContain("requires eBay OAuth");
  });
});
