import { describe, expect, it } from "vitest";
import {
  assessRecordCandidate,
  candidateQualityScore,
  isHighSignalProductFind,
  rankAndSelectCandidates,
} from "../../scripts/lib/candidatePipeline.mjs";

describe("retail candidate pipeline", () => {
  it("rejects obvious retail noise and navigation before research", () => {
    const source = { id: "vinyl-deals", name: "Vinyl Deals", priority: 1, saleLikelihood: "high" };

    expect(
      assessRecordCandidate({
        source,
        title: "Anker USB-C Fast Charger",
        url: "https://shop.example/products/anker-charger",
      }),
    ).toMatchObject({ accepted: false, reasons: ["non_music_retail_category"] });
    expect(
      assessRecordCandidate({
        context: "Vinyl records and LPs",
        source,
        title: "Shop now",
        url: "https://shop.example/collections/sale",
      }),
    ).toMatchObject({ accepted: false, reasons: ["navigation_label"] });
    expect(
      assessRecordCandidate({
        context: "Flash deals",
        source: { id: "walmart", name: "Walmart", sourceType: "marketplace_retailer" },
        title: "Best seller Smart Watch for Women and Men",
        url: "https://www.walmart.com/ip/smart-watch/123",
      }),
    ).toMatchObject({ accepted: false, reasons: ["marketplace_requires_explicit_vinyl"] });
    expect(
      assessRecordCandidate({
        context: "Coupons and deals",
        source: { id: "barnes-noble", name: "Barnes & Noble" },
        title: "Salty: A Novel (B&N Exclusive Edition)",
        url: "https://www.barnesandnoble.com/w/salty/1?ean=9780063588646",
      }),
    ).toMatchObject({ accepted: false });
    expect(
      assessRecordCandidate({
        context: "Vinyl records and LPs",
        source: { id: "cheap-vinyl", name: "Cheap Vinyl" },
        title: "Vinyl under $15",
        url: "https://amzn.to/example",
      }),
    ).toMatchObject({ accepted: false, reasons: ["deal_category_navigation"] });
    expect(
      assessRecordCandidate({
        context: "Budget vinyl supplies",
        source: { id: "cheap-vinyl", name: "Cheap Vinyl" },
        title: "Get a Magic Eraser ($10.60 for 8)",
        url: "https://www.amazon.com/gp/product/B0170A169Q",
      }),
    ).toMatchObject({ accepted: false, reasons: ["deal_aggregator_requires_record_title"] });
    for (const title of [
      "Artist Vinyl T-Shirt",
      "Vinyl Record Tote Bag",
      "Artist Album Vinyl + CD Bundle",
      "Heated Rivalry Soundtrack (2CD)",
      "Miami Connection Guitar Picks",
      "Vinyl Record Pizza Cutter",
      "12\" Chocolate Donut Slip Mat",
      "Wayne's World [New 4K UHD Steelbook]",
      "Crosley Vinyl Record Player with Speakers",
    ]) {
      expect(
        assessRecordCandidate({
          source,
          title,
          url: "https://shop.example/products/merch",
        }),
      ).toMatchObject({ accepted: false, reasons: ["non_vinyl_format"] });
    }
    expect(
      assessRecordCandidate({
        context: "Vinyl records and LPs",
        source,
        title: "Filter Amazon by&nbsp;price",
        url: "https://shop.example/products/album",
      }),
    ).toMatchObject({ accepted: false, reasons: ["navigation_label"] });
    expect(
      assessRecordCandidate({
        context: "Vinyl LP sale",
        source,
        title: "Prime Members 40% Off Select Items",
        url: "https://shop.example/products/prime-sale",
      }),
    ).toMatchObject({ accepted: false, reasons: ["promotion_label"] });
    expect(
      assessRecordCandidate({
        source,
        title: "Smile Empty Soul - Shapeshifter",
        url: "https://shop.example/collections/cassette-tapes/products/shapeshifter",
      }),
    ).toMatchObject({ accepted: false, reasons: ["non_vinyl_format"] });
    expect(
      assessRecordCandidate({
        source,
        title: "[DAMAGED] Jack White - Frozen Charlotte (Blue Vinyl LP)",
        url: "https://shop.example/products/damaged-jack-white-frozen-charlotte",
      }),
    ).toMatchObject({ accepted: false, reasons: ["non_new_condition"] });
    expect(
      assessRecordCandidate({
        productType: "Used Vinyl",
        source,
        tags: "used45 Very Good Plus",
        title: "Joe Simon - It's A Miracle on Hush",
        url: "https://shop.example/products/joe-simon-its-a-miracle",
      }),
    ).toMatchObject({ accepted: false, reasons: ["non_new_condition"] });
    expect(
      assessRecordCandidate({
        source,
        title: "Kiss - Love Gun (Vinyl LP)",
        url: "https://deals.example/f/123?attrsrc=Thread%3AExpired%3ATrue",
      }),
    ).toMatchObject({ accepted: false, reasons: ["expired_deal"] });
  });

  it("keeps soundtrack and unknown-artist record listings when format evidence is strong", () => {
    const result = assessRecordCandidate({
      source: { id: "soundtrack-label", name: "Soundtrack Label", priority: 1 },
      title: "Stranger Things 5 Soundtrack (Red Vinyl 2LP)",
      url: "https://shop.example/products/stranger-things-5",
    });

    expect(result.accepted).toBe(true);
    expect(result.score).toBeGreaterThan(60);
  });

  it("keeps explicit vinyl products from otherwise noisy marketplace retailers", () => {
    for (const title of [
      "Frank Sinatra - The Best Of - Colored Vinyl Record [LP]",
      "Frank Sinatra - The Best Of - 2xLP",
    ]) {
      const result = assessRecordCandidate({
        context: "Music deals",
        source: { id: "walmart", name: "Walmart", sourceType: "marketplace_retailer" },
        title,
        url: "https://www.walmart.com/ip/frank-sinatra-vinyl/123",
      });

      expect(result.accepted).toBe(true);
    }
  });

  it("treats a qualifying Shopify compare-at markdown as a sale-radar signal", () => {
    const plainShopifyProduct = {
      averageSoldPrice: null,
      purchasePrice: 20,
      sourceDefaultDiscountThreshold: 0.4,
      sourceId: "independent-record-shop",
      sourceListingTitle: "Artist - Album",
      sourceName: "Independent Record Shop",
      sourceNoiseLevel: "low",
      sourceOriginalPrice: 40,
      sourceUrl: "https://records.example/products/artist-album",
    };

    expect(isHighSignalProductFind(plainShopifyProduct)).toBe(true);
    expect(
      isHighSignalProductFind({
        ...plainShopifyProduct,
        purchasePrice: 30,
      }),
    ).toBe(false);
    expect(
      isHighSignalProductFind({
        ...plainShopifyProduct,
        purchasePrice: 120,
        sourceDiscountPercent: 50,
        sourceOriginalPrice: null,
      }),
    ).toBe(false);
  });

  it("keeps Walmart vinyl at the useful absolute-price ceiling for market validation", () => {
    expect(
      isHighSignalProductFind({
        averageSoldPrice: null,
        candidateQualityScore: 92,
        condition: "new/sealed",
        purchasePrice: 17.26,
        sourceCountry: "US",
        sourceCurrency: "USD",
        sourceDefaultDiscountThreshold: 0.4,
        sourceDiscountPercent: 34,
        sourceDomain: "walmart.com",
        sourceId: "walmart",
        sourceListingTitle: "Artist - Album - Vinyl $17.26 Was $25.98",
        sourceName: "Walmart",
        sourceNoiseLevel: "high",
        sourceOriginalPrice: 25.98,
        sourceUrl: "https://www.walmart.com/ip/artist-album/123",
      }),
    ).toBe(true);

    expect(
      isHighSignalProductFind({
        averageSoldPrice: null,
        candidateQualityScore: 92,
        condition: "new/sealed",
        purchasePrice: 19.97,
        sourceCountry: "US",
        sourceCurrency: "USD",
        sourceDefaultDiscountThreshold: 0.4,
        sourceDiscountPercent: 17,
        sourceDomain: "walmart.com",
        sourceId: "walmart",
        sourceListingTitle: "Soundtrack Vinyl $19.97 Was $23.99",
        sourceName: "Walmart",
        sourceNoiseLevel: "high",
        sourceOriginalPrice: 23.99,
        sourceUrl: "https://www.walmart.com/ip/soundtrack/456",
      }),
    ).toBe(true);

    expect(
      isHighSignalProductFind({
        averageSoldPrice: null,
        condition: "new/sealed",
        purchasePrice: 13,
        retailerSoldBySource: true,
        sourceCountry: "US",
        sourceCurrency: "USD",
        sourceDomain: "walmart.com",
        sourceId: "walmart",
        sourceListingTitle: "Creedence Clearwater Revival - Chronicle (Vinyl LP)",
        sourceName: "Walmart",
        sourceOriginalPrice: null,
        sourceUrl: "https://www.walmart.com/ip/chronicle/789",
      }),
    ).toBe(true);

    expect(
      isHighSignalProductFind({
        averageSoldPrice: null,
        condition: "new/sealed",
        purchasePrice: 13,
        retailerSoldBySource: false,
        sourceCountry: "US",
        sourceCurrency: "USD",
        sourceDomain: "walmart.com",
        sourceId: "walmart",
        sourceListingTitle: "Creedence Clearwater Revival - Chronicle (Vinyl LP)",
        sourceName: "Walmart",
        sourceUrl: "https://www.walmart.com/ip/chronicle/789",
      }),
    ).toBe(false);

    expect(
      isHighSignalProductFind({
        averageSoldPrice: null,
        purchasePrice: 20.01,
        retailerSoldBySource: true,
        sourceId: "walmart",
        sourceListingTitle: "Duran Duran - Rio (Vinyl LP)",
        sourceName: "Walmart",
        sourceUrl: "https://www.walmart.com/ip/rio/790",
      }),
    ).toBe(false);
  });

  it("uses the absolute-price research lane for direct US retailers, not just Walmart", () => {
    const directNewUsRecord = {
      averageSoldPrice: null,
      condition: "new/sealed",
      sourceCountry: "US",
      sourceCurrency: "USD",
      sourceGroup: "US retailers",
      sourceOriginalPrice: null,
    };

    expect(
      isHighSignalProductFind({
        ...directNewUsRecord,
        purchasePrice: 13,
        sourceDomain: "barnesandnoble.com",
        sourceId: "barnes-noble",
        sourceListingTitle: "Creedence Clearwater Revival - Chronicle [Vinyl LP]",
        sourceName: "Barnes & Noble",
        sourceRetailType: "marketplace_retailer",
        sourceUrl: "https://www.barnesandnoble.com/w/chronicle/123",
      }),
    ).toBe(true);

    expect(
      isHighSignalProductFind({
        ...directNewUsRecord,
        purchasePrice: 19.99,
        sourceDomain: "records.example",
        sourceId: "independent-record-shop",
        sourceListingTitle: "Duran Duran - Rio (Vinyl LP)",
        sourceName: "Independent Record Shop",
        sourceRetailType: "us_retailer",
        sourceUrl: "https://records.example/products/duran-duran-rio",
      }),
    ).toBe(true);
  });

  it("does not admit used, foreign, discovery-source, or third-party offers solely because they are cheap", () => {
    const directOffer = {
      averageSoldPrice: null,
      condition: "new/sealed",
      purchasePrice: 12.99,
      sourceCountry: "US",
      sourceCurrency: "USD",
      sourceDomain: "records.example",
      sourceGroup: "US retailers",
      sourceId: "independent-record-shop",
      sourceListingTitle: "Artist - Album (Vinyl LP)",
      sourceName: "Independent Record Shop",
      sourceRetailType: "us_retailer",
      sourceUrl: "https://records.example/products/artist-album",
    };

    expect(isHighSignalProductFind({ ...directOffer, condition: "used - near mint" })).toBe(false);
    expect(
      isHighSignalProductFind({
        ...directOffer,
        sourceCountry: "UK",
        sourceCurrency: "GBP",
      }),
    ).toBe(false);
    expect(isHighSignalProductFind({ ...directOffer, sourceCurrency: "CAD" })).toBe(false);
    expect(
      isHighSignalProductFind({
        ...directOffer,
        sourceDomain: "cheapvinyl.wordpress.com",
        sourceGroup: "Discovery sources",
        sourceId: "cheap-vinyl",
        sourceType: "deal-aggregator",
        sourceUrl: "https://www.amazon.com/dp/B000000000",
      }),
    ).toBe(false);
    expect(
      isHighSignalProductFind({
        ...directOffer,
        retailerSellerName: "Marketplace Music LLC",
        retailerSoldBySource: null,
      }),
    ).toBe(false);
  });

  it("does not reward an unwindowed raw sold count", () => {
    const candidate = {
      candidateQualityScore: 70,
      purchasePrice: 15,
      sourceId: "store",
      sourceName: "Store",
    };

    expect(candidateQualityScore({ ...candidate, totalSoldCount: 2 })).toBe(
      candidateQualityScore({ ...candidate, totalSoldCount: 2_000 }),
    );
    expect(
      candidateQualityScore({
        ...candidate,
        soldEvidence: { status: "validated", unitsSold90Days: 30 },
      }),
    ).toBeGreaterThan(candidateQualityScore(candidate));
  });

  it("does not treat a missing sold price as a zero-dollar comp", () => {
    const candidate = {
      averageSoldPrice: null,
      candidateQualityScore: 70,
      purchasePrice: 10,
      sourceId: "store",
      sourceName: "Store",
    };

    expect(candidateQualityScore(candidate)).toBe(36.5);
    expect(candidateQualityScore(candidate)).toBe(
      candidateQualityScore({ ...candidate, averageSoldPrice: undefined }),
    );
  });

  it("uses retailer demand signals to rank equally priced Walmart records without saturating the base score", () => {
    const ordinary = {
      candidateQualityScore: 70,
      purchasePrice: 13,
      retailerSoldBySource: true,
      sourceId: "walmart",
      sourceName: "Walmart",
    };
    const evergreenRetailSignal = {
      ...ordinary,
      barcode: "0194398781234",
      retailerBestSeller: true,
      retailerCustomerPick: true,
      retailerReviewCount: 201,
    };

    expect(candidateQualityScore(ordinary)).toBe(42.5);
    expect(candidateQualityScore(evergreenRetailSignal)).toBe(62.5);
    expect(candidateQualityScore(evergreenRetailSignal)).toBeGreaterThan(
      candidateQualityScore(ordinary),
    );
  });

  it("uses own-account artist history as a modest evergreen ranking prior", () => {
    const obscure = {
      artistSoldUnits365Days: 0,
      candidateQualityScore: 70,
      id: "obscure",
      purchasePrice: 13,
      sourceId: "store",
      sourceName: "Store",
      title: "Obscure Artist - Album",
    };
    const evergreen = {
      ...obscure,
      artistSoldUnits365Days: 20,
      id: "evergreen",
      title: "Duke Ellington - Album",
    };

    expect(candidateQualityScore(evergreen) - candidateQualityScore(obscure)).toBe(25);
    expect(rankAndSelectCandidates([obscure, evergreen], { limit: 2 })[0]?.id).toBe("evergreen");
  });

  it("keeps singles, bundles, unknown artists, and high buy costs available but ranks them below comparable LPs", () => {
    const base = {
      artist: "Rolling Stones",
      candidateQualityScore: 80,
      purchasePrice: 14,
      sourceId: "store",
      sourceName: "Store",
      title: "Sticky Fingers",
    };

    expect(
      candidateQualityScore({
        ...base,
        artist: "Unknown Artist",
        purchasePrice: 36,
        title: "Rolling Stones Singles Bundle 7\"",
      }),
    ).toBeLessThan(candidateQualityScore(base));
  });

  it("globally ranks before limiting and prevents one aggregator from filling the queue", () => {
    const aggregator = Array.from({ length: 10 }, (_, index) => ({
      candidateQualityScore: 100 - index,
      id: `agg-${index}`,
      sourceId: "slickdeals",
      sourceName: "Slickdeals",
      title: `Aggregator ${index}`,
    }));
    const direct = [
      { candidateQualityScore: 80, id: "a", sourceId: "store-a", sourceName: "Store A", title: "A" },
      { candidateQualityScore: 75, id: "b", sourceId: "store-b", sourceName: "Store B", title: "B" },
      { candidateQualityScore: 70, id: "c", sourceId: "store-c", sourceName: "Store C", title: "C" },
    ];

    const selected = rankAndSelectCandidates([...aggregator, ...direct], {
      explorationShare: 0.4,
      limit: 5,
      perSourceShare: 0.4,
    });

    expect(selected).toHaveLength(5);
    expect(selected.filter((candidate) => candidate.sourceId === "slickdeals")).toHaveLength(2);
    expect(new Set(selected.map((candidate) => candidate.sourceId)).size).toBeGreaterThanOrEqual(2);
  });

  it("uses source caps as guardrails instead of forcing equal quotas into a small queue", () => {
    const strong = Array.from({ length: 10 }, (_, index) => ({
      candidateQualityScore: 100 - index,
      id: `strong-${index}`,
      sourceId: "strong-store",
      sourceName: "Strong Store",
      title: `Strong ${index}`,
    }));
    const weak = Array.from({ length: 10 }, (_, index) => ({
      candidateQualityScore: 30 - index,
      id: `weak-${index}`,
      sourceId: "weak-store",
      sourceName: "Weak Store",
      title: `Weak ${index}`,
    }));

    const selected = rankAndSelectCandidates([...strong, ...weak], {
      familyExploration: false,
      limit: 8,
    });

    expect(selected).toHaveLength(8);
    expect(selected.filter((candidate) => candidate.sourceId === "strong-store")).toHaveLength(5);
  });

  it("deduplicates the same pressing across retailers and retains the better purchase offer", () => {
    const expensive = {
      artist: "Creedence Clearwater Revival",
      barcode: "0194398781234",
      candidateQualityScore: 100,
      id: "expensive",
      purchasePrice: 16.99,
      sourceId: "retailer-a",
      sourceName: "Retailer A",
      sourceUrl: "https://a.example/chronicle",
      title: "Chronicle",
    };
    const cheaper = {
      ...expensive,
      barcode: null,
      candidateQualityScore: 80,
      gtin: "194398781234",
      id: "cheaper",
      purchasePrice: 12.99,
      sourceId: "retailer-b",
      sourceName: "Retailer B",
      sourceUrl: "https://b.example/chronicle",
    };

    const selected = rankAndSelectCandidates([expensive, cheaper], { limit: 80 });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      id: "cheaper",
      purchasePrice: 12.99,
      sourceId: "retailer-b",
    });
  });

  it("keeps clearly different vinyl variants separate without a barcode", () => {
    const base = {
      artist: "Duran Duran",
      candidateQualityScore: 80,
      purchasePrice: 14.99,
      sourceId: "record-store",
      sourceName: "Record Store",
      title: "Rio",
    };

    const selected = rankAndSelectCandidates(
      [
        {
          ...base,
          id: "red",
          sourceListingTitle: "Duran Duran - Rio (Red Vinyl LP)",
        },
        {
          ...base,
          id: "blue",
          sourceListingTitle: "Duran Duran - Rio (Blue Vinyl LP)",
        },
      ],
      { limit: 80 },
    );

    expect(selected.map((candidate) => candidate.id).sort()).toEqual(["blue", "red"]);
  });

  it("conservatively deduplicates normalized artist-title matches when a barcode is absent", () => {
    const selected = rankAndSelectCandidates(
      [
        {
          artist: "Dave Brubeck",
          candidateQualityScore: 90,
          condition: "new/sealed",
          id: "formatted",
          purchasePrice: 15.99,
          sourceId: "retailer-a",
          sourceListingTitle: "Dave Brubeck - Time Out [Vinyl LP]",
          sourceName: "Retailer A",
          title: "Time Out [Vinyl LP]",
        },
        {
          artist: "Dave Brubeck",
          candidateQualityScore: 80,
          condition: "new/sealed",
          id: "plain",
          purchasePrice: 13,
          sourceId: "retailer-b",
          sourceListingTitle: "Dave Brubeck: Time Out",
          sourceName: "Retailer B",
          title: "Time Out",
        },
      ],
      { limit: 80 },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("plain");
  });

  it("deduplicates unknown-artist Shopify products reached through multiple collections", () => {
    const selected = rankAndSelectCandidates(
      [
        {
          artist: "Unknown Artist",
          candidateQualityScore: 80,
          id: "sale-path",
          purchasePrice: 12,
          sourceId: "shop",
          sourceName: "Shop",
          sourceUrl: "https://shop.example/collections/sale/products/mcgruffs-smart-kids?utm_source=x",
          title: "McGruff's Smart Kids",
        },
        {
          artist: "Unknown Artist",
          candidateQualityScore: 80,
          id: "other-path",
          purchasePrice: 12,
          sourceId: "shop",
          sourceName: "Shop",
          sourceUrl: "https://shop.example/collections/cassettes/products/mcgruffs-smart-kids",
          title: "McGruff's Smart Kids",
        },
      ],
      { limit: 80 },
    );

    expect(selected).toHaveLength(1);
  });

  it("uses an 80-item budget across retailer families instead of letting Shopify monopolize it", () => {
    const shopify = familyCandidates({
      count: 120,
      family: "shopify",
      score: 300,
      sourceCount: 12,
      sourceCrawlType: "shopify-store",
      sourceGroup: "US retailers",
      sourceRetailType: "us_retailer",
    });
    const marketplaces = familyCandidates({
      count: 40,
      family: "marketplace",
      score: 120,
      sourceCount: 4,
      sourceCrawlType: "retailer",
      sourceGroup: "US retailers",
      sourceRetailType: "marketplace_retailer",
    });
    const labelStores = familyCandidates({
      count: 40,
      family: "label",
      score: 100,
      sourceCount: 4,
      sourceCrawlType: "shopify-store",
      sourceGroup: "Major label stores",
      sourceRetailType: "major_label_store",
    });

    const selected = rankAndSelectCandidates([...shopify, ...marketplaces, ...labelStores], {
      limit: 80,
    });

    expect(selected).toHaveLength(80);
    expect(selected.filter((candidate) => candidate.family === "shopify").length).toBeLessThanOrEqual(40);
    expect(selected.some((candidate) => candidate.family === "marketplace")).toBe(true);
    expect(selected.some((candidate) => candidate.family === "label")).toBe(true);
  });

  it("still fills the requested limit when scanning a deliberately narrow source subset", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      candidateQualityScore: 100 - index,
      id: `only-${index}`,
      sourceId: "only-store",
      sourceName: "Only Store",
      title: `Record ${index}`,
    }));

    expect(rankAndSelectCandidates(candidates, { limit: 5 })).toHaveLength(5);
  });
});

function familyCandidates({
  count,
  family,
  score,
  sourceCount,
  sourceCrawlType,
  sourceGroup,
  sourceRetailType,
}: {
  count: number;
  family: string;
  score: number;
  sourceCount: number;
  sourceCrawlType: string;
  sourceGroup: string;
  sourceRetailType: string;
}) {
  return Array.from({ length: count }, (_, index) => ({
    artist: `${family} artist ${index}`,
    candidateQualityScore: score - index / 100,
    family,
    id: `${family}-${index}`,
    purchasePrice: 13,
    sourceCrawlType,
    sourceGroup,
    sourceId: `${family}-source-${index % sourceCount}`,
    sourceName: `${family} source ${index % sourceCount}`,
    sourceRetailType,
    sourceUrl: `https://${family}-${index % sourceCount}.example/products/${index}`,
    title: `${family} album ${index}`,
  }));
}
