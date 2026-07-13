import { describe, expect, it } from "vitest";
import { buildNewVinylResearchUrl, buildResearchKeywordVariants, buildResearchKeywords, normalizeResearchTitle } from "../lib/arbitrage/normalizeResearch";

describe("arbitrage research normalization", () => {
  it("removes retail and soundtrack noise from soundtrack listings", () => {
    expect(normalizeResearchTitle("Top Gun OST Original Motion Picture Soundtrack Music On Vinyl Was/EA")).toBe("Top Gun OST");
    expect(normalizeResearchTitle("$13.99 | Top Gun (Original Motion Picture Soundtrack) (Vinyl) at Amazon")).toBe("Top Gun");
    expect(buildResearchKeywords("", "Dirty Dancing Soundtrack (Walmart )")).toBe("Dirty Dancing");
    expect(buildResearchKeywordVariants("", "Dirty Dancing Soundtrack (Walmart )")).toEqual([
      "Dirty Dancing",
      "Dirty Dancing Soundtrack",
      "Dirty Dancing OST",
    ]);
  });

  it("builds concise artist and album keywords", () => {
    expect(buildResearchKeywords("Public Enemy", "It Takes A Nation Of Millions To Hold Us Back 2LP Limited Red Vinyl")).toBe(
      "Public Enemy It Takes A Nation Of Millions To Hold Us Back",
    );
    expect(buildResearchKeywords("Def Jam | Official Store", "Justin Bieber: My World")).toBe("Justin Bieber My World");
    expect(buildResearchKeywords("Garth Brooks", "Fresh Horses - Music & Performance - Was /ea")).toBe("Garth Brooks Fresh Horses");
  });

  it("builds new vinyl eBay Product Research links", () => {
    const url = new URL(buildNewVinylResearchUrl("Simon & Garfunkel", "Bookends"));

    expect(url.searchParams.get("keywords")).toBe("Simon & Garfunkel Bookends");
    expect(url.searchParams.get("dayRange")).toBe("1095");
    expect(url.searchParams.get("categoryId")).toBe("176985");
    expect(url.searchParams.get("conditionId")).toBe("1000");
    expect(url.searchParams.get("sorting")).toBe("-itemssold");
    expect(url.searchParams.get("tabName")).toBe("SOLD");
  });
});
