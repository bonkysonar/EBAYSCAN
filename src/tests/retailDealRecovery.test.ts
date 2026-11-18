import { describe, expect, it } from "vitest";
import { retailEligibility } from "../../scripts/lib/retailIdentity.mjs";
import { isHighSignalProductFind, selectResearchCandidates } from "../../scripts/lib/candidatePipeline.mjs";
import { buildProductResearchPlan, productResearchRowMatchScore } from "../../scripts/lib/productResearchCuration.mjs";
import { buildActiveSearchProfile, matchActiveListing } from "../lib/arbitrage/activeEbayMatching.mjs";
import { candidateIdentity, recentUnpriceableOffers, unchangedUnpriceableOffer } from "../../scripts/lib/researchExclusions.mjs";
import { normalizeResearchTitle } from "../lib/arbitrage/soldResearchLinks.mjs";
import { slowerSaleWithMargin } from "../lib/arbitrage/decisionList.mjs";

const now = "2026-10-28T18:00:00Z";
const offer = (id: string, extras: Record<string, unknown> = {}): any => ({
  id, sourceId: "shop", artist: `Artist ${id}`, title: `Album ${id}`,
  sourceListingTitle: `Artist ${id} - Album ${id} Vinyl LP`,
  sourceUrl: `https://shop.example/products/${id}`, purchasePrice: 12,
  capturedAt: now, ...extras,
});

describe("missed mainstream deal regressions", () => {
  it("repairs the stored feed title before building a sold search", () => {
    expect(normalizeResearchTitle("Rumours --")).toBe("Rumours");
    const plan = buildProductResearchPlan([offer("rumours", { artist: "Fleetwood Mac", title: "Rumours --",
      sourceListingTitle: "Fleetwood Mac - Rumours Vinyl LP" })]);
    expect(plan[0].variants[0].query).toBe("Fleetwood Mac Rumours");
  });
  it.each([
    ["Ella Fitzgerald & Louis Armstrong", "Ella & Louis", "Ella Fitzgerald & Louis Armstrong - Ella and Louis Vinyl LP", true],
    ["Ella Fitzgerald & Louis Armstrong", "Ella & Louis", "Louis Armstrong Ella Fitzgerald Duke Ellington Ray Charles Europa Jazz LP", false],
    ["Ella Fitzgerald & Louis Armstrong", "Ella & Louis", "Ella Fitzgerald & Louis Armstrong - Ella & Louis Again New LP", false],
    ["Fleetwood Mac", "Rumours", "Fleetwood Mac Rumours Live Vinyl LP", false],
    ["Fleetwood Mac", "Rumours Live", "Fleetwood Mac Rumours Live Vinyl LP", true],
  ])("checks release identity in both sold and active comparisons: %s / %s / %s", (artist, title, listing, expected) => {
    const find = offer("release", { artist, title, sourceListingTitle: `${artist} - ${title} Vinyl LP` });
    expect(matchActiveListing(String(listing), buildActiveSearchProfile(find)!).matched).toBe(expected);
    expect(productResearchRowMatchScore(find, String(listing)) > 0.68).toBe(expected);
  });
  it("keeps the complete resolved PJ Harvey title and distinguishes the demo release", () => {
    const title = "Stories From The City, Stories From The Sea - Demos LP";
    const find = offer("pj", { artist: "PJ Harvey", title, sourceListingTitle: title, identityStatus: "resolved" });
    const profile = buildActiveSearchProfile(find)!;
    expect(profile.primary).toBe(buildProductResearchPlan([find])[0].variants[0].query);
    expect(matchActiveListing("PJ Harvey 4-Track Demos LP", profile).matched).toBe(false);
    for (const [listing, accepted] of [
      ["PJ Harvey Stories From The City Stories From The Sea Vinyl LP", false],
      ["PJ Harvey Stories From The City Stories From The Sea Demos Vinyl LP", true],
    ] as const) {
      expect(matchActiveListing(listing, profile).matched).toBe(accepted);
      expect(productResearchRowMatchScore(find, listing) > 0.68).toBe(accepted);
    }
  });
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
  it("reserves a slot for a deep retailer markdown without treating the original price as resale evidence", () => {
    const discounted = offer("deep", { purchasePrice: 9.99, sourceOriginalPrice: 39.99, shopifyVariantId: "sku",
      sourceCurrency: "USD", sourceCountry: "US", physicalFormatConfirmed: true, identityStatus: "resolved", available: true });
    const ordinary = Array.from({ length: 4 }, (_, i) => offer("catalog-" + i, { sourceId: "shop-" + i, candidateQualityScore: 100 }));
    const picks = selectResearchCandidates([...ordinary, discounted], { limit: 2, prioritizeRetailSales: true, now });
    expect(picks.selected.map(f => f.id)).toContain("deep");
    expect(picks.selected.find(f => f.id === "deep")?.expectedNetProfit).toBeUndefined();
  });
  it("keeps slow sales with supported margins visible only while both market observations are current", () => {
    const find = offer("slow", { decision: "REJECT", reasonCodes: ["DEMAND_GATE_FAILED", "SUPPLY_GATE_FAILED"],
      soldUnits90Days: 2, roiRatio: 0.42, expectedNetProfit: 6.71,
      soldEvidence: { source: "ebay-product-research", capturedAt: now, velocityEvidence: "verified_window_totals" },
      activeEvidence: { capturedAt: now }, retailVerification: { status: "verified", checkedAt: now },
      gates: { activeEvidence: true, soldEvidence: true, matchConfidence: true, purchaseOffer: true } });
    const checked = Date.parse(now);
    expect(slowerSaleWithMargin(find, checked)).toBe(true);
    expect(slowerSaleWithMargin({ ...find, expectedNetProfit: 0.50 }, checked)).toBe(false);
    expect(slowerSaleWithMargin({ ...find, reasonCodes: ["ECONOMICS_HARD_FAIL"] }, checked)).toBe(false);
    expect(slowerSaleWithMargin({ ...find, soldUnits90Days: 0 }, checked)).toBe(false);
    expect(slowerSaleWithMargin(find, checked + 6 * 3600000 + 1)).toBe(false);
  });
  it("retries an excluded offer when terms change, it ages out, or capacity permits", () => {
    const tried = offer("tried", { candidateQualityScore: 100 });
    const prior = { runId: "old", researchCandidates: [tried], researchExclusions: [{
      findId: tried.id, runId: "old", candidateIdentity: candidateIdentity(tried), reviewedAt: now,
      reason: "unverifiable_sold_controls", outcome: "excluded_unpriceable", recoveryAttempted: true, evidenceVerified: false,
    }] };
    const blocked = recentUnpriceableOffers(prior, now);
    const options = { limit: 1, recentlyBlocked: (find: any) => unchangedUnpriceableOffer(find, blocked) };
    expect(selectResearchCandidates([tried, offer("fresh")], options).selected[0].id).toBe("fresh");
    expect(selectResearchCandidates([tried], options).selected[0].id).toBe("tried");
    expect(options.recentlyBlocked({ ...tried, purchasePrice: 9 })).toBe(false);
    expect(options.recentlyBlocked({ ...tried, appliedSaleCampaignId: "new-sale" })).toBe(false);
    expect(recentUnpriceableOffers(prior, Date.parse(now) + 48 * 3600000).size).toBe(0);
  });
  it("reserves research for a campaign and puts a supported margin ahead of a known loss", () => {
    const evidence = { source: "local-own-sales-history", status: "validated", artistMatchConfirmed: true,
      albumMatchConfirmed: true, editionMatchConfirmed: true, matchConfidence: 1, unitsSold90Days: 3 };
    const known = (id: string, averageSoldPrice: number) => offer(id, { artist: "Example", soldEvidence: evidence,
      sourceCurrency: "USD", averageSoldPrice, averageSoldShipping: 0 });
    const picks = selectResearchCandidates([known("a-loss", 5), known("z-margin", 50), offer("a-catalog"),
      offer("z-campaign", { appliedSaleCampaignId: "holiday" })], { limit: 2, prioritizeRetailSales: true, now }).selected;
    expect(picks.map(p => p.id)).toEqual(["z-margin", "z-campaign"]);
    expect(picks.every(p => !p.decision)).toBe(true);
  });
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
