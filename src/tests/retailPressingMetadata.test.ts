import { describe, expect, it } from "vitest";
import { shopifyIdentity } from "../../scripts/lib/retailIdentity.mjs";
import { verifyRetailOffer } from "../../scripts/lib/retailOfferVerification.mjs";
import { productResearchRowMatchScore, researchVariants, resetPressingSoldEvidence } from "../../scripts/lib/productResearchCuration.mjs";
import { buildActiveSearchProfile, matchActiveListing } from "../lib/arbitrage/activeEbayMatching.mjs";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";
import { applyRetailLearning, learningIdentity } from "../../scripts/lib/retailLearning.mjs";
import { deferredResearch, rememberResearch } from "../../scripts/lib/researchMemory.mjs";

const variant = { id: 22, title: "Default Title", available: true, price: 999, requires_shipping: true };
const product = { title: "Actual Album Exclusive LP", handle: "example-actual-album", vendor: "Example Artist", type: "Vinyl", tags: ["Exclusive", "fg_Vinyl Color_Green & Violet Swirl", "fg_Number of Discs_1", "fg_Catalog Number_LP-123"], variants: [variant] };
const source = { id: "newbury-comics", name: "Newbury Comics" };
const candidate = { id: "record", artist: "Example Artist", title: product.title, sourceListingTitle: product.title, sourceId: source.id, sourceName: source.name, sourceCountry: "US", sourceCurrency: "USD", purchasePrice: 9.99, sourceUrl: "https://www.newburycomics.com/products/example-actual-album?variant=22", shopifyVariantId: 22, capturedAt: "2026-10-01T14:00:00Z", condition: "new/sealed" };

describe("retailer pressing metadata", () => {
  it("retries an old empty match and clears obsolete suppression when the pressing is identified", () => {
    const now = Date.parse(candidate.capturedAt);
    const old = { ...candidate, ebayResearchStatus: "no_rows" as const, ebayResearchSearchComplete: true, ebayResearchUpdatedAt: candidate.capturedAt };
    const memory = rememberResearch([old], {}, now);
    expect(deferredResearch(old, memory, now)).toBeDefined();
    const corrected = { ...old, retailEditionText: "Green & Violet Swirl LP", retailCatalogNumber: "LP-123" };
    expect(deferredResearch(corrected, memory, now)).toBeNull();
    const identity = learningIdentity(old);
    expect(learningIdentity(corrected).key).toBe(identity.key);
    expect(applyRetailLearning([corrected], [{ ...identity, outcome: "bad_identity", updatedAt: candidate.capturedAt }], now)[0]).toMatchObject({ learningSuppressed: false });
    expect(learningIdentity(corrected).observation).toMatch(/^[a-f0-9]{64}$/);
  });
  it("binds structured Newbury color and disc tags to the single selected physical variant", () => {
    expect(shopifyIdentity(product, variant, source)).toMatchObject({ retailEditionText: "Green & Violet Swirl LP", retailCatalogNumber: "LP-123" });
    expect(shopifyIdentity({ ...product, tags: product.tags.join(",") }, variant, source)).toMatchObject({ retailEditionText: "Green & Violet Swirl LP" });
  });
  it("does not apply ambiguous product-wide colors to another SKU or retailer", () => {
    expect(shopifyIdentity({ ...product, variants: [variant, { ...variant, id: 23, title: "CD" }] }, variant, source).retailEditionText).toBeNull();
    expect(shopifyIdentity(product, { ...variant, id: 23 }, source).retailEditionText).toBeNull();
    expect(shopifyIdentity(product, variant, { id: "other-shop" }).retailEditionText).toBeUndefined();
    expect(shopifyIdentity({ ...product, tags: [...product.tags, "fg_Vinyl Color_Red"] }, variant, source).retailEditionText).toBeNull();
  });
  it("recovers the described color match and rejects vague or different-pressing sold rows", () => {
    const enriched = { ...candidate, ...shopifyIdentity(product, variant, source) };
    const correct = "Example Artist Actual Album Green Violet Swirl Vinyl LP New";
    expect(productResearchRowMatchScore(candidate, correct)).toBe(0);
    expect(productResearchRowMatchScore(enriched, correct)).toBeGreaterThan(.85);
    expect(productResearchRowMatchScore(enriched, "Example Artist Actual Album Vinyl LP New")).toBe(0);
    expect(productResearchRowMatchScore(enriched, "Example Artist Actual Album Orange Vinyl LP New")).toBe(0);
    expect(researchVariants(enriched)).toEqual(["Example Artist Actual Album"]);
  });
  it("uses the same pressing for active competition without narrowing the album search query", () => {
    const enriched = { ...candidate, ...shopifyIdentity(product, variant, source) };
    const profile = buildActiveSearchProfile(enriched)!;
    expect(profile.primary).toBe("Example Artist Actual Album");
    expect(profile.edition.colors).toEqual(expect.arrayContaining(["green", "violet"]));
    expect(matchActiveListing("Example Artist Actual Album Green Violet Swirl Vinyl LP New", profile).matched).toBe(true);
    expect(matchActiveListing("Example Artist Actual Album Vinyl LP New", profile).matched).toBe(false);
  });
  it("retains the confirmed pressing during the final stock and currency check", async () => {
    const result = await verifyRetailOffer(candidate, async (url: string) => url.endsWith("/cart.js") ? { currency: "USD" } : product);
    expect(result).toMatchObject({ purchasePrice: 9.99, retailEditionText: "Green & Violet Swirl LP", retailVerification: { status: "verified" } });
  });
  it("keeps an unrecognized named color out of generic black-vinyl comparisons", () => {
    const named = { ...candidate, identityStatus: "resolved" as const, retailEditionText: "Strawberry Cough LP" };
    const title = "Example Artist Actual Album New Vinyl LP";
    expect(productResearchRowMatchScore(named, title)).toBe(0);
    expect(matchActiveListing(title, buildActiveSearchProfile(named)!).matched).toBe(false);
  });
  it("does not keep a previously calculated resale price after the pressing changes", () => {
    const previous = { ...candidate, averageSoldPrice: 80, averageSoldShipping: 0, conservativeResalePrice: 80, totalSoldCount: 12, ebayResearchRows: [{ title: "Example Artist Actual Album New LP", avgSoldPrice: 80, avgShipping: 0, totalSold: 12 }], soldEvidence: { status: "validated", source: "ebay-product-research", condition: "new_sealed", conservativeResalePrice: 80, unitsSold90Days: 12, capturedAt: candidate.capturedAt } };
    const result = evaluateOpportunity({ ...candidate, ...resetPressingSoldEvidence(previous) }, {}, candidate.capturedAt);
    expect(result.conservativeResalePrice).toBeNull();
    expect(result.gates.soldEvidence).toBe(false);
    expect(result.decision).not.toBe("BUY");
  });
});
