import { describe, expect, it } from "vitest";
import {
  createAlbumDemandIndex,
  ownSaleMatchesAlbum,
  researchDemand,
} from "../../scripts/lib/albumDemand.mjs";
import { selectResearchCandidates } from "../../scripts/lib/candidatePipeline.mjs";

const now = "2026-09-05T00:00:00.000Z";
const sale = (title: string, overrides: Record<string, unknown> = {}) => ({
  title,
  saleDate: "2026-08-27",
  quantity: 1,
  retainedQuantity: 1,
  totalBuyerPaid: 25,
  conditionBucket: "new_sealed",
  ...overrides,
});
const candidate = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  artist: "Public Enemy",
  title: "It Takes a Nation of Millions to Hold Us Back",
  purchasePrice: 10,
  sourceId: "store",
  sourceUrl: `https://store.example/products/${id}`,
  ...overrides,
});

describe("observed album demand", () => {
  it("prioritizes actual album purchases across editions and conditions without borrowing their prices", () => {
    const demand = createAlbumDemandIndex(
      {
        createdAt: now,
        comps: [
          {
            records: [
              sale(
                "Public Enemy – It Takes A Nation Of Millions To Hold Us Back | Red Vinyl Lmtd Ed",
                { quantity: 4, retainedQuantity: 4 },
              ),
              sale(
                "Public Enemy- It Takes A Nation Of Millions To Hold Us Back VG+/VG Ultrasonic Clean 1988",
                { conditionBucket: "used", saleDate: "2025-10-01" },
              ),
            ],
          },
        ],
      },
      { now },
    ).match(candidate("record"));
    expect(demand).toMatchObject({
      status: "observed",
      unitsSold: 5,
      unitsSold90Days: 4,
      unitsSold365Days: 5,
      latestSaleDate: "2026-08-27",
      scope: "album_across_conditions_and_editions",
    });
    expect(demand).not.toHaveProperty("averageSoldPrice");
    expect(demand).not.toHaveProperty("conservativeResalePrice");
    expect(researchDemand({ albumDemand: demand }).observed).toBe(true);
  });

  it("does not count another artist, a similarly named release, CDs, lots, refunds, or undated/future rows", () => {
    const index = createAlbumDemandIndex(
      {
        comps: [
          {
            records: [
              sale("Different Artist - Greatest Hits Vinyl"),
              sale("Queen - Greatest Hits II Vinyl"),
              sale("Queen - Greatest Hits CD"),
              sale("Queen - Greatest Hits Vinyl Record Lot"),
              sale("Queen - Greatest Hits Vinyl", { retainedQuantity: 0 }),
              sale("Queen - Greatest Hits Vinyl", { saleDate: null }),
              sale("Queen - Greatest Hits Vinyl", { saleDate: "2027-01-01" }),
            ],
          },
        ],
      },
      { now },
    );
    expect(
      index.match({ artist: "Queen", title: "Greatest Hits" }),
    ).toBeUndefined();
  });

  it("deduplicates overlapping CSV/API observations even when inferred identities differ", () => {
    const row = sale(
      "Herbie Hancock – Maiden Voyage Limited Edition Blue Vinyl Brand New Record",
      { quantity: 7, retainedQuantity: 7 },
    );
    const demand = createAlbumDemandIndex(
      {
        createdAt: now,
        comps: [
          { records: [row] },
          { records: [{ ...row, inferredArtist: "Herbie Hancock" }] },
        ],
      },
      { now },
    ).match({
      artist: "Herbie Hancock",
      title: "Maiden Voyage (Blue Note Essential Vinyl Series) LP",
    });
    expect(demand).toMatchObject({ unitsSold: 7, transactionCount: 1 });
  });

  it("recognizes Record Store Day only as a complete metadata phrase after the album", () => {
    const release = { artist: "John Prine", title: "BBC Sessions" };
    const rows = [
      sale("John Prine BBC Sessions vinyl record LP Record Store Day 2026 NEW", { retainedQuantity: 11, quantity: 11 }),
      sale("John Prine - BBC Sessions RSD 2026 - NEW/SEALED"),
      sale("John Prine BBC Sessions RSD Record Store Day Exclusive Sealed Vinyl LP"),
    ];
    expect(createAlbumDemandIndex({ comps: [{ records: rows }] }, { now }).match(release))
      .toMatchObject({ unitsSold: 13, transactionCount: 3 });
    expect(ownSaleMatchesAlbum(release, sale("John Prine BBC Sessions Record Store Day Black Friday 2026 LP"))).toBe(true);
    for (const title of [
      "John Prine BBC Sessions Day LP",
      "John Prine BBC Sessions Record Store LP",
      "John Prine BBC Sessions Record Store Day Outtakes LP",
      "John Prine BBC Sessions II Record Store Day LP",
      "Different Artist BBC Sessions Record Store Day LP",
    ]) expect(ownSaleMatchesAlbum(release, sale(title))).toBe(false);
  });

  it("limits exact-comp matching work to retained complete artist-and-album matches", () => {
    const exact = { records: [sale("Queen - Greatest Hits Vinyl"), sale("Queen - Greatest Hits Red Vinyl", { saleDate: "2026-08-26" })] };
    const laterVolume = { records: [sale("Queen - Greatest Hits II Vinyl")] };
    const anotherArtist = { records: [sale("Different Artist - Greatest Hits Vinyl")] };
    const refunded = { records: [sale("Queen - Greatest Hits Vinyl", { retainedQuantity: 0 })] };
    const cds = { records: [sale("Queen - Greatest Hits CD")] };
    const index = createAlbumDemandIndex({ comps: [laterVolume, anotherArtist, refunded, cds, exact] }, { now });
    expect(index.matchingComps({ artist: "Queen", title: "Greatest Hits" })).toEqual([exact]);
    expect(index.matchingComps({ artist: "Queen", title: "Greatest Hits II" })).toEqual([laterVolume]);
    expect(index.matchingComps({ artist: "Queen", title: "Unknown Album" })).toEqual([]);
  });

  it("accepts a leading VINYL or LP label only before the full artist-and-album identity", () => {
    const release = { artist: "Herbie Hancock", title: "Maiden Voyage" };
    const comp = { records: [sale("VINYL Herbie Hancock - Maiden Voyage", { retainedQuantity: 9, quantity: 9 }), sale("LP Herbie Hancock - Maiden Voyage", { saleDate: "2026-08-26" })] };
    const index = createAlbumDemandIndex({ comps: [comp] }, { now });
    expect(index.match(release)).toMatchObject({ unitsSold: 10, transactionCount: 2 });
    expect(index.matchingComps(release)).toEqual([comp]);
    expect(ownSaleMatchesAlbum({ artist: "LP", title: "Lost On You" }, sale("LP - Lost On You Vinyl"))).toBe(true);
    for (const title of ["VINYL Different Artist - Maiden Voyage", "VINYL Herbie Hancock - Maiden Voyage II", "VINYL Herbie Hancock - Maiden Voyage CD", "NEW VINYL Herbie Hancock - Maiden Voyage", "VINYL LP Herbie Hancock - Maiden Voyage"])
      expect(ownSaleMatchesAlbum(release, sale(title))).toBe(false);
  });

  it("accepts bounded edition wording from real sold listings without dropping album extensions", () => {
    const release = { artist: "Thrice", title: "Identity Crisis" };
    const rows = [
      sale("Thrice - Identity Crisis [New Vinyl LP] Blue, Colored Vinyl, Ltd Ed, Anniversary", { retainedQuantity: 2, quantity: 2 }),
      sale("Thrice Identity Crisis 25th Anniversary Limited Ghostly Blue LP Vinyl"),
    ];
    const demand = createAlbumDemandIndex({ comps: [{ records: rows }] }, { now }).match(release);
    expect(demand).toMatchObject({ unitsSold: 3, transactionCount: 2 });
    expect(demand).not.toHaveProperty("averageSoldPrice");
    for (const title of [
      "Thrice Identity Crisis Ghostly LP",
      "Thrice Identity Crisis Ghostly Sessions Blue LP",
      "Thrice Identity Crisis II Blue Colored Vinyl Ltd Ed",
      "Different Artist Identity Crisis Blue Colored Vinyl Ltd Ed",
      "Thrice Identity Crisis CD Ltd Ed Anniversary",
    ]) expect(ownSaleMatchesAlbum(release, sale(title))).toBe(false);
  });

  it("never treats artist aggregates, retailer badges, raw counts, or unconfirmed sold matches as album purchases", () => {
    expect(
      researchDemand({
        artistSoldUnits365Days: 1000,
        retailerBestSeller: true,
        retailerReviewCount: 2000,
        totalSoldCount: 500,
      }).observed,
    ).toBe(false);
    expect(
      researchDemand({
        soldEvidence: {
          source: "local-own-sales-history",
          status: "validated",
          unitsSold90Days: 50,
          artistMatchConfirmed: false,
          editionMatchConfirmed: true,
          matchConfidence: 0.95,
        },
      }).observed,
    ).toBe(false);
    expect(
      researchDemand({
        ebayResearchStatus: "validated",
        ebaySoldMatchConfidence: "high",
        totalSoldCount: 500,
        productResearchRows: [],
      }).observed,
    ).toBe(false);
  });

  it("accepts one older confirmed exact own purchase as a research prior, without inventing recent velocity", () => {
    expect(
      researchDemand({
        totalSoldCount: 1,
        soldEvidence: {
          source: "local-own-sales-history",
          status: "validated",
          unitsSold90Days: 0,
          unitsSold365Days: 1,
          artistMatchConfirmed: true,
          albumMatchConfirmed: true,
          editionMatchConfirmed: true,
          matchConfidence: 0.95,
          latestSaleDate: "2026-01-01",
        },
      }),
    ).toMatchObject({ observed: true, units: 1, recentUnits: 0 });
  });
});

describe("demand-first research selection", () => {
  it("puts a documented album purchase ahead of heavily promoted cheap unproven records", () => {
    const observed = createAlbumDemandIndex(
      {
        createdAt: now,
        comps: [
          {
            records: [
              sale(
                "Public Enemy - It Takes A Nation Of Millions To Hold Us Back Vinyl",
              ),
            ],
          },
        ],
      },
      { now },
    ).match(candidate("known"));
    const rows = Array.from({ length: 100 }, (_, i) =>
      candidate(`unproven-${i}`, {
        artist: `Unproven Artist ${i}`,
        purchasePrice: 1,
        sourceOriginalPrice: 100,
        appliedSaleCampaignId: "sale",
        candidateQualityScore: 100,
      }),
    );
    const result = selectResearchCandidates(
      [
        ...rows,
        candidate("known", {
          albumDemand: observed,
          purchasePrice: 20,
          candidateQualityScore: 30,
        }),
      ],
      { limit: 20 },
    );
    expect(result.selected[0].id).toBe("known");
    expect(result.selected).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      observedDemandSelectedCount: 1,
      explorationLimit: 0,
      explorationSelectedCount: 0,
      unprovenDeferredCount: 100,
      unusedResearchCapacity: 19,
      inputCandidateCount: 101,
    });
  });

  it("leaves unused capacity instead of silently refilling the queue with unproven campaigns", () => {
    const result = selectResearchCandidates(
      Array.from({ length: 100 }, (_, i) =>
        candidate(`no-demand-${i}`, { appliedSaleCampaignId: "sale" }),
      ),
      { limit: 20 },
    );
    expect(result.selected).toHaveLength(1);
    expect(
      result.selected.every(
        (row) => row.researchPriority === "unproven_exploration",
      ),
    ).toBe(true);
    expect(result.diagnostics.unusedResearchCapacity).toBe(19);
  });

  it("lets observed demand fill the research budget and does not reserve an unproven quota", () => {
    const soldEvidence = {
      source: "local-own-sales-history",
      status: "validated",
      artistMatchConfirmed: true,
      albumMatchConfirmed: true,
      editionMatchConfirmed: true,
      matchConfidence: 1,
      unitsSold90Days: 1,
    };
    const result = selectResearchCandidates(
      Array.from({ length: 25 }, (_, i) =>
        candidate(`proven-${i}`, { soldEvidence }),
      ),
      { limit: 20 },
    );
    expect(result.selected).toHaveLength(20);
    expect(result.diagnostics.explorationSelectedCount).toBe(0);
    expect(result.diagnostics.observedDemandSelectedCount).toBe(20);
  });
});
