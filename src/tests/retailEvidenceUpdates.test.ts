import { describe, expect, it } from "vitest";
import { mergeAlbumBenchmarkUpdates } from "../server/retailEvidenceUpdates";
import type { ArbitrageFind, ArbitrageImportPayload } from "../lib/arbitrage/types";
import type { AlbumPriceBenchmark } from "../../scripts/lib/albumPriceBenchmark.mjs";

const now = Date.parse("2026-09-05T05:00:00Z");
const capturedAt = "2026-09-04T18:00:00Z";
const benchmark: AlbumPriceBenchmark = {
  version: 1, status: "observed", source: "ebay-product-research",
  scope: "provisional_album_across_pressings", currency: "USD",
  lowPrice: 10, highPrice: 30, weightedMeanPrice: 20, weightedMedianPrice: 20,
  unitsSold1095Days: 12, listingCount: 2, capturedAt: new Date(now).toISOString(),
  query: "Artist Album",
  url: "https://www.ebay.com/sh/research?keywords=Artist+Album&dayRange=1095&categoryId=176985&conditionId=1000&tabName=SOLD&marketplace=EBAY-US",
  observedWindow: { startDate: "2023-09-05", endDate: "2026-09-04" },
  sampleComplete: false, unitCountBasis: "matched_captured_rows",
  priceBasis: "observed_listing_averages", shippingIncluded: false,
  volumeSupported: true, sampleStatus: "volume_supported",
};
const product: ArbitrageFind = {
  id: "offer", artist: "Artist", title: "Album", opportunityType: "product_deal",
  purchasePrice: 5, capturedAt, sourceId: "shop", sourceName: "Shop",
  sourceUrl: "https://shop.example/products/album", averageSoldPrice: 22,
  soldEvidence: { source: "ebay-product-research", status: "candidate", unitsSold90Days: 3 },
};
const previous: ArbitrageImportPayload = {
  schemaVersion: 2, phase: "final", publicationStatus: "final", runId: "original",
  createdAt: capturedAt, source: "scan", finds: [product, { ...product, id: "untouched" }, {
    ...product, id: "campaign", opportunityType: "sitewide_sale",
  }], sourceReports: [{ id: "shop", verifiedAt: capturedAt, candidateCount: 2 }],
  researchProgress: { planned: 2, completed: 0, validated: 0, noRows: 0, failed: 0, pending: 2, researchedRows: 0, limit: 240, outsidePlan: 0, complete: false, status: "incomplete" },
};
const incoming = (patch: Partial<ArbitrageImportPayload> = {}): ArbitrageImportPayload => ({
  schemaVersion: 2, phase: "final", publicationStatus: "final", runId: "evidence-new",
  createdAt: new Date(now).toISOString(), source: "benchmark-update",
  publicationMode: "evidence_updates", evidenceUpdateVersion: 1,
  evidenceUpdates: { scope: "album_price_benchmarks", baseRunId: "original" },
  finds: [{ ...product, albumPriceBenchmark: benchmark }], ...patch,
});

describe("album benchmark evidence updates", () => {
  it("changes only benchmark values while preserving every offer, old acquisition dates, source coverage and exact research", () => {
    const result = mergeAlbumBenchmarkUpdates(incoming({ finds: [{ ...product,
      albumPriceBenchmark: benchmark, averageSoldPrice: 999,
      soldEvidence: { source: "ebay-product-research", status: "validated", unitsSold90Days: 999 },
      retailObservedAt: new Date(now).toISOString(),
    }] }), previous, now);
    expect(result.finds).toEqual([{ ...product, albumPriceBenchmark: benchmark }, ...previous.finds.slice(1)]);
    expect(result.sourceReports).toEqual(previous.sourceReports);
    expect(result.researchProgress).toEqual(previous.researchProgress);
    expect(result).toMatchObject({ runId: "evidence-new", evidenceUpdates: { baseRunId: "original", updatedFindIds: ["offer"] },
      sourceUpdates: { updatedSourceIds: [], retainedSourceIds: ["shop"], lastBroadScanAt: capturedAt } });
    expect(previous.finds[0]).not.toHaveProperty("albumPriceBenchmark");
  });
  it("requires the current base publication and a new run ID", () => {
    for (const prior of [null, { ...previous, runId: "newer" }])
      expect(() => mergeAlbumBenchmarkUpdates(incoming(), prior, now)).toThrow(/exact current/);
    expect(() => mergeAlbumBenchmarkUpdates(incoming({ runId: "original" }), previous, now)).toThrow(/new run ID/);
  });
  it("rejects changed acquisition identity, duplicate/new/sale IDs and empty patches", () => {
    for (const patch of [{ artist: "Other" }, { title: "Other" }, { sourceId: "other" },
      { sourceUrl: "https://other.example/album" }, { purchasePrice: 1 }, { capturedAt: new Date(now).toISOString() }])
      expect(() => mergeAlbumBenchmarkUpdates(incoming({ finds: [{ ...product, ...patch, albumPriceBenchmark: benchmark }] }), previous, now)).toThrow(/changed existing/);
    for (const finds of [[], [{ ...product, id: "new", albumPriceBenchmark: benchmark }],
      [{ ...product, id: "campaign", albumPriceBenchmark: benchmark }],
      [incoming().finds[0], incoming().finds[0]]])
      expect(() => mergeAlbumBenchmarkUpdates(incoming({ finds }), previous, now)).toThrow();
  });
  it("rejects stale preparations, invalid ranges and another album query", () => {
    expect(() => mergeAlbumBenchmarkUpdates(incoming({ createdAt: "2026-09-03T00:00:00Z" }), previous, now)).toThrow(/timestamp/);
    for (const patch of [{ query: "Other Album" }, { query: "Art ist Album", url: benchmark.url.replace("Artist+Album", "Art+ist+Album") }, { lowPrice: -1 }, { capturedAt: "2026-10-01T00:00:00Z" }, { currency: "EUR" }])
      expect(() => mergeAlbumBenchmarkUpdates(incoming({ finds: [{ ...product, albumPriceBenchmark: { ...benchmark, ...patch } as AlbumPriceBenchmark }] }), previous, now)).toThrow(/valid and match/);
  });
  it("normalizes claimed volume support from observed units", () => {
    const result = mergeAlbumBenchmarkUpdates(incoming({ finds: [{ ...product, albumPriceBenchmark: { ...benchmark, unitsSold1095Days: 10 } }] }), previous, now);
    expect(result.finds[0].albumPriceBenchmark).toMatchObject({ volumeSupported: false, sampleStatus: "thin_sample" });
  });
  it("preserves unknown broad coverage dates on a prior partial publication", () => {
    const result = mergeAlbumBenchmarkUpdates(incoming(), { ...previous,
      publicationMode: "source_updates",
      sourceUpdates: { version: 1, updatedSourceIds: ["shop"], retainedSourceIds: [], lastBroadScanAt: null, lastBroadAttemptAt: null },
    }, now);
    expect(result.sourceUpdates).toMatchObject({ lastBroadScanAt: null, lastBroadAttemptAt: null });
  });
});
