import { describe, expect, it } from "vitest";
import {
  activeSearchKey,
  buildActiveSearchProfile,
  extractEditionIdentity,
  matchActiveListing,
} from "../lib/arbitrage/activeEbayMatching.mjs";
import type { ArbitrageFind } from "../lib/arbitrage/types";

function findFor(title: string): ArbitrageFind {
  return {
    artist: "Unknown Artist",
    capturedAt: "2026-07-15T00:00:00.000Z",
    condition: "new/sealed",
    id: title,
    purchasePrice: 12.9,
    sourceId: "test",
    sourceListingTitle: title,
    sourceName: "Test",
    sourceUrl: "https://example.test",
    title,
  };
}

describe("active eBay edition matching", () => {
  it("preserves source edition identity in the queue key", () => {
    const blue = findFor("Artist - Great Escape (Sea Blue Smoke Vinyl LP)");
    const red = findFor("Artist - Great Escape (Red Smoke Vinyl LP)");

    expect(activeSearchKey(blue)).not.toBe(activeSearchKey(red));
    expect(buildActiveSearchProfile(blue)?.edition).toMatchObject({
      colors: expect.arrayContaining(["blue", "sea blue", "smoke"]),
      key: expect.stringContaining("colors="),
    });
  });

  it("counts only a title, artist, format, and color-matched pressing", () => {
    const profile = buildActiveSearchProfile(findFor("Artist - Great Escape (Sea Blue Smoke Vinyl 2LP)"));
    expect(profile).not.toBeNull();

    const exact = matchActiveListing("Artist Great Escape SEA BLUE SMOKE 2LP Vinyl New Sealed", profile!);
    const wrongColor = matchActiveListing("Artist Great Escape RED SMOKE 2LP Vinyl New Sealed", profile!);
    const missingDisc = matchActiveListing("Artist Great Escape SEA BLUE SMOKE LP Vinyl New Sealed", profile!);
    const wrongProduct = matchActiveListing("Artist Great Escape Sea Blue Smoke 2CD Deluxe", profile!);

    expect(exact).toMatchObject({ confidence: "high", matched: true });
    expect(wrongColor.matched).toBe(false);
    expect(wrongColor.reasons).toContain("edition-color-conflict");
    expect(missingDisc.matched).toBe(false);
    expect(missingDisc.reasons).toContain("edition-format-missing");
    expect(wrongProduct.reasons).toContain("blocked-product-type");
  });

  it("does not count a special pressing as the standard edition", () => {
    const standard = buildActiveSearchProfile(findFor("Artist - Great Escape Vinyl LP"));
    expect(matchActiveListing("Artist Great Escape Signed Red Vinyl LP", standard!).matched).toBe(false);
    expect(matchActiveListing("Artist Great Escape Vinyl LP New Sealed", standard!).matched).toBe(true);
  });

  it("requires texture signals such as swirl to match the source pressing", () => {
    const swirl = buildActiveSearchProfile(findFor("Artist - Great Escape (Platinum Swirl Vinyl LP)"))!;
    expect(matchActiveListing("Artist Great Escape Platinum Swirl Vinyl LP", swirl).matched).toBe(true);
    expect(matchActiveListing("Artist Great Escape Platinum Vinyl LP", swirl).reasons).toContain("edition-signal-missing:swirl");
  });

  it("extracts retailer-exclusive and signed identity", () => {
    expect(extractEditionIdentity("Target Exclusive signed red vinyl LP")).toMatchObject({
      retailerExclusive: "target",
      signals: expect.arrayContaining(["signed"]),
    });
  });

  it("keeps dash and quoted source separators when inferring artist and title", () => {
    expect(buildActiveSearchProfile(findFor("Cave In – Final Transmission Vinyl LP"))).toMatchObject({
      artist: "Cave In",
      primary: "Cave In Final Transmission Vinyl LP",
      title: "Final Transmission",
    });
    expect(buildActiveSearchProfile(findFor('Anthony Ramos “Love And Lies” (Black/Platinum Swirl Vinyl LP)'))).toMatchObject({
      artist: "Anthony Ramos",
      title: "Love And Lies",
      primary: expect.stringContaining("Platinum Swirl"),
    });
  });

  it("matches Sam & Dave listings with mojibake apostrophes", () => {
    const profile = buildActiveSearchProfile(
      findFor("Sam & Dave - Hold On, I'm Comin' Vinyl LP"),
    );
    const mojibakeTitle =
      "Sam & Dave Hold On I\u00e2\u20ac\u2122m Comin\u00e2\u20ac\u2122 [New Vinyl LP]";

    expect(profile).not.toBeNull();
    expect(matchActiveListing(mojibakeTitle, profile!)).toMatchObject({
      confidence: "high",
      matched: true,
    });
  });

  it("skips navigation and obvious non-record product rows before spending API quota", () => {
    expect(buildActiveSearchProfile(findFor("Sign In and Earn Rewards"))).toBeNull();
    expect(buildActiveSearchProfile(findFor("Clearance Handbags Trend Shoulder Bag Purse $10.39 Was $11.59"))).toBeNull();
  });

  it("keeps release numbers while removing deal prices", () => {
    expect(buildActiveSearchProfile(findFor("Stranger Things 5 Soundtrack Vinyl $12.90 + Free Shipping"))).toMatchObject({
      title: expect.stringContaining("5"),
    });
  });

  it("removes general-retailer taxonomy from active-search queries", () => {
    expect(
      buildActiveSearchProfile(
        findFor(
          "Creedence Clearwater Revival - At The Royal Albert Hall - Music & Performance - Vinyl $17.26 Was $25.98 $26.55/ea",
        ),
      ),
    ).toMatchObject({
      artist: "Creedence Clearwater Revival",
      primary: "Creedence Clearwater Revival At The Royal Albert Hall Vinyl",
      title: "At The Royal Albert Hall",
    });

    expect(
      buildActiveSearchProfile(
        findFor(
          "Overall pick Michael Jackson - Thriller - Music & Performance - Vinyl $19.97 $27.36/ea",
        ),
      ),
    ).toMatchObject({
      artist: "Michael Jackson",
      title: "Thriller",
    });
  });

  it("does not confuse a color in the release title with the vinyl edition", () => {
    const standard = buildActiveSearchProfile(findFor("Prince - Purple Rain Vinyl LP"))!;
    expect(standard.edition.colors).toEqual([]);
    expect(matchActiveListing("Prince Purple Rain Red Vinyl LP", standard).matched).toBe(false);

    const purpleEdition = buildActiveSearchProfile(findFor("Prince - Purple Rain Purple Vinyl LP"))!;
    expect(purpleEdition.edition.colors).toContain("purple");
  });

  it("uses an explicit Shopify 2xLP variant despite mixed CD product taxonomy", () => {
    const profile = buildActiveSearchProfile({
      ...findFor("Artist - Double Album (CD / Vinyl) - 2xLP"),
      artist: "Artist",
      shopifyVariantTitle: "2xLP",
      title: "Double Album",
    });

    expect(profile).toMatchObject({
      artist: "Artist",
      edition: { format: "2lp" },
      title: "Double",
    });
    expect(profile?.primary).not.toMatch(/\bcd\b/i);
    expect(matchActiveListing("Artist Double Album Vinyl 2LP New Sealed", profile!)).toMatchObject({
      confidence: "high",
      matched: true,
    });
  });

  it("keeps Shopify variant color in edition identity instead of the release title", () => {
    const profile = buildActiveSearchProfile({
      ...findFor("Artist - Double Album (CD / Vinyl) - Blue 2xLP"),
      artist: "Artist",
      shopifyVariantTitle: "Blue 2xLP",
      title: "Double Album",
    });

    expect(profile).toMatchObject({
      edition: {
        colors: expect.arrayContaining(["blue"]),
        format: "2lp",
      },
      title: "Double",
    });
    expect(matchActiveListing("Artist Double Album Blue Vinyl 2LP New Sealed", profile!)).toMatchObject({
      confidence: "high",
      matched: true,
    });
  });

  it("normalizes a hyphenated Shopify 2-LP variant to the same active format", () => {
    const profile = buildActiveSearchProfile({
      ...findFor("Artist - Double Album (CD / Vinyl) - 2-LP"),
      artist: "Artist",
      shopifyVariantTitle: "2-LP",
      title: "Double Album",
    });

    expect(profile).toMatchObject({
      edition: { format: "2lp" },
      title: "Double",
    });
    expect(matchActiveListing("Artist Double Album Vinyl 2LP New Sealed", profile!)).toMatchObject({
      confidence: "high",
      matched: true,
    });
  });
});
