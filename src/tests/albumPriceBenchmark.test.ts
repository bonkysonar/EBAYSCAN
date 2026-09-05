import { describe, expect, it } from "vitest";
import { createAlbumPriceBenchmarkIndex, normalizeAlbumPriceBenchmark } from "../../scripts/lib/albumPriceBenchmark.mjs";
import { buildSoldResearchQueryVariants } from "../lib/arbitrage/soldResearchLinks.mjs";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";

const now = "2026-09-05T05:00:00Z";
const candidate = { id: "benchmark-test", artist: "Artist Name", title: "Actual Album", purchasePrice: 5, capturedAt: now, sourceId: "shop", sourceName: "Shop", sourceUrl: "https://shop.example/products/actual-album", condition: "new/sealed" };
const url = "https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=Artist+Name+Actual+Album&dayRange=1095&categoryId=176985&conditionId=1000&tabName=SOLD";
const row = { title: "Artist Name Actual Album Red Vinyl LP", avgSoldPrice: 20, totalSold: 8, dateLastSold: "2026-08-01" };
const page = { query: "Artist Name Actual Album", capturedAt: now, periodDays: 1095, observedWindow: { text: "Sep 5, 2023 – Sep 4, 2026" }, condition: "New", category: "Vinyl Records", completePagination: false, url, rows: [row, { ...row, title: "Actual Album by Artist Name Blue Vinyl LP", avgSoldPrice: 40, totalSold: 4 }] };
const captures = { captureMethod: "visible_browser", pages: [page] };

describe("provisional album price benchmarks", () => {
  it("uses observed listing averages across colors, allows unlinked partial rows, and weighs by sold quantities", () => {
    const benchmark = createAlbumPriceBenchmarkIndex(captures, now).match(candidate);
    expect(benchmark).toMatchObject({ lowPrice: 20, highPrice: 40, weightedMeanPrice: 26.67, weightedMedianPrice: 20, unitsSold1095Days: 12, listingCount: 2, volumeSupported: true, sampleStatus: "volume_supported", sampleComplete: false, shippingIncluded: false, priceBasis: "observed_listing_averages", scope: "provisional_album_across_pressings" });
    expect(benchmark).not.toHaveProperty("conservativeResalePrice");
    const evaluated = evaluateOpportunity({ ...candidate, albumPriceBenchmark: benchmark }, {}, now);
    expect(evaluated.gates.soldEvidence).toBe(false);
    expect(evaluated.costLedger.expectedResalePrice).toBeNull();
  });
  it("keeps ten copies as a visible thin sample and rejects zero usable rows", () => {
    const index = createAlbumPriceBenchmarkIndex({ ...captures, pages: [{ ...page, complete: true, completePagination: undefined, rows: [{ ...row, totalSold: 10 }] }] }, now);
    expect(index.match(candidate)).toMatchObject({ lowPrice: 20, highPrice: 20, unitsSold1095Days: 10, volumeSupported: false, sampleStatus: "thin_sample", sampleComplete: true });
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [{ ...page, rows: [] }] }, now).match(candidate)).toBeUndefined();
  });
  it("excludes wrong artist/album, second volumes, CDs, lots, autographs and test pressings", () => {
    const bad = ["Other Artist Actual Album Vinyl LP", "Artist Name Actual Album II Vinyl LP", "Artist Name Different Album Vinyl LP", "Artist Name Actual Album CD", "Artist Name Actual Album Cassette", "Artist Name Actual Album Vinyl Lot", "Artist Name Actual Album Signed Vinyl LP", "Artist Name Actual Album Test Pressing Vinyl LP"];
    const benchmark = createAlbumPriceBenchmarkIndex({ ...captures, pages: [{ ...page, rows: [row, ...bad.map(title => ({ ...row, title, avgSoldPrice: 999, totalSold: 100 }))] }] }, now).match(candidate);
    expect(benchmark).toMatchObject({ unitsSold1095Days: 8, lowPrice: 20, highPrice: 20 });
  });
  it("reads actual cells captures, strips the image caption, and deduplicates repeated rows", () => {
    const cells = [", preview full size image Artist Name - Actual Album (Vinyl)", "Edit", "$14.55 Fixed price", "$5.07", "9", "$130.95", "-", "Oct 15, 2024"];
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [{ ...page, rows: [{ cells, href: null }, { cells, href: null }] }] }, now).match(candidate)).toMatchObject({ lowPrice: 14.55, unitsSold1095Days: 9, listingCount: 1 });
  });
  it("accepts a standalone parenthetical genre in the observed Beach Boys row without accepting other releases", () => {
    const query = "The Beach Boys L. A. Light Album";
    const cells = [", preview full size image\nBEACH BOYS l a / light album ( rock ) SEALED NEW", "Edit", "$17.15\nFixed price", "$7.38\n0% Free shipping", "1", "$17.15", "-", "Jun 25, 2025"];
    const badTitles = [
      "BEACH BOYS l a / light album rock SEALED NEW",
      "BEACH BOYS l a / light album II (rock) SEALED NEW",
      "BEACH BOYS l a / light album (Live Rock) SEALED NEW",
      "BEACH BOYS Different Album (rock) SEALED NEW",
      "OTHER BAND l a / light album (rock) SEALED NEW",
      "BEACH BOYS l a / light album (rock) CD SEALED NEW",
    ];
    const p = { ...page, query, url: url.replace("Artist+Name+Actual+Album", encodeURIComponent(query)), rows: [
      { cells, href: null }, ...badTitles.map(title => ({ ...row, title, avgSoldPrice: 999, totalSold: 100 })),
    ] };
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [p] }, now).match({ artist: "The Beach Boys", title: "L. A. Light Album LP" })).toMatchObject({ lowPrice: 17.15, highPrice: 17.15, unitsSold1095Days: 1, listingCount: 1, sampleStatus: "thin_sample" });
  });
  it("preserves a genre word when it is the album title", () => {
    const query = "Queen Jazz";
    const p = { ...page, query, url: url.replace("Artist+Name+Actual+Album", encodeURIComponent(query)), rows: [{ ...row, title: "Queen (Jazz) New Vinyl LP" }, { ...row, title: "Queen News Of The World (Jazz) New Vinyl LP", totalSold: 100 }] };
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [p] }, now).match({ artist: "Queen", title: "Jazz LP" })).toMatchObject({ unitsSold1095Days: 8, listingCount: 1 });
  });
  it("deduplicates linked listings across tracking URLs and rejects invalid dates/foreign item links", () => {
    const item = { ...row, itemUrl: "https://www.ebay.com/itm/123456789012" };
    const rows = [item, { ...item, itemUrl: `${item.itemUrl}?tracking=1` }, { ...row, dateLastSold: "2022-01-01" }, { ...row, dateLastSold: "2026-09-06" }, { ...row, itemUrl: "https://example.com/itm/123456789012" }];
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [{ ...page, rows }] }, now).match(candidate)).toMatchObject({ unitsSold1095Days: 8, listingCount: 1 });
  });
  it("does not reuse another album's rows for a self-titled release", () => {
    const self = { artist: "Artist Name", title: "Artist Name" };
    const selfPage = { ...page, query: "Artist Name", url: url.replace("Artist+Name+Actual+Album", "Artist+Name"), rows: [row, { ...row, title: "Artist Name self titled Vinyl LP", totalSold: 2 }] };
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [selfPage] }, now).match(self)).toMatchObject({ unitsSold1095Days: 2 });
  });
  it("withholds benchmarks for stale, wrong-window, wrong-condition and wrong-query captures", () => {
    for (const change of [{ capturedAt: "2026-08-01T00:00:00Z" }, { condition: "Used" }, { category: "Music" }, { observedWindow: { startDate: "2026-06-06", endDate: "2026-09-04" } }, { url: url.replace("1095", "90") }, { url: url.replace("1000", "3000") }, { url: url.replace("Artist+Name", "Different+Artist") }]) {
      expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [{ ...page, ...change }] }, now).match(candidate)).toBeUndefined();
    }
  });
  it("normalizes the runtime boundary without trusting false volume or scope assertions", () => {
    const benchmark = createAlbumPriceBenchmarkIndex(captures, now).match(candidate)!;
    expect(normalizeAlbumPriceBenchmark({ ...benchmark, volumeSupported: false }, now)?.volumeSupported).toBe(true);
    for (const change of [{ lowPrice: -1 }, { highPrice: 1 }, { listingCount: 20 }, { weightedMeanPrice: 1000 }, { scope: "exact_pressing" }, { unitsSold1095Days: 0 }, { shippingIncluded: true }]) expect(normalizeAlbumPriceBenchmark({ ...benchmark, ...change }, now)).toBeUndefined();
  });
  it("preserves album color words and removes a redundant Beatles artist heading", () => {
    for (const title of ["Midnight Blue (Blue Note Essential Vinyl Series) LP", "Midnight Blue LP (Blue Note Classic Vinyl Series)"]) expect(buildSoldResearchQueryVariants({ artist: "Kenny Burrell", title })[0].query).toBe("Kenny Burrell Midnight Blue");
    expect(buildSoldResearchQueryVariants({ artist: "Miles Davis", title: "Kind Of Blue Vinyl LP" })[0].query).toBe("Miles Davis Kind Of Blue");
    expect(buildSoldResearchQueryVariants({ artist: "The Beatles", title: 'Beatles - Free as a Bird/Real Love 7"' })[0].query).toBe("The Beatles Free as a Bird/Real Love");
    expect(buildSoldResearchQueryVariants({ artist: "Public Enemy", title: "It Takes A Nation Of Millions To Hold Us Back (Red) LP" })[0].query).toBe("Public Enemy It Takes A Nation Of Millions To Hold Us Back");
    expect(buildSoldResearchQueryVariants({ artist: "Bee Gees", title: "Main Course White LP" })[0].query).toBe("Bee Gees Main Course");
    expect(buildSoldResearchQueryVariants({ artist: "Artist", title: "Black And White Vinyl LP" })[0].query).toBe("Artist Black And White");
  });

  it("resolves artist-prefixed retail titles and explicitly credited ensembles without accepting another album", () => {
    for (const [artist, title, query, soldTitle] of [
      ["Lou Donaldson", "Lou Donaldson - Sunny Side Up LP (Blue Note Classic Vinyl Series)", "Lou Donaldson Sunny Side Up", "Lou Donaldson Sunny Side Up New Vinyl LP"],
      ["Joni Mitchell", "Joni Mitchell: The Hissing Of Summer Lawns (Colored Vinyl) Vinyl LP", "Joni Mitchell The Hissing Of Summer Lawns", "Joni Mitchell The Hissing Of Summer Lawns Vinyl LP"],
      ["Art Blakey", "Art Blakey & The Jazz Messengers - Moanin’ (Blue Note Essential Vinyl Series) LP", "Art Blakey & The Jazz Messengers Moanin'", "Art Blakey Moanin New Vinyl LP"],
    ]) {
      const p = { ...page, query, url: url.replace("Artist+Name+Actual+Album", encodeURIComponent(query)), rows: [{ ...row, title: soldTitle }] };
      expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [p] }, now).match({ artist, title })?.unitsSold1095Days).toBe(8);
    }
  });

  it("keeps Lollipop singles separate from Tha Carter III albums mentioning the song", () => {
    const query = "Lil Wayne Lollipop";
    const p = { ...page, query, url: url.replace("Artist+Name+Actual+Album", encodeURIComponent(query)), rows: [
      { ...row, title: 'Lollipop 7" by Lil Wayne vinyl sealed new Young Money Entertainment' },
      { ...row, title: 'Lil Wayne Lollipop 7" Single Vinyl Cash Money Records', totalSold: 3 },
      { ...row, title: 'LIL WAYNE THA CARTER III VINYL NEW LIMITED RED LP LOLLIPOP GOT MONEY', totalSold: 100 },
    ] };
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [p] }, now).match({ artist: "Lil Wayne", title: 'Lollipop 7" (RepublicRecords.com Exclusive)' })).toMatchObject({ unitsSold1095Days: 11, listingCount: 2 });
  });

  it("allows observed ten-inch releases for unspecified retailer diameters while retaining explicit size and seven-inch conflicts", () => {
    const tenInch = { ...row, title: 'Artist Name Actual Album Limited Edition 10" IN HAND' };
    const indexFor = (soldTitle: string) => createAlbumPriceBenchmarkIndex({ ...captures, pages: [{ ...page, rows: [{ ...tenInch, title: soldTitle }] }] }, now);
    const index = indexFor(tenInch.title);
    expect(index.match({ ...candidate, title: "Actual Album Limited Edition LP", recordFormat: "LP" })).toMatchObject({ lowPrice: 20, unitsSold1095Days: 8, scope: "provisional_album_across_pressings" });
    expect(index.match({ ...candidate, title: 'Actual Album 12" LP' })).toBeUndefined();
    expect(index.match({ ...candidate, recordFormat: "12 inch" })).toBeUndefined();
    expect(index.match({ ...candidate, title: 'Actual Album 7"' })).toBeUndefined();
    expect(indexFor('Artist Name Actual Album 7" Single').match(candidate)).toBeUndefined();
    expect(indexFor('Artist Name Actual Album Single').match(candidate)).toBeUndefined();
    expect(indexFor('Artist Name Actual Album 12" LP').match({ ...candidate, title: 'Actual Album 10"' })).toBeUndefined();
    expect(indexFor('Artist Name Actual Album 10" Single').match(candidate)).toMatchObject({ unitsSold1095Days: 8 });
    expect(indexFor('Artist Name Different Album 10" IN HAND').match(candidate)).toBeUndefined();
  });

  it("preserves In Hand when it belongs to the actual album title", () => {
    const query = "Artist Name In Hand";
    const p = { ...page, query, url: url.replace("Artist+Name+Actual+Album", encodeURIComponent(query)), rows: [{ ...row, title: "Artist Name In Hand Vinyl LP" }, { ...row, title: "Artist Name Other Album Vinyl LP IN HAND", totalSold: 100 }] };
    expect(createAlbumPriceBenchmarkIndex({ ...captures, pages: [p] }, now).match({ artist: "Artist Name", title: "In Hand LP" })).toMatchObject({ unitsSold1095Days: 8, listingCount: 1 });
  });
});
