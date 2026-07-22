import { describe, expect, it } from "vitest";
import {
  assessWalmartAbsolutePrice,
  extractWalmartStructuredPayloads,
  isFirstPartyWalmartOffer,
  parseWalmartCatalogPage,
} from "../../scripts/lib/walmartCatalog.mjs";

describe("Walmart structured catalog ingestion", () => {
  it("requires affirmative Walmart first-party seller evidence", () => {
    expect(isFirstPartyWalmartOffer({ soldByWalmart: true })).toBe(true);
    expect(isFirstPartyWalmartOffer({ soldByWalmart: false })).toBe(false);
    expect(isFirstPartyWalmartOffer({ soldByWalmart: null })).toBe(false);
  });

  it("parses search-result __NEXT_DATA__, deduplicates items, and exposes pagination", () => {
    const payload = {
      props: {
        pageProps: {
          initialData: {
            searchResult: {
              itemStacks: [
                {
                  items: [
                    {
                      usItemId: "854206001923",
                      name: "Garth Brooks - No Fences (Vinyl)",
                      canonicalUrl: "/ip/Garth-Brooks-No-Fences-Vinyl/854206001923?athbdg=L1100",
                      priceInfo: {
                        currentPrice: { currencyUnit: "USD", price: 12.91, priceString: "$12.91" },
                        unitPrice: { priceString: "$12.91/ea" },
                        wasPrice: { price: 19.97 },
                      },
                      sellerName: "Walmart.com",
                      sellerId: "F55CDC31AB754BB68FE0B39041159D63",
                      fulfillmentSummary: [
                        { fulfillment: "SHIPPING" },
                        { fulfillment: "PICKUP" },
                      ],
                      availabilityStatusDisplayValue: "In stock",
                      averageRating: 4.7,
                      numberOfReviews: 148,
                      badges: {
                        flags: [{ key: "BEST_SELLER", text: "Best seller" }],
                      },
                      upc: "854206001923",
                    },
                    {
                      usItemId: "854206001923",
                      name: "Garth Brooks - No Fences (Vinyl)",
                      canonicalUrl: "/ip/Garth-Brooks-No-Fences-Vinyl/854206001923",
                      fulfillmentOptions: [{ type: "DELIVERY" }],
                    },
                    {
                      usItemId: "1234567890",
                      name: "Deftones - White Pony (2LP)",
                      canonicalUrl: "/ip/Deftones-White-Pony-2LP/1234567890",
                      priceInfo: {
                        currentPrice: { priceString: "$17.68" },
                      },
                      availabilityStatusV2: { value: "LIMITED_STOCK" },
                      badges: [{ label: "Rollback" }],
                    },
                  ],
                },
              ],
              paginationV2: {
                currentPage: 1,
                maxPage: 11,
                pageSize: 40,
                totalCount: 412,
              },
            },
          },
        },
      },
    };
    const html = `<html><script type="application/json" id="__NEXT_DATA__">${JSON.stringify(payload)}</script></html>`;

    const result = parseWalmartCatalogPage({
      html,
      pageUrl: "https://www.walmart.com/search?q=vinyl+records&max_price=20",
    });

    expect(result.payloadCount).toBe(1);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      available: true,
      badges: ["Best seller"],
      canonicalUrl: "https://www.walmart.com/ip/Garth-Brooks-No-Fences-Vinyl/854206001923",
      currency: "USD",
      currentPrice: 12.91,
      fulfillment: ["shipping", "pickup", "delivery"],
      inventoryQuantity: null,
      rating: 4.7,
      reviewCount: 148,
      sellerId: "F55CDC31AB754BB68FE0B39041159D63",
      sellerName: "Walmart.com",
      sku: null,
      soldByWalmart: true,
      stableId: "walmart:item:854206001923",
      stockStatus: "in_stock",
      title: "Garth Brooks - No Fences (Vinyl)",
      unitPrice: 12.91,
      upc: "854206001923",
      usItemId: "854206001923",
      wasPrice: 19.97,
    });
    expect(result.items[1]).toMatchObject({
      available: true,
      badges: ["Rollback"],
      currentPrice: 17.68,
      stableId: "walmart:item:1234567890",
      stockStatus: "limited_stock",
    });
    expect(result.pagination).toEqual({
      currentPage: 1,
      hasNextPage: true,
      maxPage: 11,
      nextPage: 2,
      nextPageUrl: "https://www.walmart.com/search?q=vinyl+records&max_price=20&page=2",
      pageSize: 40,
      totalCount: 412,
    });
  });

  it("handles alternate module and product-page shapes and merges partial duplicates", () => {
    const result = parseWalmartCatalogPage(
      {
        props: {
          pageProps: {
            initialData: {
              contentLayout: {
                modules: [
                  {
                    configs: {
                      productList: {
                        items: [
                          {
                            productId: "987654321",
                            productTitle: "The Weeknd - Starboy (Red Vinyl)",
                            productPageUrl: "https://www.walmart.com/ip/Starboy/987654321?from=/search",
                            currentPrice: "$17.97",
                            comparisonPrice: { displayValue: "$29.98" },
                            seller: { displayName: "Record Vendor", id: "seller-1" },
                            fulfillmentOptions: {
                              shipping: { available: true },
                              pickup: { available: false },
                            },
                            stockStatus: "OUT_OF_STOCK",
                          },
                        ],
                      },
                    },
                  },
                ],
              },
              data: {
                product: {
                  usItemId: "987654321",
                  name: "The Weeknd - Starboy (Red Vinyl)",
                  canonicalURL: "/ip/Starboy/987654321",
                  offers: {
                    price: "17.97",
                    priceCurrency: "USD",
                  },
                  aggregateRating: {
                    ratingValue: "4.5",
                    reviewCount: "38",
                  },
                  availabilityStatus: "OUT_OF_STOCK",
                  gtin13: "0602557251234",
                },
              },
              searchResult: {
                pagination: {
                  currentPage: 3,
                  numPages: 3,
                  totalResults: 81,
                },
              },
            },
          },
        },
      },
      "https://www.walmart.com/search?q=vinyl&page=3",
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      available: false,
      canonicalUrl: "https://www.walmart.com/ip/Starboy/987654321",
      currentPrice: 17.97,
      rating: 4.5,
      reviewCount: 38,
      sellerId: "seller-1",
      sellerName: "Record Vendor",
      soldByWalmart: false,
      stableId: "walmart:item:987654321",
      stockStatus: "out_of_stock",
      upc: "0602557251234",
      wasPrice: 29.98,
    });
    expect(result.items[0].fulfillment).toEqual(["shipping"]);
    expect(result.pagination).toEqual({
      currentPage: 3,
      hasNextPage: false,
      maxPage: 3,
      nextPage: null,
      nextPageUrl: null,
      pageSize: null,
      totalCount: 81,
    });
  });

  it("accepts JSON-LD product evidence and ignores malformed structured scripts", () => {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Michael Jackson - Thriller (Vinyl)",
      sku: "thriller-vinyl",
      gtin13: "0194398781234",
      url: "https://www.walmart.com/ip/Thriller/44556677",
      offers: {
        "@type": "Offer",
        availability: "https://schema.org/InStock",
        price: "19.97",
        priceCurrency: "USD",
        seller: { "@type": "Organization", name: "Walmart.com" },
      },
      aggregateRating: {
        ratingValue: 4.8,
        reviewCount: 201,
      },
    };
    const html = [
      '<script id="__NEXT_DATA__" type="application/json">{not-json}</script>',
      `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
    ].join("");

    expect(extractWalmartStructuredPayloads(html)).toHaveLength(1);
    const result = parseWalmartCatalogPage(html, "https://www.walmart.com/ip/Thriller/44556677");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      available: true,
      currentPrice: 19.97,
      sellerName: "Walmart.com",
      soldByWalmart: true,
      stableId: "walmart:item:44556677",
      stockStatus: "in_stock",
      upc: "0194398781234",
      usItemId: "44556677",
    });
  });

  it("keeps meaningful retail badges while dropping Walmart module metadata", () => {
    const result = parseWalmartCatalogPage(
      {
        props: {
          pageProps: {
            product: {
              usItemId: "44556678",
              name: "Michael Jackson - Thriller (Vinyl)",
              canonicalUrl: "/ip/Thriller/44556678",
              price: 19.97,
              badges: [
                { type: "Base Badge", text: "Overall pick" },
                { key: "flags", label: "TEXT" },
                { name: "Prod Tile Badge Module5" },
              ],
            },
          },
        },
      },
      "https://www.walmart.com/ip/Thriller/44556678",
    );

    expect(result.items[0].badges).toEqual(["Overall pick"]);
  });

  it("extracts an assigned __NEXT_DATA__ object with balanced nested JSON", () => {
    const html =
      '<script>window.__NEXT_DATA__ = {"props":{"pageProps":{"initialData":{"searchResult":{"items":[{"usItemId":"77","name":"Artist - Album Vinyl","price":13.5,"canonicalUrl":"/ip/Album/77"}]}}}}};</script>';

    const result = parseWalmartCatalogPage(html, "https://www.walmart.com/search?q=vinyl");

    expect(result.payloadCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      currentPrice: 13.5,
      stableId: "walmart:item:77",
      usItemId: "77",
    });
    expect(result.pagination).toMatchObject({
      hasNextPage: false,
      nextPage: null,
      nextPageUrl: null,
    });
  });

  it("classifies the absolute-price lane without requiring a fixed profit rule", () => {
    expect(assessWalmartAbsolutePrice(15)).toEqual({
      eligible: true,
      price: 15,
      requiresDemandSupport: false,
      tier: "unconditional",
    });
    expect(assessWalmartAbsolutePrice("$17.97")).toEqual({
      eligible: true,
      price: 17.97,
      requiresDemandSupport: true,
      tier: "conditional",
    });
    expect(assessWalmartAbsolutePrice(20.01)).toEqual({
      eligible: false,
      price: 20.01,
      requiresDemandSupport: false,
      tier: "ineligible",
    });
    expect(
      assessWalmartAbsolutePrice(22, { conditionalMax: 25, unconditionalMax: 14 }),
    ).toMatchObject({
      eligible: true,
      requiresDemandSupport: true,
      tier: "conditional",
    });
  });
});
