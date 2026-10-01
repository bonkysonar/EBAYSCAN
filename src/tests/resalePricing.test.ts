import { describe, expect, it } from "vitest";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";
import { consideration } from "../lib/arbitrage/decisionList.mjs";

const now = "2026-10-01T12:00:00Z";
const fixture = (): any => ({
  id: "synthetic-double", artist: "Fixture Artist", title: "Fixture Album",
  sourceListingTitle: "Fixture Artist - Fixture Album Blue Smoke 2 LP",
  sourceId: "fixture", sourceName: "Fixture Store", sourceUrl: "https://example.test/album",
  purchasePrice: 19.99, sourceCountry: "US", sourceCurrency: "USD", condition: "new/sealed",
  capturedAt: now, purchaseOfferVerification: "direct_retailer", costs: { inboundShipping: 0 },
  lowestActivePrice: 44.99,
  activeEvidence: { capturedAt: now, status: "available", searchComplete: true,
    matchConfidence: "high", exactMatchedListingCount: 9 },
  soldEvidence: { capturedAt: now, status: "validated", condition: "new_sealed", source: "ebay-product-research",
    velocityEvidence: "verified_window_totals", observedWindow: { startDate: "2026-07-03", endDate: "2026-10-01" },
    unitsSold90Days: 4, unitsSold365Days: 10, latestSaleDate: "2026-09-20", matchConfidence: "high", conservativeResalePrice: 56.9 },
  ebayActiveListings: [44.99,49,50,56.9,65.25,74.99,76.98,99.98].map((price, i) => ({
    id: `synthetic-${i}`, price, shippingPrice: 0, totalPrice: price, currency: "USD", condition: "New", matchConfidence: "high",
  })),
});

describe("sold-backed competitive resale pricing", () => {
  it("shows a realistic target and its lower-priced downside without automatic BUY", () => {
    const result = evaluateOpportunity(fixture(), {}, now);
    expect(result.conservativeResalePrice).toBe(49);
    expect(result.costLedger.outboundShipping).toBe(6);
    expect(result.expectedNetProfit).toBe(8.21);
    expect(result.roiRatio).toBe(.3751);
    expect(result.resalePricingScenario).toMatchObject({ basis: "sold_and_active_lower_quartile",
      quoteCount: 8, lowestPriceNetProfit: 5.13, lowestPriceRoiRatio: .2344 });
    expect(result.reasonCodes).toContain("LOWEST_ACTIVE_PRICE_BELOW_RETURN_TARGET");
    expect(result.decision).not.toBe("BUY");
    expect(consideration(result, Date.parse(now)).qualifies).toBe(true);
    expect(evaluateOpportunity(result, {}, now)).toEqual(result);
  });
  it("never raises a valuation above sold evidence", () => {
    const input=fixture(); input.soldEvidence.conservativeResalePrice=35;
    expect(evaluateOpportunity(input, {}, now).conservativeResalePrice).toBe(35);
    input.soldEvidence.conservativeResalePrice=null;
    expect(evaluateOpportunity(input, {}, now).conservativeResalePrice).toBeNull();
  });
  it("downgrades even a fast seller to review when the cheapest-price return misses the user's floor", () => {
    const input=fixture(); input.soldEvidence.unitsSold90Days=30;
    const result=evaluateOpportunity(input,{},now);
    expect(result.gates.economics).toBe(true);
    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("LOWEST_ACTIVE_PRICE_BELOW_RETURN_TARGET");
  });
  it.each(["sparse", "aggregate", "incomplete", "low coverage", "duplicates", "currency", "condition", "mismatched total", "weak match", "stale sold"])("retains strict lowest-price treatment for %s evidence", kind => {
    const input=fixture();
    if(kind==="sparse") input.soldEvidence.unitsSold90Days=1;
    if(kind==="aggregate") input.soldEvidence.velocityEvidence="aggregate_last_sale_only";
    if(kind==="incomplete") input.activeEvidence.searchComplete=false;
    if(kind==="low coverage") input.activeEvidence.exactMatchedListingCount=15;
    if(kind==="low coverage") input.ebayActiveListings.pop();
    if(kind==="duplicates") input.ebayActiveListings.forEach((r:any)=>r.id="same");
    if(kind==="currency") input.ebayActiveListings.forEach((r:any)=>r.currency="GBP");
    if(kind==="condition") input.ebayActiveListings.forEach((r:any)=>r.condition="Used");
    if(kind==="mismatched total") input.ebayActiveListings.forEach((r:any)=>r.shippingPrice=10);
    if(kind==="weak match") input.ebayActiveListings.forEach((r:any)=>r.matchConfidence="low");
    if(kind==="stale sold") input.soldEvidence.capturedAt="2026-10-01T05:59:59Z";
    const result=evaluateOpportunity(input, {}, now);
    expect(result.resalePricingScenario?.basis).toBe("lowest_active_undercut");
    expect(result.conservativeResalePrice).toBe(44.09);
  });
  it("does not reuse expired or future active prices", () => {
    for(const at of ["2026-10-01T05:59:59Z", "2026-10-01T12:05:01Z"]) {
      const input=fixture(); input.activeEvidence.capturedAt=at;
      const result=evaluateOpportunity(input,{},now);
      expect(result.activeResaleCap).toBeNull();
      expect(result.decision).not.toBe("BUY");
    }
  });
  it("preserves exact label quotes and larger user allowances, and does not surcharge a single LP", () => {
    const input=fixture(); input.costs.outboundShipping=5.13;
    expect(evaluateOpportunity(input,{},now).costLedger.outboundShipping).toBe(5.13);
    delete input.costs.outboundShipping;
    expect(evaluateOpportunity(input,{defaultOutboundShipping:8},now).costLedger.outboundShipping).toBe(8);
    input.sourceListingTitle="Fixture Album LP";
    expect(evaluateOpportunity(input,{},now).costLedger.outboundShipping).toBe(4.39);
  });
});
