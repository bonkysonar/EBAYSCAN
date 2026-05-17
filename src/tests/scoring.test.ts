import { describe, expect, it } from "vitest";
import type { SearchInput } from "../lib/ebay/types";
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
