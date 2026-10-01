import { describe, it, expect } from "vitest";
import { reviewedRetailOffers, refreshReviewedRetailOffer } from "../../scripts/lib/reviewedRetailOffers.mjs";
import { buildActiveSearchProfile, matchActiveListing } from "../lib/arbitrage/activeEbayMatching.mjs";
import { productResearchRowMatchScore } from "../../scripts/lib/productResearchCuration.mjs";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";
import { consideration } from "../lib/arbitrage/decisionList.mjs";

const now = "2026-10-01T16:00:00Z";
const page = () => ({ sourceId: "best-buy", artist: "Test Artist", title: "Test Album", capturedAt: now,
  url: "https://www.bestbuy.com/product/test-album/ABC123/sku/12345678",
  text: "# Test Album [20th Anniversary Deluxe Edition] [Blue Smoke 2 LP] [Only @ Best Buy] [VINYL]\nSKU: 12345678\nSold by Best Buy\nArtist\nTest Artist\nAvailability\n$20.00\n$5.00 shipping to 00000\nAdd to cart",
  shippingPolicy: { capturedAt: now, url: "https://www.bestbuy.com/site/help-topics/free-shipping/pcmcat276800050002.c?id=pcmcat276800050002",
    text: "Free standard shipping on orders $35 and up. Free shipping is not available for Marketplace Products. The total is after coupons and before taxes." } });
const parse = p => reviewedRetailOffers({ version: 1, captureMethod: "public_page_reader", pages: [p] }, now)[0];
const find = () => ({ ...parse(page()),
  soldEvidence: { capturedAt: now, condition: "new_sealed", conservativeResalePrice: 60, latestSaleDate: "2026-09-25", matchConfidence: "high", source: "ebay-product-research", status: "validated", velocityEvidence: "verified_window_totals", unitsSold90Days: 4, unitsSold365Days: 10,
    observedWindow:{startDate:"2026-07-03",endDate:"2026-10-01"}, observedWindows: {90:{capturedAt:now,startDate:"2026-07-03",endDate:"2026-10-01"},365:{capturedAt:now,startDate:"2025-10-01",endDate:"2026-10-01"}} },
  activeEvidence: { capturedAt: now, exactMatchedListingCount: 9, matchConfidence: "high", searchComplete: true, status: "available" },
  lowestActivePrice: 50, ebayResearchStatus: "validated" });

describe("research-led offers", () => {
  it("imports exact fresh primary SKU observations without claiming catalog coverage", () => {
    expect(parse(page())).toMatchObject({ sourceCurrency: "USD", purchasePrice: 20, sku: "12345678", costs: { inboundShipping: 5 }, retailObservationMethod: "public_page_reader" });
  });
  it.each([
    p => ({ ...p, url: p.url.replace("www.bestbuy.com", "evil.test") }),
    p => ({ ...p, text: p.text.replace("12345678", "87654321") }),
    p => ({ ...p, text: p.text.replace("Sold by Best Buy", "Sold by Third Party") }),
    p => ({ ...p, text: p.text.replace("Add to cart", "Sold Out") }),
    p => ({ ...p, capturedAt: "2026-09-30T16:00:00Z" }),
    p => ({ ...p, shippingPolicy: { ...p.shippingPolicy, text: "Sale! Free shipping!" } }),
  ])("rejects unverified retailer evidence", change => expect(() => parse(change(page()))).toThrow());
  it("expires reviewed offers instead of refreshing their timestamps", () => {
    const result = refreshReviewedRetailOffer(find(), "2026-10-02T16:00:00Z");
    expect(result.retailVerification.status).toBe("needs_confirmation");
    expect(result.capturedAt).toBe(now);
    expect(result.shippingOffer).toBeUndefined();
  });
  it("allows omitted descriptive labels only with the same compound variant and disc count", () => {
    const candidate = find(), profile = buildActiveSearchProfile(candidate);
    const match = "Test Artist Test Album Blue Smoke 2LP Vinyl New";
    expect(matchActiveListing(match, profile).matched).toBe(true);
    expect(productResearchRowMatchScore(candidate, match)).toBeGreaterThanOrEqual(.8);
    for (const other of ["Test Artist Test Album Red Smoke 2LP Vinyl New", "Test Artist Test Album Blue Smoke LP Vinyl New", "Test Artist Test Album Blue Smoke 2LP Vinyl Signed", "Test Artist Test Album Blue Smoke 2LP Vinyl Splatter"]) {
      expect(matchActiveListing(other, profile).matched).toBe(false);
      expect(productResearchRowMatchScore(candidate, other)).toBeLessThan(.68);
    }
    const generic = { ...candidate, sourceListingTitle: "Test Artist Test Album Deluxe 2LP", retailEditionText: "Deluxe 2LP" };
    expect(matchActiveListing("Test Artist Test Album 2LP Vinyl", buildActiveSearchProfile(generic)).matched).toBe(false);
    expect(productResearchRowMatchScore(generic, "Test Artist Test Album 2LP Vinyl")).toBeLessThan(.68);
  });
  it("shows a conditional basket with tax, extra inventory cash and single-copy profit", () => {
    const result = evaluateOpportunity(find(), {}, now);
    expect(result.conservativeResalePrice).toBe(49);
    expect(result.historicalResalePrice).toBe(60);
    expect(result.costLedger.salesTax).toBe(1.9);
    expect(result.costLedger.inboundShipping).toBe(0);
    expect(result.shippingScenario).toMatchObject({ quantity: 2, subtotal: 40, additionalSpend: 20 });
    expect(result.shippingScenario.singleRecordNetProfit).toBeCloseTo(result.expectedNetProfit - 5, 2);
    expect(result.decision).not.toBe("BUY");
    expect(result.gates.purchaseOffer).toBe(false);
    expect(consideration(result, Date.parse(now))).toMatchObject({ qualifies: true, remainingChecks: [result.shippingScenario.condition] });
  });
  it("never fabricates demand and stops using expired shipping terms", () => {
    const incomplete = evaluateOpportunity({ ...find(), soldEvidence: undefined }, {}, now);
    expect(consideration(incomplete, Date.parse(now)).qualifies).toBe(false);
    const stale = evaluateOpportunity(find(), {}, "2026-10-01T23:00:01Z");
    expect(stale.shippingScenario).toBeNull();
    expect(stale.costLedger.inboundShipping).toBe(5);
    expect(evaluateOpportunity({ ...find(), quantityAvailable: 1 }, {}, now).shippingScenario).toBeNull();
  });
  it("uses asking prices only to lower fresh matched historical evidence", () => {
    const f = { ...find(), shippingOffer: undefined };
    expect(evaluateOpportunity({ ...f, lowestActivePrice: 100 }, {}, now).conservativeResalePrice).toBe(60);
    expect(evaluateOpportunity({ ...f, activeEvidence: { ...f.activeEvidence, matchConfidence: "low" } }, {}, now).conservativeResalePrice).toBe(60);
    expect(evaluateOpportunity({ ...f, soldEvidence: undefined }, {}, now).conservativeResalePrice).toBeNull();
  });
});
