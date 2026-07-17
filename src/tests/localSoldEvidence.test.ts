import { describe, expect, it } from "vitest";
import { buildLocalSoldEvidence } from "../../scripts/lib/localSoldEvidence.mjs";

describe("local sold evidence mapping", () => {
  it("uses quantity-weighted, condition-matched windows without claiming marketplace seller proof", () => {
    const result = buildLocalSoldEvidence(
      {
        matchScore: 0.92,
        comp: {
          inferredArtist: "Test Artist",
          records: [
            {
              conditionBucket: "new_sealed",
              inferredArtist: "Test Artist",
              inferredReleaseTitle: "Test Album",
              quantity: 2,
              saleDate: "2026-06-20",
              shippingPaid: 5,
              soldFor: 25,
              title: "Test Artist - Test Album Vinyl LP",
              totalBuyerPaid: 30,
            },
            {
              conditionBucket: "used",
              inferredArtist: "Test Artist",
              inferredReleaseTitle: "Test Album",
              quantity: 50,
              saleDate: "2026-06-25",
              shippingPaid: 5,
              soldFor: 10,
              title: "Test Artist - Test Album Vinyl LP",
              totalBuyerPaid: 15,
            },
          ],
        },
      },
      { createdAt: "2026-06-30T00:00:00.000Z" },
      { candidate: { artist: "Test Artist", title: "Test Album" } },
    );

    expect(result.metrics).toMatchObject({
      averageTotal: 30,
      unitsSold: 2,
      unitsSold30Days: 2,
      unitsSold90Days: 2,
    });
    expect(result.soldEvidence).toMatchObject({
      condition: "new_sealed",
      conservativeResalePrice: 30,
      status: "validated",
      supportsMarketplaceSellerRepeatProof: false,
      unitsSold30Days: 2,
      unitsSold90Days: 2,
    });
    expect(result.soldEvidence).not.toHaveProperty("oneSellerSoldCount");
  });

  it("does not validate a weak title match", () => {
    const result = buildLocalSoldEvidence(
      {
        matchScore: 0.65,
        comp: {
          inferredArtist: "Test Artist",
          conditionMetrics: {
            new_sealed: {
              averageShipping: 5,
              averageSoldFor: 20,
              averageTotal: 25,
              daysSinceLastSale: 10,
              latestSaleDate: "2026-06-20",
              priceP25: 24,
              salesPerMonth90Days: 1,
              transactionCount: 3,
              unitsSold: 3,
              unitsSold30Days: 1,
              unitsSold90Days: 3,
              unitsSold365Days: 3,
            },
          },
        },
      },
      { createdAt: "2026-06-30T00:00:00.000Z" },
      { candidate: { artist: "Test Artist", title: "Test Album" } },
    );

    expect(result.soldEvidence?.status).toBe("candidate");
  });

  it("withholds validation when a candidate edition is not confirmed by matched sale titles", () => {
    const result = buildLocalSoldEvidence(
      {
        matchScore: 0.95,
        comp: {
          inferredArtist: "Artist",
          inferredReleaseTitle: "Album",
          records: [
            {
              conditionBucket: "new_sealed",
              quantity: 3,
              saleDate: "2026-06-20",
              shippingPaid: 5,
              soldFor: 25,
              title: "Artist - Album Vinyl LP",
              totalBuyerPaid: 30,
            },
          ],
        },
      },
      { createdAt: "2026-06-30T00:00:00.000Z" },
      {
        candidate: {
          artist: "Artist",
          sourceListingTitle: "Artist - Album (Blue Vinyl LP)",
          title: "Album",
        },
      },
    );

    expect(result.soldEvidence).toMatchObject({
      editionMatchConfirmed: false,
      matchConfidence: 0.65,
      status: "candidate",
    });
  });

  it("validates when the matched sale title confirms the candidate edition", () => {
    const result = buildLocalSoldEvidence(
      {
        matchScore: 0.95,
        comp: {
          inferredArtist: "Artist",
          inferredReleaseTitle: "Album",
          records: [
            {
              conditionBucket: "new_sealed",
              quantity: 3,
              saleDate: "2026-06-20",
              shippingPaid: 5,
              soldFor: 25,
              title: "Artist - Album Blue Vinyl LP",
              totalBuyerPaid: 30,
            },
          ],
        },
      },
      { createdAt: "2026-06-30T00:00:00.000Z" },
      {
        candidate: {
          artist: "Artist",
          sourceListingTitle: "Artist - Album (Blue Vinyl LP)",
          title: "Album",
        },
      },
    );

    expect(result.soldEvidence).toMatchObject({
      artistMatchConfirmed: true,
      editionMatchConfirmed: true,
      matchConfidence: 0.95,
      status: "validated",
    });
  });

  it("excludes special editions from standard-edition velocity and price evidence", () => {
    const result = buildLocalSoldEvidence(
      {
        matchScore: 0.95,
        comp: {
          inferredArtist: "Artist",
          inferredReleaseTitle: "Album",
          records: [
            {
              conditionBucket: "new_sealed",
              inferredArtist: "Artist",
              inferredReleaseTitle: "Album",
              quantity: 1,
              saleDate: "2026-06-20",
              shippingPaid: 0,
              soldFor: 20,
              title: "Artist - Album Vinyl LP",
              totalBuyerPaid: 20,
            },
            {
              conditionBucket: "new_sealed",
              inferredArtist: "Artist",
              inferredReleaseTitle: "Album Blue Vinyl LP",
              quantity: 10,
              saleDate: "2026-06-21",
              shippingPaid: 0,
              soldFor: 100,
              title: "Artist - Album Blue Limited Vinyl LP",
              totalBuyerPaid: 100,
            },
          ],
        },
      },
      { createdAt: "2026-06-30T00:00:00.000Z" },
      {
        candidate: {
          artist: "Artist",
          sourceListingTitle: "Artist - Album Vinyl LP",
          title: "Album",
        },
      },
    );

    expect(result.metrics).toMatchObject({
      averageTotal: 20,
      conservativeResalePrice: 20,
      unitsSold: 1,
      unitsSold90Days: 1,
    });
    expect(result.soldEvidence).toMatchObject({
      conservativeResalePrice: 20,
      unitsSold90Days: 1,
    });
  });

  it("withholds validation when the same title belongs to a different artist", () => {
    const result = buildLocalSoldEvidence(
      {
        matchScore: 0.95,
        comp: {
          conditionMetrics: {
            new_sealed: {
              averageShipping: 5,
              averageSoldFor: 25,
              averageTotal: 30,
              daysSinceLastSale: 5,
              latestSaleDate: "2026-06-25",
              priceP25: 28,
              salesPerMonth90Days: 2,
              transactionCount: 6,
              unitsSold: 6,
              unitsSold30Days: 2,
              unitsSold90Days: 6,
              unitsSold365Days: 6,
            },
          },
          inferredArtist: "Different Artist",
          inferredReleaseTitle: "Shared Album Title",
        },
      },
      { createdAt: "2026-06-30T00:00:00.000Z" },
      { candidate: { artist: "Expected Artist", title: "Shared Album Title" } },
    );

    expect(result.soldEvidence).toMatchObject({
      artistMatchConfirmed: false,
      conservativeResalePrice: null,
      matchConfidence: 0.65,
      status: "candidate",
    });
    expect(result.metrics).toBeNull();
  });
});
