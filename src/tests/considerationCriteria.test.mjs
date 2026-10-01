import { describe, it, expect } from "vitest";
import { consideration, selectDecisionList, decisionListDiagnostics, scannerFunnel } from "../lib/arbitrage/decisionList.mjs";

const now = Date.parse("2026-10-01T18:00:00Z");
const offer = (profit, roi) => ({id:"fixture",artist:"Fixture Artist",title:"Fixture Album",recordFormat:"LP",
  capturedAt:new Date(now).toISOString(),decision:"REVIEW",sourceCurrency:"USD",expectedNetProfit:profit,roiRatio:roi,
  soldUnits90Days:6,gates:{evidenceFreshness:true,activeEvidence:true,soldEvidence:true,purchaseOffer:true,demand:true,supply:true,matchConfidence:true}});

describe("the owner's minimum dollar profit AND return on landed cost", () => {
  it.each([[4,.4,true],[3,.3,false],[6,.3,true],[5,.25,false],[1,1,false],[4,.2999,false]])(
    "$%s net and %s ROI qualifies: %s", (profit,roi,qualifies) => {
      expect(consideration(offer(profit,roi),now).qualifies).toBe(qualifies);
    });
  it("uses the same configurable minimums for the list, diagnostics and funnel", () => {
    const f=offer(6,.3),settings={considerationMinNetProfitDollars:7,considerationMinRoiRatio:.3};
    expect(selectDecisionList([f],{now,settings})).toHaveLength(0);
    expect(decisionListDiagnostics([f],now,settings).blockers).toEqual({margin_too_thin:1});
    expect(scannerFunnel([f],[],now,settings)).toMatchObject({economicallyQualified:0,displayed:0});
    expect(selectDecisionList([f],{now})).toHaveLength(1);
    expect(scannerFunnel([f],[],now)).toMatchObject({economicallyQualified:1,displayed:1});
  });
  it("does not let a different BUY profile bypass the owner's review minimum", () => {
    expect(consideration({...offer(4,.2),decision:"BUY"},now).qualifies).toBe(false);
  });
  it("still requires verified market evidence and defaults invalid preferences safely", () => {
    const f=offer(4,.3);
    expect(consideration({...f,gates:{...f.gates,activeEvidence:false}},now).qualifies).toBe(false);
    expect(consideration(offer(1,.1),now,{considerationMinNetProfitDollars:NaN,considerationMinRoiRatio:-1}).qualifies).toBe(false);
  });
});
