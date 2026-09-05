import { describe, expect, it } from "vitest";
import {
  retailEligibility,
  shopifyIdentity,
} from "../../scripts/lib/retailIdentity.mjs";
import { verifyRetailOffer } from "../../scripts/lib/retailOfferVerification.mjs";
import {
  buildSoldResearchQueryVariants,
  normalizeResearchTitle,
} from "../lib/arbitrage/soldResearchLinks.mjs";
import { buildProductResearchPlan } from "../../scripts/lib/productResearchCuration.mjs";

describe("vinyl-only research and release queries", () => {
  const mixedProduct = {
    title: "Artist - Release (CD / Vinyl)",
    vendor: "Artist",
    product_type: "CD / Vinyl",
    tags: ["Vinyl", "CD", "Cassette"],
  };

  it("rejects a non-vinyl selected SKU regardless of a vinyl parent or legacy format flag", () => {
    for (const variant of [
      "CD",
      "2CD",
      "Compact Disc",
      "Cassette",
      "SACD",
      "Vinyl + CD bundle",
    ]) {
      expect(
        retailEligibility({
          sourceListingTitle: "Artist - Release Vinyl LP",
          shopifyVariantTitle: variant,
          physicalFormatConfirmed: true,
          recordFormat: "LP",
        }),
      ).toEqual({ eligible: false, reason: "non_vinyl_format" });
      expect(
        shopifyIdentity(mixedProduct, { title: variant })
          .physicalFormatConfirmed,
      ).toBe(false);
    }
  });

  it("retains explicit vinyl variants from mixed-format parents and rejects ambiguous defaults", () => {
    for (const variant of ["LP", "2xLP", "Blue Vinyl", '7"', "10-inch"]) {
      const identity = shopifyIdentity(mixedProduct, { title: variant });
      expect(identity.physicalFormatConfirmed).toBe(true);
      expect(
        retailEligibility({
          ...identity,
          sourceListingTitle: mixedProduct.title,
          shopifyVariantTitle: variant,
        }).eligible,
      ).toBe(true);
    }
    expect(
      shopifyIdentity(mixedProduct, { title: "Default Title" })
        .physicalFormatConfirmed,
    ).toBe(false);
    expect(
      shopifyIdentity({
        title: "Artist - Release Box Set",
        product_type: "Box Set",
      }).physicalFormatConfirmed,
    ).toBe(false);
  });

  it("removes retained CD and cassette offers before a research plan is generated", () => {
    const finds = ["CD", "Cassette", "LP"].map((format) => ({
      artist: "Artist",
      title: "Release",
      id: format,
      recordFormat: format,
      purchasePrice: 10,
      sourceListingTitle: `Artist - Release ${format}`,
      physicalFormatConfirmed: true,
    }));
    expect(
      buildProductResearchPlan(finds).map((entry: any) => entry.findId),
    ).toEqual(["LP"]);
  });

  it("does not interpret an album named Tapes as a cassette format", () => {
    const find = {
      artist: "John Coltrane",
      title: "The Tiberi Tapes: A Preview Of The Mythic Recordings - RSD 2026",
      sourceListingTitle: "John Coltrane - The Tiberi Tapes: A Preview Of The Mythic Recordings - RSD 2026 LP",
      physicalFormatConfirmed: true,
      recordFormat: "vinyl",
    };
    expect(retailEligibility(find).eligible).toBe(true);
    expect(retailEligibility({ ...find, shopifyVariantTitle: "Tapes" }).eligible).toBe(false);
    for (const format of ["CD", "Cassette", "Audio Tape", "Tape", "2 Tapes"]) {
      expect(retailEligibility({ ...find, sourceListingTitle: `${find.title} ${format}` }).eligible).toBe(false);
    }
  });

  it("removes trailing Record Store Day merchandising while retaining release subtitles", () => {
    for (const suffix of [" - RSD 2026", " - RSD Black Friday 2025", " - Record Store Day 2026", " – Record Store Day Black Friday 2025", " (RSD 2026)", " - RSD 2026 LP"]) {
      expect(buildSoldResearchQueryVariants({ artist: "John Prine", title: `BBC Sessions${suffix}` })[0].query).toBe("John Prine BBC Sessions");
    }
    expect(buildSoldResearchQueryVariants({ artist: "John Coltrane", title: "The Tiberi Tapes: A Preview Of The Mythic Recordings - RSD 2026" })[0].query).toBe("John Coltrane The Tiberi Tapes A Preview Of The Mythic Recordings");
    expect(buildSoldResearchQueryVariants({ artist: "Joni Mitchell", title: "Rolling Thunder Revue Live - RSD Black Friday 2025" })[0].query).toBe("Joni Mitchell Rolling Thunder Revue Live");
    expect(normalizeResearchTitle("RSD")).toBe("RSD");
    expect(normalizeResearchTitle("Black Friday")).toBe("Black Friday");
  });

  it("fails retailer revalidation when a saved vinyl SKU has become a CD", async () => {
    const result: any = await verifyRetailOffer(
      {
        artist: "Artist",
        title: "Release",
        sourceUrl: "https://store.example/products/artist-release",
        sourceCurrency: "USD",
        sourceListingTitle: "Artist - Release Vinyl",
        shopifyVariantId: 5,
      },
      async () => ({
        handle: "artist-release",
        title: "Artist - Release Vinyl",
        vendor: "Artist",
        product_type: "Vinyl",
        variants: [
          {
            id: 5,
            title: "CD",
            available: true,
            requires_shipping: true,
            price: 999,
          },
        ],
      }),
    );
    expect(result.retailVerification).toMatchObject({
      status: "unavailable",
      reason: "non_vinyl_format",
    });
  });

  it("repairs the reported split-release query without adding pressing terms", () => {
    const raw = 'Daytrader / The Jealous Sound - Split - Tan 7" Vinyl';
    const identity = shopifyIdentity({
      title: raw,
      vendor: "Daytrader",
      product_type: "Vinyl",
    });
    expect(identity).toMatchObject({
      artist: "Daytrader / The Jealous Sound",
      title: "Split",
      identityStatus: "resolved",
    });
    for (const candidate of [identity, { artist: "Daytrader", title: raw }]) {
      expect(
        buildSoldResearchQueryVariants({
          ...candidate,
          sourceListingTitle: raw,
          barcode: "012345678905",
        }),
      ).toEqual([
        {
          kind: "base",
          identitySignals: [],
          query: "Daytrader / The Jealous Sound Split",
        },
      ]);
    }
  });

  it("preserves album words and subtitles that overlap merchandising vocabulary", () => {
    for (const title of [
      "Blue",
      "Red",
      "New",
      "The New Abnormal",
      "The White Album",
      "The Record",
      "EP",
      "1989",
      "Scary Monsters (And Super Creeps)",
    ]) {
      const expected = title.replace(/[()]/g, "");
      expect(normalizeResearchTitle(`${title} Vinyl LP`)).toBe(expected);
      expect(
        buildSoldResearchQueryVariants({
          artist: "Artist",
          title: `Artist - ${title} Vinyl LP`,
        })[0].query,
      ).toBe(`Artist ${expected}`);
    }
    expect(
      normalizeResearchTitle("[What's The Story] Morning Glory Vinyl LP"),
    ).toBe("What's The Story Morning Glory");
    expect(
      normalizeResearchTitle("Seven More Songs - Clear 7-inch Vinyl"),
    ).toBe("Seven More Songs");
  });

  it("does not lose non-English names or invent self-titled keywords", () => {
    expect(
      buildSoldResearchQueryVariants({
        artist: "Björk",
        title: "Debut - Limited Pink Vinyl LP",
      })[0].query,
    ).toBe("Björk Debut");
    expect(
      buildSoldResearchQueryVariants({
        artist: "林俊傑",
        title: "新地球 Vinyl LP",
      })[0].query,
    ).toBe("林俊傑 新地球");
    expect(
      buildSoldResearchQueryVariants({
        artist: "Lionel Richie",
        title: "Lionel Richie Vinyl LP",
      })[0].query,
    ).toBe("Lionel Richie");
  });

  it("uses retailer artist metadata when the apparent artist is an album with a format suffix", () => {
    const chapel = shopifyIdentity({
      title: "Sunday Brunch LP - Egg Picture Disc Vinyl LP",
      vendor: "CHAPEL",
      type: "Vinyl LP",
    });
    expect(chapel).toMatchObject({
      artist: "CHAPEL",
      title: "Sunday Brunch LP",
    });
    expect(buildSoldResearchQueryVariants(chapel)[0].query).toBe(
      "CHAPEL Sunday Brunch",
    );
    const chvrches = shopifyIdentity({
      title:
        "Screen Violence Alternate Artwork O-Card Vinyl: How Not To Drown Edition",
      vendor: "Chvrches",
      type: "Vinyl LP",
    });
    expect(chvrches.artist).toBe("Chvrches");
    expect(buildSoldResearchQueryVariants(chvrches)[0].query).toBe(
      "Chvrches Screen Violence",
    );
    expect(
      buildSoldResearchQueryVariants({
        artist: "Herbie Hancock",
        title: "Maiden Voyage (Blue Note Essential Vinyl Series) LP",
      })[0].query,
    ).toBe("Herbie Hancock Maiden Voyage");
  });

  it("does not substitute a distributor's issuing-label vendor for the artist", () => {
    const product = {
      title: "Demons (LITA Exclusive Variant)",
      vendor: "Enjoy the Ride",
      type: "Album",
      tags: ["Enjoy the Ride", "Get Scared", "Rock", "On Sale"],
    };
    const variant = { title: "LP Color (LITA Exclusive Variant)" };
    expect(
      shopifyIdentity(product, variant, { id: "light-in-the-attic" }),
    ).toMatchObject({ artist: "Unknown Artist", identityStatus: "unresolved" });
    expect(
      shopifyIdentity(
        { ...product, tags: [...product.tags, "artist: Get Scared"] },
        variant,
        { sourceId: "light-in-the-attic" },
      ),
    ).toMatchObject({ artist: "Get Scared", identityStatus: "resolved" });
  });

  it("keeps named pressing colors out of album and artist identity", () => {
    const identity = shopifyIdentity({ title: "Bayou Country - Tangerine LP", vendor: "Creedence Clearwater Revival", type: "Vinyl LP" });
    expect(identity).toMatchObject({ artist: "Creedence Clearwater Revival", title: "Bayou Country" });
    expect(buildSoldResearchQueryVariants(identity)[0].query).toBe("Creedence Clearwater Revival Bayou Country");
  });

  it("preserves edition boundaries until artist-prefixed Thrice listings are normalized", () => {
    const sourceListingTitle = "Thrice - Identity Crisis (25th Anniversary Edition) LP - Ghostly Blue";
    for (const title of ["Identity Crisis (25th Anniversary Edition)", sourceListingTitle]) {
      expect(buildSoldResearchQueryVariants({ artist: "Thrice", title, sourceListingTitle })[0].query).toBe("Thrice Identity Crisis");
    }
    expect(buildSoldResearchQueryVariants({ artist: "Artist", title: "Artist - A Real Album (Custom Exclusive Variant)" })[0].query).toBe("Artist A Real Album");
    expect(normalizeResearchTitle("Ghostly")).toBe("Ghostly");
  });

  it("keeps Gábor Szabó intact and removes the named Verve Vault merchandising series", () => {
    const candidate = { id: "gabor-spellbinder", artist: "Gábor Szabó", title: "Spellbinder (Verve Vault Series) LP", sourceListingTitle: "Spellbinder (Verve Vault Series) LP", purchasePrice: 15 };
    expect(buildSoldResearchQueryVariants(candidate)[0].query).toBe("Gábor Szabó Spellbinder");
    expect(buildProductResearchPlan([candidate])[0].variants[0].query).toBe("Gábor Szabó Spellbinder");
    expect(normalizeResearchTitle("Spellbinder Verve Vault Series LP")).toBe("Spellbinder");
    expect(normalizeResearchTitle("Maiden Voyage (Blue Note Essentials Series) LP")).toBe("Maiden Voyage");
    expect(normalizeResearchTitle("The Series")).toBe("The Series");
    expect(normalizeResearchTitle("A Story (The Original Series)")).toBe("A Story The Original Series");
    expect(buildSoldResearchQueryVariants({ artist: "Artist", title: "Artist - A Real Album - Apple Red Vinyl LP" })[0].query).toBe("Artist A Real Album");
  });
});
