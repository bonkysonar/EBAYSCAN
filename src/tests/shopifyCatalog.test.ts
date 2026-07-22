import { describe, expect, it } from "vitest";
import {
  extractShopifyCurrency,
  normalizeShopifyProducts,
  selectShopifyCollectionLanes,
  shopifyCatalogUrls,
} from "../../scripts/lib/shopifyCatalog.mjs";
import { assessRecordCandidate } from "../../scripts/lib/candidatePipeline.mjs";

describe("Shopify retail catalog ingestion", () => {
  it("keeps the configured lane and only the strongest additional sale lane", () => {
    expect(
      selectShopifyCollectionLanes(
        [
          "https://shop.example/collections/new-vinyl",
          "https://shop.example/collections/used-lps",
          "https://shop.example/collections/discounted",
          "https://shop.example/collections/accessories",
        ],
        "https://shop.example/collections/sale-vinyl",
      ),
    ).toEqual({
      candidateCount: 5,
      configuredExcluded: false,
      eligibleCount: 2,
      excludedCount: 2,
      omitted: [
        {
          context: "accessories",
          reason: "excluded_non_record_collection",
          url: "https://shop.example/collections/accessories",
        },
        {
          context: "used-lps",
          reason: "excluded_non_record_collection",
          url: "https://shop.example/collections/used-lps",
        },
        {
          context: "new-vinyl",
          reason: "not_sale_relevant",
          url: "https://shop.example/collections/new-vinyl",
        },
      ],
      omittedCount: 3,
      selected: [
        {
          context: "sale-vinyl",
          url: "https://shop.example/collections/sale-vinyl",
        },
        {
          context: "discounted",
          url: "https://shop.example/collections/discounted",
        },
      ],
      stopReason: null,
    });
  });

  it("chooses only sale-relevant lanes when the configured page is not a collection", () => {
    expect(
      selectShopifyCollectionLanes(
        [
          "https://shop.example/collections/new-arrivals",
          "https://shop.example/collections/vinyl",
          "https://shop.example/collections/clearance-records",
          "https://other.example/collections/sale-vinyl",
        ],
        "https://shop.example/",
      ).selected,
    ).toEqual([
      {
        context: "clearance-records",
        url: "https://shop.example/collections/clearance-records",
      },
    ]);
  });

  it("does not widen a configured vinyl lane into unrelated generic collections", () => {
    expect(
      selectShopifyCollectionLanes(
        [
          "https://shop.example/collections/new-arrivals",
          "https://shop.example/collections/all",
          "https://shop.example/collections/special-offers",
        ],
        "https://shop.example/collections/vinyl",
      ).selected,
    ).toEqual([
      {
        context: "vinyl",
        url: "https://shop.example/collections/vinyl",
      },
      {
        context: "special-offers",
        url: "https://shop.example/collections/special-offers",
      },
    ]);
  });

  it("rejects a configured non-record merchandise lane instead of silently scanning it", () => {
    expect(
      selectShopifyCollectionLanes(
        ["https://shop.example/collections/new-vinyl"],
        "https://shop.example/collections/used-lps",
      ),
    ).toEqual({
      candidateCount: 2,
      configuredExcluded: true,
      eligibleCount: 0,
      excludedCount: 1,
      omitted: [
        {
          context: "used-lps",
          reason: "excluded_non_record_collection",
          url: "https://shop.example/collections/used-lps",
        },
        {
          context: "new-vinyl",
          reason: "not_sale_relevant",
          url: "https://shop.example/collections/new-vinyl",
        },
      ],
      omittedCount: 2,
      selected: [],
      stopReason: "configured_collection_excluded",
    });
  });

  it("uses six collection lanes by default and reports concrete lanes omitted by the cap", () => {
    const selection = selectShopifyCollectionLanes(
      [
        "https://shop.example/collections/sale",
        "https://shop.example/collections/clearance",
        "https://shop.example/collections/outlet",
        "https://shop.example/collections/deals",
        "https://shop.example/collections/discounted",
        "https://shop.example/collections/last-chance",
        "https://shop.example/collections/warehouse-sale",
      ],
      "https://shop.example/collections/vinyl",
    );

    expect(selection.selected).toHaveLength(6);
    expect(selection.eligibleCount).toBe(8);
    expect(selection.stopReason).toBe("lane_limit_reached");
    expect(selection.omitted.filter((lane) => lane.reason === "lane_limit_reached")).toEqual([
      {
        context: "sale",
        reason: "lane_limit_reached",
        url: "https://shop.example/collections/sale",
      },
      {
        context: "warehouse-sale",
        reason: "lane_limit_reached",
        url: "https://shop.example/collections/warehouse-sale",
      },
    ]);
  });

  it("paginates configured collections and the full catalog", () => {
    expect(shopifyCatalogUrls({ url: "https://label.example/collections/sale" }, 2)).toEqual([
      {
        collectionContext: "sale",
        url: "https://label.example/collections/sale/products.json?limit=250&page=2",
      },
      {
        collectionContext: null,
        url: "https://label.example/products.json?limit=250&page=2",
      },
    ]);
  });

  it("can scan a configured collection without flooding the root catalog", () => {
    expect(
      shopifyCatalogUrls(
        { url: "https://label.example/collections/discounted" },
        1,
        250,
        { includeRootCatalog: false },
      ),
    ).toEqual([
      {
        collectionContext: "discounted",
        url: "https://label.example/collections/discounted/products.json?limit=250&page=1",
      },
    ]);
  });

  it("uses only available variants and preserves pricing and identifiers", () => {
    const products = [
      {
        handle: "artist-album",
        product_type: "Vinyl",
        title: "Artist - Album (Blue Vinyl LP)",
        variants: [
          { available: false, barcode: "OLD", compare_at_price: "30.00", price: "5.00", sku: "SOLD" },
          { available: true, barcode: "0123456789012", compare_at_price: "30.00", id: 22, price: "12.00", sku: "BLUE-LP" },
        ],
      },
      {
        handle: "sold-out-record",
        product_type: "Vinyl",
        title: "Artist - Sold Out LP",
        variants: [{ available: false, price: "8.00" }],
      },
    ];

    const result = normalizeShopifyProducts({
      assessment: assessRecordCandidate,
      collectionContext: "sale",
      currency: "USD",
      origin: "https://label.example",
      products,
      source: { id: "label", name: "Vinyl Label", priority: 1 },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      availableVariantCount: 1,
      barcode: "0123456789012",
      collectionContext: "sale",
      compareAtPrice: 30,
      currency: "USD",
      price: 12,
      sku: "BLUE-LP",
      variantId: 22,
    });
  });

  it("does not price an LP from a cheaper CD variant on the same product", () => {
    const result = normalizeShopifyProducts({
      assessment: assessRecordCandidate,
      currency: "USD",
      origin: "https://label.example",
      products: [
        {
          body_html: "Available on CD and vinyl.",
          handle: "artist-album",
          product_type: "CD / Vinyl",
          tags: ["CD", "Vinyl"],
          title: "Artist - Album",
          variants: [
            {
              available: true,
              id: 11,
              price: "12.00",
              title: "CD",
            },
            {
              available: true,
              id: 22,
              price: "30.00",
              title: "Blue Vinyl LP",
            },
          ],
        },
      ],
      source: { id: "label", name: "Vinyl Label", priority: 1 },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      listingTitle: "Artist - Album - Blue Vinyl LP",
      price: 30,
      productUrl: "https://label.example/products/artist-album?variant=22",
      variantId: 22,
      variantTitle: "Blue Vinyl LP",
    });
  });

  it("recognizes 2xLP as an explicit vinyl variant despite mixed CD metadata", () => {
    const result = normalizeShopifyProducts({
      assessment: assessRecordCandidate,
      currency: "USD",
      origin: "https://label.example",
      products: [
        {
          handle: "artist-double-album",
          product_type: "CD / Vinyl",
          tags: ["CD", "Vinyl"],
          title: "Artist - Double Album (CD / Vinyl)",
          variants: [
            { available: true, id: 31, price: "14.00", title: "CD" },
            { available: true, id: 32, price: "34.00", title: "2xLP" },
          ],
        },
      ],
      source: { id: "label", name: "Vinyl Label", priority: 1 },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      price: 34,
      productUrl: "https://label.example/products/artist-double-album?variant=32",
      variantId: 32,
      variantTitle: "2xLP",
    });
  });

  it("extracts the storefront currency when the JSON feed omits it", () => {
    expect(extractShopifyCurrency(['<script>Shopify.currency.active = "CAD";</script>'])).toBe("CAD");
  });
});
