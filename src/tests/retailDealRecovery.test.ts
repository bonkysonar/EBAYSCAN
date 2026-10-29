import { describe, expect, it } from "vitest";
import { retailEligibility } from "../../scripts/lib/retailIdentity.mjs";
import { isHighSignalProductFind, selectResearchCandidates } from "../../scripts/lib/candidatePipeline.mjs";
import { buildProductResearchPlan } from "../../scripts/lib/productResearchCuration.mjs";

const now = "2026-10-28T18:00:00Z";
const offer = (id: string, extras: Record<string, unknown> = {}): any => ({
  id, sourceId: "shop", artist: `Artist ${id}`, title: `Album ${id}`,
  sourceListingTitle: `Artist ${id} - Album ${id} Vinyl LP`,
  sourceUrl: `https://shop.example/products/${id}`, purchasePrice: 12,
  capturedAt: now, ...extras,
});

describe("missed mainstream deal regressions", () => {
  it.each([
    "AC/DC: High Voltage (Vinyl w/ AutoRip MP3) $12.99",
    "Talking Heads: Little Creatures (Vinyl LP + MP3 Album) $9.99",
    "Artist - Album LP with free digital download",
  ])("keeps the physical record with a digital bonus: %s", sourceListingTitle => {
    expect(retailEligibility({ sourceListingTitle }).eligible).toBe(true);
    expect(retailEligibility({ sourceListingTitle, variantTitle: "MP3 download" }).eligible).toBe(false);
  });
  it.each(["Vinyl + MP3 download code only", "Artist Album MP3", "Artist Album Vinyl with MP3 only", "Artist Album Vinyl with MP3 no physical record"])("still excludes digital products: %s", sourceListingTitle => {
    expect(retailEligibility({ sourceListingTitle }).eligible).toBe(false);
  });
  it("keeps the publisher identity when the feed supplies a direct retailer URL", () => {
    expect(isHighSignalProductFind(offer("acdc", {
      artist: "AC/DC", title: "High Voltage", sourceListingTitle: "AC/DC: High Voltage (Vinyl w/ AutoRip MP3)",
      sourceId: "slickdeals-vinyl-records", sourceCountry: "US", sourceCurrency: "USD",
      condition: "new/sealed", candidateQualityScore: 75, purchasePrice: 12.99,
      sourceUrl: "https://www.amazon.com/dp/B0000CF35G",
      discoveryUrl: "https://slickdeals.net/f/20099772-12-99-ac-dc-high-voltage-vinyl",
      purchaseOfferVerification: "discovery_lead",
    }))).toBe(true);
  });
});

describe("finishable daily research cohort", () => {
  it("reserves the fresh discounted offer before deduplicating a familiar album", () => {
    const result = selectResearchCandidates([
      offer("full-price", { artist: "AC/DC", title: "High Voltage", sourceListingTitle: "AC/DC - High Voltage Vinyl", purchasePrice: 30, candidateQualityScore: 100,
        soldEvidence: { source: "local-own-sales-history", status: "validated", artistMatchConfirmed: true, albumMatchConfirmed: true, editionMatchConfirmed: true, matchConfidence: 1, unitsSold90Days: 10 } }),
      offer("fresh-deal", { artist: "AC/DC", title: "High Voltage", sourceListingTitle: "AC/DC - High Voltage Vinyl", purchasePrice: 12.99, sourcePublishedAt: now, purchaseOfferVerification: "discovery_lead" }),
    ], { limit: 12, freshDealShare: 1 / 3, uniqueAlbums: true, now });
    expect(result.selected.map(row => row.id)).toEqual(["fresh-deal"]);
  });
  it("reserves fresh deal events amid thousands of catalog offers without artist boosts", () => {
    const catalog = Array.from({ length: 6002 }, (_, i) => offer(`catalog-${i}`, {
      sourceId: `shop-${i % 20}`,
      soldEvidence: { source: "local-own-sales-history", status: "validated", artistMatchConfirmed: true, albumMatchConfirmed: true, editionMatchConfirmed: true, matchConfidence: 1, unitsSold90Days: 2 },
    }));
    const deals = Array.from({ length: 6 }, (_, i) => offer(`deal-${i}`, {
      sourceId: i % 2 ? "slickdeals-vinyl-records" : "reddit-vinyl-deals",
      sourcePublishedAt: "2026-10-28T16:00:00Z", purchaseOfferVerification: "discovery_lead",
    }));
    const result = selectResearchCandidates([...catalog, ...deals], { limit: 12, freshDealShare: 1 / 3, uniqueAlbums: true, now });
    expect(result.selected).toHaveLength(12);
    expect(result.diagnostics.freshDealSelectedCount).toBe(4);
    expect(result.selected[0].id).toMatch(/^deal-/);
    expect(buildProductResearchPlan(result.selected).length).toBe(12);
    expect(result.selected.every(row => !(row as any).decision && !(row as any).expectedNetProfit)).toBe(true);
  });
  it("does not spend the shortlist on the same album across many shops or reserve stale events", () => {
    const result = selectResearchCandidates([
      ...Array.from({ length: 30 }, (_, i) => offer(`duplicate-${i}`, { artist: "Same Artist", title: "Same Album", sourceListingTitle: "Same Artist - Same Album Vinyl", sourceId: `shop-${i}` })),
      ...Array.from({ length: 20 }, (_, i) => offer(`other-${i}`, { sourcePublishedAt: "2026-10-01T00:00:00Z", purchaseOfferVerification: "discovery_lead" })),
    ], { limit: 12, freshDealShare: 1 / 3, uniqueAlbums: true, now });
    expect(result.selected).toHaveLength(12);
    expect(result.selected.filter(row => row.artist === "Same Artist")).toHaveLength(1);
    expect(result.diagnostics.freshDealSelectedCount).toBe(0);
    expect(result.diagnostics.duplicateAlbumDeferredCount).toBe(29);
  });
});
