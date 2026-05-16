import { describe, expect, it } from "vitest";
import { extractConsensus } from "../lib/normalization/extractConsensus";
import { normalizePrice, totalPrice } from "../lib/normalization/normalizePrice";
import { normalizeTitle } from "../lib/normalization/normalizeTitle";
import { ebaySearchExamples } from "../fixtures/ebaySearchExamples";

describe("normalization", () => {
  it("normalizes prices from strings and numbers", () => {
    expect(normalizePrice("$12.50")).toBe(12.5);
    expect(normalizePrice(4)).toBe(4);
    expect(normalizePrice("free")).toBeNull();
    expect(totalPrice("$3.00", "$2.50")).toBe(5.5);
  });

  it("normalizes titles for comparison", () => {
    expect(normalizeTitle("The FLEETWOOD MAC - Rumours LP Vinyl Record")).toBe("fleetwood mac rumours");
  });

  it("extracts a consensus cluster", () => {
    const consensus = extractConsensus(ebaySearchExamples.lowValueListings);
    expect(consensus.clusterKey).toBe("fleetwood-mac-rumours");
    expect(consensus.clusterCount).toBe(5);
    expect(consensus.clusterRatio).toBe(1);
  });
});
