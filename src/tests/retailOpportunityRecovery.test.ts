import { describe, expect, it } from "vitest";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";
import { consideration, decisionListDiagnostics } from "../lib/arbitrage/decisionList.mjs";
import { shopifyIdentity } from "../../scripts/lib/retailIdentity.mjs";
import { buildSoldResearchQueryVariants } from "../lib/arbitrage/soldResearchLinks.mjs";
import { selectResearchCandidates } from "../../scripts/lib/candidatePipeline.mjs";

const at = "2026-09-30T12:00:00Z";
const record = (): any => ({
  id: "fixture", artist: "Fixture Artist", title: "Fixture Album", sourceListingTitle: "Fixture Album LP",
  sourceId: "store", sourceName: "Store", sourceUrl: "https://store.example/products/album",
  purchasePrice: 8, sourceCurrency: "USD", condition: "new/sealed", capturedAt: at,
  purchaseOfferVerification: "direct_retailer",
  activeEvidence: { capturedAt: at, status: "available", exactMatchedListingCount: 29, matchConfidence: "high", searchComplete: true },
  soldEvidence: { capturedAt: at, status: "validated", source: "ebay-product-research", condition: "new_sealed", matchConfidence: "high",
    velocityEvidence: "verified_window_totals", observedWindow: {startDate:"2026-07-02",endDate:"2026-09-30"},
    unitsSold90Days: 6, unitsSold365Days: null, latestSaleDate: "2026-09-25", conservativeResalePrice: 60 },
});

describe("opportunity recovery without weaker purchase evidence", () => {
  it("uses six observed 90-day sales as a lower bound for annual demand, without extrapolation", () => {
    const input = record(); input.activeEvidence.exactMatchedListingCount = 9;
    const result = evaluateOpportunity(input, {}, at);
    expect(result.estimatedDaysToSell).toBe(150);
    expect(result.recommendedStrategy).toBe("high_margin");
    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("TEST_ONE_OPTION");
    expect(result.soldUnits365Days).toBeNull();
    expect(consideration(result, Date.parse(at)).qualifies).toBe(true);
    const sparse = record(); sparse.soldEvidence.unitsSold90Days = 1;
    expect(evaluateOpportunity(sparse, {}, at).decision).not.toBe("BUY");
    const aggregate = record(); aggregate.soldEvidence.velocityEvidence = "aggregate_only";
    expect(evaluateOpportunity(aggregate, {}, at).decision).not.toBe("BUY");
  });

  it("uses retailer artist metadata instead of the Soundtrack label and removes purchase extras from queries", () => {
    const identity = shopifyIdentity({title:"Soundtrack - Example Game Exclusive 2LP", vendor:"Composer And Band", product_type:"Vinyl"});
    expect(identity.artist).toBe("Composer And Band");
    expect(buildSoldResearchQueryVariants(identity)[0].query).toBe("Composer And Band Example Game");
    expect(buildSoldResearchQueryVariants({artist:"Artist",title:"Album Exclusive Color 2LP (Autographed)"})[0].query).toBe("Artist Album");
    expect(buildSoldResearchQueryVariants({artist:"Artist",title:"Album LP (Color) With Autographed Jacket"})[0].query).toBe("Artist Album");
    expect(buildSoldResearchQueryVariants({artist:"Artist",title:"Album LP (Color) - Autographed"})[0].query).toBe("Artist Album");
    expect(buildSoldResearchQueryVariants({artist:"Artist",title:"Signed Sealed Delivered"})[0].query).toBe("Artist Signed Sealed Delivered");
    const subtitle = shopifyIdentity({title:"Act III: Life And Death Exclusive 2LP", vendor:"The Dear Hunter", product_type:"Vinyl"}, {}, {id:"newbury-comics"});
    expect(buildSoldResearchQueryVariants(subtitle)[0].query).toBe("The Dear Hunter Act III Life And Death");
  });

  it("reconciles every excluded product to one blocker, including profitable sparse-demand offers", () => {
    const good = record(); good.activeEvidence.exactMatchedListingCount = 1;
    const thin = {...good, id:"thin", purchasePrice:60};
    const unknown = {...good, id:"unknown", soldEvidence:undefined, conservativeResalePrice:undefined};
    const stale = {...good, id:"stale", capturedAt:"2026-09-20T00:00:00Z"};
    const sparse = {...good,id:"sparse",purchaseOfferVerification:"campaign_advertised",soldEvidence:{...good.soldEvidence,unitsSold90Days:1}};
    const rows = [good, thin, unknown, stale, sparse].map(f=>evaluateOpportunity(f,{},at));
    const diagnostics = decisionListDiagnostics(rows,Date.parse(at));
    expect(diagnostics.qualified).toBe(1);
    expect(diagnostics.blockers).toMatchObject({margin_too_thin:1, resale_evidence_missing:1, offer_needs_refresh:1, insufficient_recent_demand:1});
    expect(Object.values(diagnostics.blockers).reduce((a,b)=>a+b,0) + diagnostics.qualified).toBe(diagnostics.products);
  });

  it("balances both research lanes across retailers and never lets a research slot manufacture sold evidence", () => {
    const rows = Array.from({length:30},(_,i)=>({...record(),id:`lead-${i}`,sourceId:i===29?'small':'large',soldEvidence:undefined,purchasePrice:9}));
    const result=selectResearchCandidates(rows,{limit:10});
    expect(result.selected).toHaveLength(10);
    expect(result.selected.some(f=>f.sourceId==='small')).toBe(true);
    expect(result.selected.every(f=>evaluateOpportunity(f,{},at).decision!=='BUY')).toBe(true);
    expect(selectResearchCandidates([{...rows[0],available:false}],{limit:10}).selected).toHaveLength(0);
    expect(selectResearchCandidates(rows,{limit:0}).selected).toHaveLength(0);
  });
});
