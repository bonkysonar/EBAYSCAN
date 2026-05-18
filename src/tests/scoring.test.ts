import { describe, expect, it } from "vitest";
import type { CandidateListing, SearchInput, SearchResult } from "../lib/ebay/types";
import { MockEbayClient } from "../lib/ebay/mockClient";
import { scoreRecord } from "../lib/scoring/scoreRecord";

async function decisionFor(input: SearchInput) {
  const client = new MockEbayClient();
  return scoreRecord(await client.search(input));
}

describe("scoreRecord", () => {
  it("scores obvious low-value records as RED skip", async () => {
    const decision = await decisionFor({ type: "barcode", barcode: "012345LOW" });
    expect(decision.decision).toBe("RED");
    expect(decision.priceSummary.trimmedMedianTotalPrice).toBeLessThanOrEqual(5);
  });

  it("scores obvious high-value records as GREEN keep/process", async () => {
    const decision = await decisionFor({ type: "manual", query: "blue note mono original" });
    expect(decision.decision).toBe("GREEN");
    expect(decision.priceSummary.medianTotalPrice).toBeGreaterThan(5);
  });

  it("scores ambiguous mixed results as YELLOW", async () => {
    const decision = await decisionFor({ type: "manual", query: "mixed ambiguous vinyl" });
    expect(decision.decision).toBe("YELLOW");
  });

  it("keeps overlapping catalog-number results YELLOW", async () => {
    const decision = await decisionFor({ type: "catalog", catalogNumber: "60296-1" });
    expect(decision.decision).toBe("YELLOW");
    expect(decision.priceSummary.sameTitleClusterCount).toBe(2);
  });

  it("prevents RED skip when risk keywords are found", async () => {
    const decision = await decisionFor({ type: "manual", query: "promo white label" });
    expect(decision.decision).toBe("YELLOW");
    expect(decision.reasons.join(" ")).toContain("Risk keywords");
  });

  it("uses the cheapest title-matching listings for low-end pricing and visible candidates", () => {
    const prices = [12, 3, 9, 1, 2, 4, 5, 6, 7, 8, 10, 11];
    const listings: CandidateListing[] = prices.map((price, index) => ({
      id: `boz-${index}`,
      title: `Boz Scaggs Slow Dancer vinyl LP copy ${index}`,
      price,
      shippingPrice: 0,
      totalPrice: price,
      currency: "USD",
      condition: "Used",
      source: "ebay-mock",
      matchSignals: { sameAlbumCluster: "boz-scaggs-slow-dancer", titleSimilarity: 0.9 },
    }));
    const result: SearchResult = {
      input: { type: "manual", query: "BOZ SCAGGS Slow Dancer" },
      listings,
      source: "ebay-mock",
      timestamp: new Date().toISOString(),
      warnings: [],
    };

    const decision = scoreRecord(result);

    expect(decision.priceSummary.averageCheapestTenTotalPrice).toBe(5.5);
    expect(decision.priceSummary.relevantResultCount).toBe(12);
    expect(decision.topListings[0].totalPrice).toBe(1);
  });

  it("greens records when the average cheapest comparable listings are above threshold", () => {
    const listings: CandidateListing[] = [6, 6.5, 7, 8].map((price, index) => ({
      id: `ecm-${index}`,
      title: index === 0 ? "Pat Metheny Group Offramp ECM 1216 LP" : `Offramp Pat Metheny ECM 1216 vinyl ${index}`,
      price,
      shippingPrice: 0,
      totalPrice: price,
      currency: "USD",
      condition: "Used",
      source: "ebay-mock",
      matchSignals: { sameAlbumCluster: index === 0 ? "pat-metheny-offramp" : "offramp-pat-metheny", titleSimilarity: 0.8 },
    }));
    const result: SearchResult = {
      input: { type: "catalog", catalogNumber: "ECM 1 1216" },
      listings,
      source: "ebay-mock",
      timestamp: new Date().toISOString(),
      warnings: [],
    };

    const decision = scoreRecord(result);

    expect(decision.decision).toBe("GREEN");
    expect(decision.priceSummary.averageCheapestTenTotalPrice).toBeGreaterThan(5);
  });

  it("uses the same marketplace interface for barcode, catalog, manual, and image inputs", async () => {
    const client = new MockEbayClient();
    const barcode = await client.search({ type: "barcode", barcode: "012345LOW" });
    const catalog = await client.search({ type: "catalog", catalogNumber: "60296-1" });
    const manual = await client.search({ type: "manual", query: "fleetwood mac rumors common" });
    const image = await client.search({ type: "image", imageBase64: "data:image/png;base64,test", fileName: "cover.png" });

    expect(barcode.source).toBe("ebay-mock");
    expect(catalog.source).toBe("ebay-mock");
    expect(manual.source).toBe("ebay-mock");
    expect(image.source).toBe("ebay-mock");
    expect(image.warnings[0]).toContain("placeholder");
  });
});
