import { describe, expect, it } from "vitest";
import { buildNewVinylResearchUrl, buildResearchKeywordVariants, buildResearchKeywords, normalizeResearchTitle } from "../lib/arbitrage/normalizeResearch";
import {
  buildEbayProductResearchUrl,
  buildEbayPublicSoldUrl,
  buildSoldResearchLinks,
  buildSoldResearchQueryVariants,
} from "../lib/arbitrage/soldResearchLinks.mjs";

describe("arbitrage research normalization", () => {
  it("removes retail and soundtrack noise from soundtrack listings", () => {
    expect(normalizeResearchTitle("Top Gun OST Original Motion Picture Soundtrack Music On Vinyl Was/EA")).toBe("Top Gun");
    expect(normalizeResearchTitle("$13.99 | Top Gun (Original Motion Picture Soundtrack) (Vinyl) at Amazon")).toBe("Top Gun");
    expect(buildResearchKeywords("", "Dirty Dancing Soundtrack (Walmart )")).toBe("Dirty Dancing");
    expect(buildResearchKeywordVariants("", "Dirty Dancing Soundtrack (Walmart )")).toEqual([
      "Dirty Dancing Soundtrack",
      "Dirty Dancing OST",
      "Dirty Dancing",
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

  it("builds exact, barcode, and broad release queries in that order", () => {
    const variants = buildSoldResearchQueryVariants({
      artist: "The Jimi Hendrix Experience",
      barcode: "0 12345-67890 5",
      ebayActiveEditionIdentity: {
        colors: ["yellow"],
        retailerExclusive: "walmart",
      },
      sourceListingTitle:
        "The Jimi Hendrix Experience - Are You Experienced (Walmart Exclusive) - Opaque Yellow Vinyl",
      title: "Are You Experienced - Opaque Yellow",
    });

    expect(variants).toEqual([
      {
        identitySignals: ["yellow", "walmart", "exclusive"],
        kind: "exact",
        query: "The Jimi Hendrix Experience Are You Experienced yellow walmart exclusive",
      },
      { identitySignals: ["012345678905"], kind: "barcode", query: "012345678905" },
      {
        identitySignals: [],
        kind: "base",
        query: "The Jimi Hendrix Experience Are You Experienced",
      },
    ]);
  });

  it("keeps release identity terms out of the broad fallback without losing them from exact research", () => {
    expect(
      buildSoldResearchQueryVariants({
        artist: "David Bowie",
        sourceListingTitle: "David Bowie - Scary Monsters (And Super Creeps) (2017 Remastered Version)",
        title: "Scary Monsters (And Super Creeps) (2017 Remastered Version)",
      }),
    ).toEqual([
      {
        identitySignals: ["2017", "remastered"],
        kind: "exact",
        query: "David Bowie Scary Monsters And Super Creeps 2017 remastered",
      },
      {
        identitySignals: [],
        kind: "base",
        query: "David Bowie Scary Monsters And Super Creeps",
      },
    ]);
    expect(buildResearchKeywords("Taylor Swift", "1989 Vinyl LP")).toBe("Taylor Swift 1989");
  });

  it("removes retailer taxonomy and never promotes an arbitrary SKU to an identifier query", () => {
    expect(
      buildSoldResearchQueryVariants({
        artist: "Chicago",
        barcode: "5D80F701934C4A1797F88B3E4CF58C7D",
        sourceListingTitle: "Chicago - Greatest Hits - Music & Performance - Vinyl",
        title: "Greatest Hits - Music & Performance - Vinyl",
      }),
    ).toEqual([
      { identitySignals: [], kind: "base", query: "Chicago Greatest Hits" },
    ]);
    expect(
      buildSoldResearchQueryVariants({
        artist: "The Weeknd",
        sourceListingTitle: "The Weeknd - Hurry Up Tomorrow - R&B - Vinyl LP - Parental Advisory Label",
        title: "Hurry Up Tomorrow - R&B - - Parental Advisory Label",
      }),
    ).toEqual([
      { identitySignals: [], kind: "base", query: "The Weeknd Hurry Up Tomorrow" },
    ]);
  });

  it("builds Product Research and public Sold plus Completed links from the same safely encoded query", () => {
    const query = "Simon & Garfunkel Bookends";
    const productUrl = new URL(buildEbayProductResearchUrl(query));
    const publicUrl = new URL(buildEbayPublicSoldUrl(query));

    expect(productUrl.origin).toBe("https://www.ebay.com");
    expect(productUrl.pathname).toBe("/sh/research");
    expect(productUrl.searchParams.get("keywords")).toBe(query);
    expect(productUrl.searchParams.get("dayRange")).toBe("1095");
    expect(productUrl.searchParams.get("conditionId")).toBe("1000");

    expect(publicUrl.origin).toBe("https://www.ebay.com");
    expect(publicUrl.pathname).toBe("/sch/i.html");
    expect(publicUrl.searchParams.get("_nkw")).toBe(query);
    expect(publicUrl.searchParams.get("_sacat")).toBe("176985");
    expect(publicUrl.searchParams.get("LH_Complete")).toBe("1");
    expect(publicUrl.searchParams.get("LH_Sold")).toBe("1");
    expect(publicUrl.searchParams.get("LH_ItemCondition")).toBe("1000");
  });

  it("derives both manual handoff links without trusting a persisted eBay URL", () => {
    const links = buildSoldResearchLinks({
      artist: "Chicago",
      sourceListingTitle: "Chicago - Greatest Hits - Music & Performance - Vinyl",
      title: "Greatest Hits - Music & Performance - Vinyl",
    });

    expect(links).toHaveLength(1);
    expect(links[0].query).toBe("Chicago Greatest Hits");
    expect(new URL(links[0].productResearchUrl).searchParams.get("keywords")).toBe("Chicago Greatest Hits");
    expect(new URL(links[0].publicSoldUrl).searchParams.get("_nkw")).toBe("Chicago Greatest Hits");
  });
});
