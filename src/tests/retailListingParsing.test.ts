import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  inferRetailArtist,
  inferRetailTitle,
  parseRetailProductPrices,
} from "../../scripts/lib/retailListingParsing.mjs";

describe("generic retail listing parsing", () => {
  it("ignores unit prices while preserving current and previous product prices", () => {
    expect(
      parseRetailProductPrices(
        "Michael Jackson - This Is It - Vinyl $83.77 $26.68/lb",
      ),
    ).toEqual([83.77]);
    expect(
      parseRetailProductPrices(
        "Dirty Dancing Vinyl LP $19.97 Was $23.99 $34.43/ea",
      ),
    ).toEqual([19.97, 23.99]);
  });

  it("produces usable artist and title text from general-retailer cards", () => {
    expect(
      inferRetailArtist(
        "Various Artists - Guardians of the Galaxy: Awesome Mix 1 Soundtrack - Music & Performance - Vinyl $19.16",
      ),
    ).toBe("Various Artists");
    expect(
      inferRetailTitle(
        "Various Artists - Guardians of the Galaxy: Awesome Mix 1 Soundtrack - Music & Performance - Vinyl $19.16 $36.15/ea",
      ),
    ).toBe("Guardians of the Galaxy: Awesome Mix 1 Soundtrack");
    expect(
      inferRetailTitle(
        "Best seller Garth Brooks - Fresh Horses - Music & Performance - Vinyl [Exclusive] $12.91 $25.82/ea",
      ),
    ).toBe("Fresh Horses");
  });

  it("does not mistake a format hyphen for an artist separator", () => {
    const listing =
      "Best seller Dirty Dancing Soundtrack (Walmart Exclusive)-Vinyl LP (RCA) $19.97 Was $23.99 $34.43/ea";
    expect(inferRetailArtist(listing)).toBe("Unknown Artist");
    expect(inferRetailTitle(listing)).toBe("Dirty Dancing Soundtrack (RCA)");
  });

  it("parses quoted deal titles without mistaking a colon inside the album for the artist split", () => {
    const listing =
      'Sum 41 "All The Good Sh**: 14 Solid Gold Hits 2001-2008" (Vinyl LP) $16.78';
    expect(inferRetailArtist(listing)).toBe("Sum 41");
    expect(inferRetailTitle(listing)).toBe(
      "All The Good Sh**: 14 Solid Gold Hits 2001-2008",
    );
  });

  it("removes preorder badges before splitting the artist and title", () => {
    const listing =
      "[PRE-ORDER] Herbie Hancock - Maiden Voyage [Release Date: 07/17/2026]";
    expect(inferRetailArtist(listing)).toBe("Herbie Hancock");
    expect(inferRetailTitle(listing)).toBe("Maiden Voyage");
  });

  it("decodes numeric entities and escaped query separators", () => {
    expect(decodeHtmlEntities("Michael Jackson&#x27;s This Is It")).toBe(
      "Michael Jackson's This Is It",
    );
    expect(
      decodeHtmlEntities(
        "https://example.com/item?classType=REGULAR&amp;amp;from=/search",
      ),
    ).toBe("https://example.com/item?classType=REGULAR&from=/search");
  });
});
