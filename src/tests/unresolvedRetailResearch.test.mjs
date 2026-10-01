import { describe, expect, it } from "vitest";
import { hasResearchableRetailIdentity, shopifyIdentity } from "../../scripts/lib/retailIdentity.mjs";
import { selectResearchCandidates, isHighSignalProductFind } from "../../scripts/lib/candidatePipeline.mjs";
import { buildProductResearchPlan } from "../../scripts/lib/productResearchCuration.mjs";
import { consideration } from "../lib/arbitrage/decisionList.mjs";

const candidate = { id: "precise-label-offer", artist: "Unknown Artist", title: "Mary Chapin Carpenter Come On Come On",
  sourceListingTitle: "Mary Chapin Carpenter Come On Come On Vinyl", identityStatus: "unresolved",
  physicalFormatConfirmed: true, purchasePrice: 17.99, sourceId: "test-label", available: true,
  sourceOriginalPrice: 29.99, candidateQualityScore: 95,
  sourceUrl: "https://label.example/collections/sale/products/mary-chapin-carpenter-come-on-come-on" };

describe("investigate unresolved retail names without recommending them", () => {
  it("admits a precise label title to research, preserving the unresolved identity", () => {
    const { selected, diagnostics } = selectResearchCandidates([candidate], { limit: 10 });
    expect(selected).toHaveLength(1);
    expect(diagnostics.representedSourceCount).toBe(1);
    expect(diagnostics.sources[0].selectedCandidateCount).toBe(1);
    expect(diagnostics.excludedByReason.duplicate_candidate_identity).toBe(0);
    expect(selected[0].identityStatus).toBe("unresolved");
    expect(buildProductResearchPlan(selected)[0]).toMatchObject({ requiresIdentityConfirmation: true,
      variants: [{ query: "Mary Chapin Carpenter Come On Come On" }] });
    expect(isHighSignalProductFind(selected[0])).toBe(true);
    expect(consideration({ ...selected[0], decision: "BUY", expectedNetProfit: 100,
      roiRatio: 3, capturedAt: new Date().toISOString() }).qualifies).toBe(false);
  });
  it.each([
    { sourceListingTitle: "New Sealed Limited Edition Vinyl LP", title: "Vinyl" },
    { physicalFormatConfirmed: false }, { available: false },
    { sourceListingTitle: "Mary Chapin Carpenter Come On Come On CD" },
    { sourceListingTitle: "Mary Chapin Carpenter Come On Come On Damaged Vinyl" },
  ])("does not spend research on vague, unavailable or non-record offers: %o", overrides => {
    expect(hasResearchableRetailIdentity({ ...candidate, ...overrides })).toBe(false);
    expect(buildProductResearchPlan([{ ...candidate, ...overrides }])).toEqual([]);
  });
  it.each(["Unruly Child S/T (2-LP Set)", "Unruly Child Self-Titled Vinyl"])("understands the explicit self-titled marker: %s", title => {
    expect(shopifyIdentity({ title, vendor: "Test Music", tags: ["Vinyl"] }, { title: "Red" })).toMatchObject({
      artist: "Unruly Child", title: "Unruly Child", identityStatus: "resolved", physicalFormatConfirmed: true,
    });
  });
});
