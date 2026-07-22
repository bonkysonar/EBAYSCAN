import { describe, expect, it } from "vitest";
import {
  buildProductResearchPlan,
  curateResearchForFind,
  productResearchRowMatchScore,
  researchVariants,
} from "../../scripts/lib/productResearchCuration.mjs";

const find = {
  artist: "Mother Love Bone",
  capturedAt: "2026-07-15T13:24:03.348Z",
  id: "find-mother-love-bone",
  purchasePrice: 13,
  sourceId: "slickdeals-vinyl-records",
  sourceListingTitle: "Mother Love Bone - Shine (180 Gram Vinyl) $13",
  title: "Shine",
};

describe("generic Product Research curation", () => {
  it("builds a stable find-id research plan without a title allowlist", () => {
    expect(buildProductResearchPlan([find])).toEqual([
      expect.objectContaining({
        findId: "find-mother-love-bone",
        variants: [
          expect.objectContaining({
            query: "Mother Love Bone Shine",
          }),
        ],
      }),
    ]);
  });

  it("removes numeric LP format text from research queries", () => {
    expect(
      researchVariants({
        artist: "The Beach Boys",
        purchasePrice: 11.99,
        sourceListingTitle: "Surf's Up 1LP",
        title: "Surf's Up 1LP",
      }),
    ).toContain("The Beach Boys Surf's Up");
  });

  it("matches legacy raw research keys and keeps aggregate-row velocity unknown", () => {
    const raw = {
      "mother-love-bone-shine": [
        {
          query: "Mother Love Bone Shine",
          url: "https://www.ebay.com/sh/research?keywords=Mother+Love+Bone+Shine",
          rows: [
            {
              title: "Mother Love Bone - Shine [New Vinyl LP] 180 Gram",
              cells: ["", "", "$22.00", "$4.00", "4", "$88.00", "", "Jul 12, 2026"],
            },
            {
              title: "Mother Love Bone Shine New Vinyl LP",
              cells: ["", "", "$24.00", "$0.00", "1", "$24.00", "", "Jun 10, 2026"],
            },
          ],
        },
      ],
    };

    expect(curateResearchForFind(find, raw, new Date("2026-07-15T15:00:00Z"))).toMatchObject({
      averageSoldPrice: 22.4,
      averageSoldShipping: 3.2,
      latestSoldDate: "2026-07-12",
      oneSellerSoldCount: 4,
      sales30Days: null,
      sales90Days: null,
      status: "validated",
      totalSoldCount: 5,
      velocityStatus: "unknown_from_aggregate_rows",
    });
  });

  it("keeps an exact empty find entry from borrowing a fuzzy neighbor's sales", () => {
    const amalgamutFind = {
      artist: "The Amalgamut",
      id: "scan-amalgamut",
      purchasePrice: 29.99,
      sourceListingTitle: "The Amalgamut - 20th Anniversary Edition (2-LP)",
      title: "20th Anniversary (2-LP)",
    };
    const raw = {
      entries: [
        {
          findId: "scan-amalgamut",
          runs: [
            {
              query: "The Amalgamut 20th Anniversary Edition",
              rows: [],
            },
          ],
        },
        {
          findId: "scan-fallen",
          runs: [
            {
              query: "Fallen 20th Anniversary Edition Deluxe Limited Edition",
              rows: [
                {
                  href: "https://www.ebay.com/itm/111111111111",
                  title:
                    "Evanescence - Fallen 20th Anniversary 2 LP Blue Smoke Vinyl Target Ex New Sealed",
                  cells: ["", "", "$30.95", "$5.99", "2", "$61.90", "", "Jul 4, 2026"],
                },
                {
                  href: "https://www.ebay.com/itm/222222222222",
                  title:
                    "LIMITED EDITION-Evanescence FALLEN 20th Anniversary SUPER DELUXE EDITION BOXSET",
                  cells: ["", "", "$600.00", "$0.00", "1", "$600.00", "", "Jun 25, 2026"],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(curateResearchForFind(amalgamutFind, raw, new Date("2026-07-16T15:00:00Z"))).toMatchObject({
      query: "The Amalgamut 20th Anniversary Edition",
      rows: [],
      status: "no_rows",
      totalSoldCount: 0,
    });
    expect(
      productResearchRowMatchScore(
        amalgamutFind,
        "Evanescence - Fallen 20th Anniversary 2 LP Blue Smoke Vinyl New Sealed",
      ),
    ).toBe(0);
  });

  it("rejects box-set and multi-LP evidence for an ordinary LP", () => {
    const ordinaryLp = {
      artist: "Example Artist",
      sourceListingTitle: "Example Artist - Evergreen Album (Vinyl LP)",
      title: "Evergreen Album",
    };

    expect(
      productResearchRowMatchScore(
        ordinaryLp,
        "Example Artist Evergreen Album New Vinyl LP",
      ),
    ).toBeGreaterThan(0.68);
    expect(
      productResearchRowMatchScore(
        ordinaryLp,
        "Example Artist Evergreen Album Super Deluxe Box Set New Sealed",
      ),
    ).toBe(0);
    expect(
      productResearchRowMatchScore(
        ordinaryLp,
        "Example Artist Evergreen Album 2LP Vinyl New Sealed",
      ),
    ).toBe(0);
  });

  it("retains safe dated single-unit rows as recent-sale window counts", () => {
    const samAndDave = {
      artist: "Sam & Dave",
      id: "scan-sam-and-dave",
      purchasePrice: 18.3,
      sourceListingTitle: "Sam & Dave - Hold On, I'm Comin' (Vinyl LP)",
      title: "Hold On, I'm Comin'",
    };
    const raw = {
      "scan-sam-and-dave": [
        {
          query: "Sam & Dave Hold On I'm Comin'",
          url: "https://www.ebay.com/sh/research?limit=50",
          rows: [
            {
              href: "https://www.ebay.com/itm/111111111111",
              title: "Sam & Dave - Hold On, I'm Comin' [New Vinyl LP]",
              cells: ["", "", "$23.51", "$5.13", "1", "$23.51", "", "Jul 12, 2026"],
            },
            {
              href: "https://www.ebay.com/itm/222222222222",
              title: "Sam & Dave - Hold On, I'm Comin' [New Vinyl LP]",
              cells: ["", "", "$31.98", "$3.99", "1", "$31.98", "", "Jul 8, 2026"],
            },
          ],
        },
      ],
    };

    expect(curateResearchForFind(samAndDave, raw, new Date("2026-07-16T15:00:00Z"))).toMatchObject({
      aggregatePeriodDays: 1095,
      aggregateUnitsSold: 2,
      sales30Days: 2,
      sales90Days: 2,
      sales365Days: 2,
      status: "validated",
      totalSoldCount: 2,
      velocityStatus: "dated_single_unit_rows",
    });
  });

  it("labels exact aggregate totals as long-window evidence without claiming dated velocity", () => {
    const raw = {
      [find.id]: [
        {
          query: "Mother Love Bone Shine",
          rows: [
            {
              href: "https://www.ebay.com/itm/111111111111",
              title: "Mother Love Bone - Shine [New Vinyl LP] 180 Gram",
              cells: ["", "", "$22.00", "$4.00", "4", "$88.00", "", "Jul 12, 2026"],
            },
          ],
        },
      ],
    };

    expect(curateResearchForFind(find, raw, new Date("2026-07-15T15:00:00Z"))).toMatchObject({
      aggregatePeriodDays: 1095,
      aggregateUnitsSold: 4,
      sales30Days: null,
      sales90Days: null,
      sales365Days: null,
      totalSoldCount: 4,
      velocityStatus: "unknown_from_aggregate_rows",
    });
  });

  it("rejects non-record, damaged, and mismatched-title Product Research rows", () => {
    expect(productResearchRowMatchScore(find, "Mother Love Bone Shine New Vinyl LP")).toBeGreaterThan(0.68);
    expect(productResearchRowMatchScore(find, "Mother Love Bone Shine T-Shirt")).toBe(0);
    expect(productResearchRowMatchScore(find, "Mother Love Bone Shine Vinyl - Damaged Jacket")).toBe(0);
    expect(productResearchRowMatchScore(find, "Pearl Jam Ten New Vinyl LP")).toBe(0);
  });

  it("keeps unmatched candidates pending instead of converting them to rejects", () => {
    expect(curateResearchForFind(find, {}, new Date("2026-07-15T15:00:00Z"))).toMatchObject({
      rows: [],
      status: "pending",
    });
  });

  it("uses a self-titled fallback when the source only exposes an artist plus format descriptors", () => {
    expect(
      researchVariants({
        artist: "Lionel Richie",
        sourceListingTitle: "Lionel Richie: Limited Edition (180 Grams Vinyl LP Album)",
        title: "(180 Grams)",
      }),
    ).toContain("Lionel Richie self titled");
  });

  it("matches legacy research generically when the source parser could not identify the artist", () => {
    const noisyFind = {
      artist: "Unknown Artist",
      id: "find-anthony-ramos",
      purchasePrice: 5,
      sourceListingTitle:
        'Anthony Ramos "Love And Lies" (Black/Platinum Swirl Vinyl LP) $5 + Free Shipping w/ Prime',
      title: 'Anthony Ramos "Love And Lies" (Black/Platinum Swirl) + Free Shipping w/ Prime',
    };
    const raw = {
      "anthony-ramos-love-and-lies": [
        {
          query: "Anthony Ramos Love And Lies",
          rows: [
            {
              title: "Anthony Ramos - Love & Lies (LP, Signed, Limited Edition, Sealed)",
              cells: ["", "", "$26.99", "$0.00", "1", "$26.99", "", "Jul 9, 2026"],
            },
          ],
        },
      ],
    };

    expect(curateResearchForFind(noisyFind, raw, new Date("2026-07-15T15:00:00Z"))).toMatchObject({
      status: "no_rows",
      totalSoldCount: 0,
    });
  });
});
