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
});
