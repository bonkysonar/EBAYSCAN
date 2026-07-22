import { describe, expect, it, vi } from "vitest";
import {
  assessEbayPurchaseDetail,
  assessEbayPurchaseItem,
  buildEbayPurchaseSearchUrl,
  DEFAULT_EBAY_PURCHASE_LANES,
  discoverEbayPurchases,
  ebayPurchaseOfferVerification,
  getEbayApplicationToken,
} from "../../scripts/lib/ebayPurchaseDiscovery.mjs";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";

const lane = {
  id: "vinyl-deals",
  query: "vinyl record",
  maxAllInPrice: 25,
};

describe("eBay purchase discovery", () => {
  it("prefers an explicit static application token without making a token request", async () => {
    const fetchImpl = vi.fn();
    const result = await getEbayApplicationToken({
      env: {
        EBAY_BROWSE_ACCESS_TOKEN: "static-test-token",
        EBAY_CLIENT_ID: "client-id",
        EBAY_CLIENT_SECRET: "client-secret",
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: true,
      credentialSource: "static_application_token",
      expiresInSeconds: null,
      status: "available",
      token: "static-test-token",
    });
  });

  it("obtains an application token with client_credentials when no static token exists", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
      );
      expect(String(init?.body)).toContain("grant_type=client_credentials");
      return jsonResponse({ access_token: "generated-test-token", expires_in: 7200 });
    });

    const result = await getEbayApplicationToken({
      env: { EBAY_CLIENT_ID: "client-id", EBAY_CLIENT_SECRET: "client-secret" },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      available: true,
      credentialSource: "client_credentials",
      expiresInSeconds: 7200,
      status: "available",
      token: "generated-test-token",
    });
  });

  it("reports missing application credentials without attempting a request", async () => {
    const fetchImpl = vi.fn();
    const result = await getEbayApplicationToken({ env: {}, fetchImpl: fetchImpl as typeof fetch });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      available: false,
      credentialSource: null,
      status: "unavailable",
      token: null,
    });
  });

  it("builds an official Browse search for new, fixed-price vinyl in the US", () => {
    const url = buildEbayPurchaseSearchUrl(lane, { offset: 100, pageSize: 100 });

    expect(url.origin).toBe("https://api.ebay.com");
    expect(url.pathname).toBe("/buy/browse/v1/item_summary/search");
    expect(url.searchParams.get("q")).toBe("vinyl record");
    expect(url.searchParams.get("category_ids")).toBe("176985");
    expect(url.searchParams.get("filter")).toBe(
      "conditionIds:{1000},buyingOptions:{FIXED_PRICE},deliveryCountry:US,itemLocationCountry:US,price:[..25],priceCurrency:USD",
    );
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("offset")).toBe("100");
    expect(url.searchParams.get("sort")).toBe("price");
  });

  it("builds non-overlapping price-band filters", () => {
    const url = buildEbayPurchaseSearchUrl(
      { id: "mid-band", query: "vinyl record", minItemPrice: 15, maxItemPrice: 30, maxAllInPrice: 45 },
      { pageSize: 100 },
    );
    expect(url.searchParams.get("filter")).toContain("price:[15..30]");
  });

  it("does not leave shipping-sized gaps between item-price bands", () => {
    const firstBand = DEFAULT_EBAY_PURCHASE_LANES[0];
    const assessed = assessEbayPurchaseItem(
      ebayItem({
        price: { currency: "USD", value: "14.00" },
        shippingOptions: [
          { shippingCost: { currency: "USD", value: "12.00" }, shippingCostType: "FIXED" },
        ],
      }),
      firstBand,
    );

    expect(assessed).toMatchObject({ accepted: true, candidate: { purchasePrice: 26 } });
  });

  it("encodes an optional destination postal code in the eBay end-user context header", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-EBAY-C-ENDUSERCTX")).toBe(
        "contextualLocation=country%3DUS%2Czip%3D19406",
      );
      return jsonResponse({ itemSummaries: [], total: 0 });
    });

    await discoverEbayPurchases({
      deliveryPostalCode: "19406",
      fetchImpl,
      lanes: [lane],
      token: "test-token",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors stricter caller-provided seller reputation thresholds", async () => {
    const result = await discoverEbayPurchases({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ itemSummaries: [ebayItem()], total: 1 }),
      ),
      lanes: [lane],
      minSellerFeedbackScore: 2_000,
      token: "test-token",
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics.rejectedByReason).toEqual({
      seller_reputation_below_threshold: 1,
    });
  });

  it("requires exact purchase evidence and computes item-plus-shipping price", () => {
    const accepted = assessEbayPurchaseItem(
      ebayItem({
        itemId: "v1|record-1|0",
        price: { value: "14.99", currency: "USD" },
        shippingOptions: [
          { shippingCost: { value: "5.00", currency: "USD" }, shippingCostType: "FIXED" },
          { shippingCost: { value: "3.50", currency: "USD" }, shippingCostType: "FIXED" },
        ],
        title: "Nina Simone - Pastel Blues (180g Vinyl LP) NEW SEALED",
      }),
      lane,
    );

    expect(accepted).toMatchObject({
      accepted: true,
      candidate: {
        artist: "Nina Simone",
        costs: { inboundShipping: 0 },
        ebayItemId: "v1|record-1|0",
        purchasePrice: 18.49,
        purchasePriceIncludesShipping: true,
        purchasePriceScope: "item_plus_listed_shipping_before_tax",
        sellerFeedbackPercentage: 99.8,
        sellerFeedbackScore: 1200,
        sourceItemPrice: 14.99,
        sourceShippingPrice: 3.5,
        title: "Pastel Blues (180g Vinyl LP) NEW SEALED",
      },
    });

    expect(
      assessEbayPurchaseItem(ebayItem({ buyingOptions: ["AUCTION"] }), lane),
    ).toEqual({ accepted: false, reason: "not_fixed_price" });
    expect(
      assessEbayPurchaseItem(ebayItem({ condition: "Used", conditionId: "3000" }), lane),
    ).toEqual({ accepted: false, reason: "not_new" });
    expect(
      assessEbayPurchaseItem(
        ebayItem({ leafCategoryIds: ["176984"], categories: [{ categoryId: "176984" }] }),
        lane,
      ),
    ).toEqual({ accepted: false, reason: "wrong_category" });
    expect(
      assessEbayPurchaseItem(ebayItem({ title: "Vinyl Record Storage Case with Handles" }), lane),
    ).toEqual({ accepted: false, reason: "non_record_title" });
    expect(
      assessEbayPurchaseItem(ebayItem({ title: "Artist Album Audio CD New" }), lane),
    ).toEqual({ accepted: false, reason: "non_record_title" });
    expect(
      assessEbayPurchaseItem(ebayItem({ shippingOptions: [] }), lane),
    ).toEqual({ accepted: false, reason: "shipping_unknown" });
    expect(
      assessEbayPurchaseItem(
        ebayItem({
          shippingOptions: [
            { shippingCost: { value: "4.00", currency: "USD" }, shippingCostType: "CALCULATED" },
          ],
        }),
        lane,
      ),
    ).toEqual({ accepted: false, reason: "shipping_quote_not_fixed" });
    expect(
      assessEbayPurchaseItem(ebayItem({ condition: "New other", conditionId: "1500" }), lane),
    ).toEqual({ accepted: false, reason: "not_new" });
    expect(
      assessEbayPurchaseItem(ebayItem({ itemLocation: { country: "GB" } }), lane),
    ).toEqual({ accepted: false, reason: "cross_border_origin" });
    expect(
      assessEbayPurchaseItem(ebayItem({ itemLocation: undefined }), lane),
    ).toEqual({ accepted: false, reason: "item_origin_unknown" });
    for (const title of [
      "Rumours Vinyl LP Outer Sleeve Protector",
      "Dark Side Vinyl LP Record Mailer",
      "Kind of Blue Vinyl LP Cleaning Brush",
      "Abbey Road Vinyl LP Inner Sleeves",
      "Rumours Vinyl LP Record Weight Stabilizer Clamp",
      "Kind of Blue Vinyl LP Anti Static Brush",
      "Purple Rain Vinyl LP Replacement Jacket Cover",
      "Abbey Road Vinyl LP Divider Tabs",
      "Beatles - Sgt Pepper Lonely Hearts Club Vinyl LP Replacement Sleeve",
      "M Bird Vinyl Record Paper Label Decal 4-inch",
      "Beatles Yellow Submarine Vinyl LP Mat",
      "The Beatles - Sgt Pepper Vinyl LP Platter Mat New",
      "The Beatles - Sgt Pepper Vinyl LP Wall Clock New",
      "Miles Davis Kind of Blue Vinyl LP Coasters Set New",
      "Decorative Jazz Vinyl Record Bowl New",
    ]) {
      expect(assessEbayPurchaseItem(ebayItem({ title }), lane)).toEqual({
        accepted: false,
        reason: "non_record_title",
      });
    }
    expect(
      assessEbayPurchaseItem(
        ebayItem({ seller: { feedbackPercentage: "96.9", feedbackScore: 1200, username: "risky" } }),
        lane,
      ),
    ).toEqual({ accepted: false, reason: "seller_reputation_below_threshold" });
    expect(
      assessEbayPurchaseItem(ebayItem({ seller: { username: "unknown-history" } }), lane),
    ).toEqual({ accepted: false, reason: "seller_reputation_missing" });
    expect(
      assessEbayPurchaseItem(
        ebayItem({ title: "Nina Simone - Pastel Blues - New Sealed" }),
        lane,
      ),
    ).toEqual({ accepted: false, reason: "record_signal_missing" });
    expect(
      assessEbayPurchaseItem(
        ebayItem({ title: "Nina Simone - Pastel Blues - New Sealed" }),
        lane,
        { requireTitleRecordSignal: false },
      ),
    ).toMatchObject({ accepted: true });
  });

  it("cannot become BUY from an active purchase listing without real sold evidence", () => {
    const assessed = assessEbayPurchaseItem(ebayItem(), lane);
    expect(assessed.accepted).toBe(true);
    if (!assessed.accepted) return;

    const result = evaluateOpportunity(
      {
        ...assessed.candidate,
        capturedAt: "2026-07-22T12:00:00.000Z",
      },
      {},
      "2026-07-22T12:05:00.000Z",
    );

    expect(result.status).not.toBe("BUY");
    expect(result.gates.soldEvidence).toBe(false);
  });

  it("requires both destination context and detail-aspect identity before trusting an eBay quote", () => {
    expect(ebayPurchaseOfferVerification({ shippingDestinationVerified: false })).toBe(
      "discovery_lead",
    );
    expect(ebayPurchaseOfferVerification({ shippingDestinationVerified: true })).toBe(
      "discovery_lead",
    );
    expect(ebayPurchaseOfferVerification({
      productIdentityVerification: "detail_aspects",
      shippingDestinationVerified: true,
    })).toBe(
      "official_api",
    );
  });

  it("uses official item aspects to distinguish records from label and decal accessories", () => {
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Type", value: "Label" },
          { name: "Format", value: "Non Adhesive Label" },
          { name: "Material", value: "Paper" },
        ],
        shortDescription: "Vinyl Record Paper Label Decal 4-inch",
      }),
    ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });
    for (const type of ["Clock", "Bowl", "Coaster"]) {
      expect(
        assessEbayPurchaseDetail({
          localizedAspects: [
            { name: "Type", value: type },
            { name: "Format", value: "Record" },
            { name: "Material", value: "Vinyl" },
          ],
        }),
      ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });
    }
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Type", value: "LP" },
          { name: "Format", value: "Record" },
          { name: "Material", value: "Vinyl" },
        ],
        shortDescription: "Decorative platter mat for turntables",
      }),
    ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });

    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Type", value: "LP" },
          { name: "Format", value: "Vinyl" },
          { name: "Material", value: "Vinyl" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Release Title", value: "Kind of Blue" },
          { name: "Record Grading", value: "Mint" },
          { name: "Record Label", value: "Columbia" },
        ],
        description: "New LP in its original sleeve.",
      }),
    ).toMatchObject({ reason: null, status: "verified" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Format", value: "Record" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Release Title", value: "Kind of Blue" },
          { name: "Record Grading", value: "Mint" },
          { name: "Record Size", value: "12 inch" },
          { name: "Record Label", value: "Columbia" },
        ],
      }),
    ).toMatchObject({ reason: null, status: "verified" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Binding", value: "lp_record" },
          { name: "Item Type Keyword", value: "vinyl" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Item Name", value: "Kind of Blue" },
          { name: "Release Title", value: "Kind of Blue" },
          { name: "Record Grading", value: "Mint" },
        ],
      }),
    ).toMatchObject({ reason: null, status: "verified" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Format", value: "Record" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Release Title", value: "Kind of Blue" },
        ],
      }),
    ).toMatchObject({ reason: "record_format_aspects_missing", status: "unknown" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Format", value: "Record" },
          { name: "Material", value: "Vinyl" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Release Title", value: "Kind of Blue" },
          { name: "Record Size", value: "12 inch" },
        ],
        shortDescription: "Handmade wall art from a recycled record",
      }),
    ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Binding", value: "lp_record" },
          { name: "Item Type Keyword", value: "vinyl" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Item Name", value: "Kind of Blue Wall Clock" },
        ],
      }),
    ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Binding", value: "lp_record" },
          { name: "Item Type Keyword", value: "vinyl" },
          { name: "Artist", value: "The Beatles" },
          { name: "Item Name", value: "Beatles Record Cufflinks" },
        ],
      }),
    ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });
    for (const contradictoryAspect of [
      { name: "Product Type", value: "Cufflinks" },
      { name: "Format", value: "Audio CD" },
    ]) {
      expect(
        assessEbayPurchaseDetail({
          localizedAspects: [
            { name: "Type", value: "LP" },
            { name: "Format", value: "Record" },
            { name: "Artist", value: "The Beatles" },
            { name: "Release Title", value: "Abbey Road" },
            { name: "Catalog Number", value: "PCS 7088" },
            contradictoryAspect,
          ],
        }),
      ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });
    }
    for (const localizedAspects of [
      [
        { name: "Type", value: "LP" },
        { name: "Format", value: "Vinyl" },
        { name: "Product", value: "Tote Bag" },
      ],
      [
        { name: "Type", value: "LP" },
        { name: "Format", value: "Record" },
        { name: "Item Name", value: "Beatles Vinyl Earrings" },
      ],
    ]) {
      expect(assessEbayPurchaseDetail({ localizedAspects })).toMatchObject({
        reason: "detail_identifies_accessory",
        status: "rejected",
      });
    }
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Format", value: "Record" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Release Title", value: "Kind of Blue" },
          { name: "Record Grading", value: "Mint" },
          { name: "Record Size", value: "12 inch" },
        ],
        description: "Drink coasters made from recycled records",
      }),
    ).toMatchObject({ reason: "detail_identifies_accessory", status: "rejected" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Type", value: "LP" },
          { name: "Format", value: "Vinyl" },
          { name: "Material", value: "Vinyl" },
        ],
      }),
    ).toMatchObject({ reason: "record_format_aspects_missing", status: "unknown" });
    expect(
      assessEbayPurchaseDetail({
        localizedAspects: [
          { name: "Type", value: "LP" },
          { name: "Format", value: "Vinyl" },
          { name: "Artist", value: "The Coasters" },
          { name: "Release Title", value: "The Coasters" },
          { name: "Catalog Number", value: "ATCO 33-101" },
        ],
      }),
    ).toMatchObject({ reason: null, status: "verified" });
  });

  it("enriches bounded candidates through getItem before marking product identity verified", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/item_summary/search")) {
        return jsonResponse({ itemSummaries: [ebayItem()], total: 1 });
      }
      expect(url.pathname).toContain("/buy/browse/v1/item/");
      return jsonResponse({
        localizedAspects: [
          { name: "Type", value: "LP" },
          { name: "Format", value: "Record" },
          { name: "Material", value: "Vinyl" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Release Title", value: "Kind of Blue" },
          { name: "Record Grading", value: "Mint" },
        ],
      });
    });

    const result = await discoverEbayPurchases({
      deliveryPostalCode: "19406",
      fetchImpl,
      lanes: [lane],
      maxDetailRequests: 1,
      token: "test-token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      productIdentityVerification: "detail_aspects",
      shippingDestinationVerified: true,
    });
    expect(result.candidates[0]).not.toHaveProperty("shippingDestinationPostalCode");
    expect(result.diagnostics.pageReports[0].requestedUrl).not.toContain("19406");
    expect(result.diagnostics.pageReports[0].resolvedUrl).not.toContain("19406");
    expect(ebayPurchaseOfferVerification(result.candidates[0])).toBe("official_api");
    expect(result.diagnostics.detailVerification).toMatchObject({
      rejectedCount: 0,
      requestsMade: 1,
      stopReason: "exhausted",
      verifiedCount: 1,
    });
  });

  it("drops a summary candidate when official detail identifies an accessory", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/item_summary/search")) {
        return jsonResponse({
          itemSummaries: [ebayItem({ title: "Limited Art Edition Vinyl LP" })],
          total: 1,
        });
      }
      return jsonResponse({
        localizedAspects: [
          { name: "Type", value: "Label" },
          { name: "Format", value: "Non Adhesive Label" },
          { name: "Material", value: "Paper" },
        ],
      });
    });

    const result = await discoverEbayPurchases({
      fetchImpl,
      lanes: [lane],
      maxDetailRequests: 1,
      token: "test-token",
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics.detailVerification).toMatchObject({
      rejectedCount: 1,
      stopReason: "exhausted",
      verifiedCount: 0,
    });
  });

  it("propagates detail-stage rate limiting into top-level coverage diagnostics", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/item_summary/search")) {
        return jsonResponse({
          itemSummaries: [
            ebayItem({ itemId: "v1|one|0" }),
            ebayItem({ itemId: "v1|two|0", title: "John Coltrane - Blue Train Vinyl LP" }),
          ],
          total: 2,
        });
      }
      return new Response("rate limited", {
        headers: { "Retry-After": "5" },
        status: 429,
      });
    });

    const result = await discoverEbayPurchases({
      fetchImpl,
      lanes: [lane],
      maxDetailRequests: 2,
      token: "test-token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      complete: false,
      rateLimited: true,
      retryAfterMs: 5_000,
      diagnostics: { stopReason: "rate_limited" },
    });
    expect(result.diagnostics.detailVerification).toMatchObject({
      attemptedCandidateCount: 1,
      rateLimited: true,
      skippedCount: 1,
      stopReason: "rate_limited",
    });
  });

  it("spreads bounded detail checks across discovery lanes", async () => {
    const detailedItemIds: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/item_summary/search")) {
        const query = url.searchParams.get("q");
        return query === "vinyl record"
          ? jsonResponse({
              itemSummaries: [
                ebayItem({ itemId: "v1|first-a|0" }),
                ebayItem({ itemId: "v1|first-b|0", title: "John Coltrane - Blue Train Vinyl LP" }),
              ],
              total: 2,
            })
          : jsonResponse({
              itemSummaries: [
                ebayItem({ itemId: "v1|second-a|0", title: "Nina Simone - Pastel Blues Vinyl LP" }),
              ],
              total: 1,
            });
      }
      detailedItemIds.push(decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
      return jsonResponse({
        localizedAspects: [
          { name: "Type", value: "LP" },
          { name: "Format", value: "Record" },
          { name: "Material", value: "Vinyl" },
          { name: "Artist", value: "Miles Davis" },
          { name: "Release Title", value: "Kind of Blue" },
          { name: "Record Grading", value: "Mint" },
        ],
      });
    });

    const result = await discoverEbayPurchases({
      fetchImpl,
      lanes: [lane, { id: "jazz", query: "jazz vinyl", maxAllInPrice: 25 }],
      maxDetailRequests: 2,
      maxLanes: 2,
      token: "test-token",
    });

    expect(detailedItemIds).toEqual(["v1|first-a|0", "v1|second-a|0"]);
    expect(result.candidates.map((candidate) => candidate.productIdentityVerification ?? null)).toEqual([
      "detail_aspects",
      "summary_only",
      "detail_aspects",
    ]);
    expect(result.diagnostics.detailVerification).toMatchObject({
      selectedCandidateCount: 2,
      selectedLaneCount: 2,
      selectionMode: "lane_round_robin",
    });
  });

  it("paginates bounded lanes serially and deduplicates repeat listings deterministically", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(`${url.searchParams.get("q")}:${url.searchParams.get("offset")}`);
      const query = url.searchParams.get("q");
      const offset = Number(url.searchParams.get("offset"));

      if (query === "vinyl record" && offset === 0) {
        return jsonResponse({
          total: 3,
          next: "https://api.ebay.com/next-page",
          itemSummaries: [
            ebayItem({ itemId: "v1|same|0", title: "Alice Coltrane - Journey in Satchidananda Vinyl LP" }),
            ebayItem({ itemId: "v1|noise|0", title: "Vinyl Record Cleaning Kit" }),
          ],
        });
      }
      if (query === "vinyl record" && offset === 2) {
        return jsonResponse({
          total: 3,
          itemSummaries: [
            ebayItem({
              itemId: "v1|second|0",
              price: { value: "9.00", currency: "USD" },
              title: "John Coltrane - Blue Train LP Vinyl",
            }),
          ],
        });
      }
      return jsonResponse({
        total: 2,
        itemSummaries: [
          ebayItem({
            itemId: "v1|same|0",
            price: { value: "10.00", currency: "USD" },
            shippingOptions: [
              { shippingCost: { value: "1.00", currency: "USD" }, shippingCostType: "FIXED" },
            ],
            title: "Alice Coltrane - Journey in Satchidananda Vinyl LP",
          }),
          ebayItem({ itemId: "v1|wrong-category|0", leafCategoryIds: ["11233"] }),
        ],
      });
    });

    const result = await discoverEbayPurchases({
      fetchImpl,
      lanes: [lane, { id: "jazz", query: "jazz vinyl", maxAllInPrice: 25 }],
      maxLanes: 2,
      maxPagesPerLane: 3,
      pageSize: 2,
      token: "test-token",
    });

    expect(calls).toEqual(["vinyl record:0", "vinyl record:2", "jazz vinyl:0"]);
    expect(result.complete).toBe(true);
    expect(result.soldDataIncluded).toBe(false);
    expect(result.evidenceScope).toBe("active_purchase_listings_only");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      discoveredByLanes: ["vinyl-deals", "jazz"],
      ebayItemId: "v1|same|0",
      purchasePrice: 11,
      sourceId: "ebay-purchase",
    });
    expect(result.candidates[1]).toMatchObject({
      discoveredByLanes: ["vinyl-deals"],
      ebayItemId: "v1|second|0",
      purchasePrice: 13,
    });
    expect(result.diagnostics).toMatchObject({
      duplicateCount: 1,
      lanesProcessed: 2,
      lanesRequested: 2,
      rawItemsSeen: 5,
      requestMode: "serial",
      requestsMade: 3,
      stopReason: "exhausted",
    });
    expect(result.diagnostics.pageReports).toEqual([
      expect.objectContaining({ laneId: "vinyl-deals", pageNumber: 1, rawItemCount: 2, status: "available" }),
      expect.objectContaining({ laneId: "vinyl-deals", pageNumber: 2, rawItemCount: 1, status: "available" }),
      expect.objectContaining({ laneId: "jazz", pageNumber: 1, rawItemCount: 2, status: "available" }),
    ]);
    expect(result.diagnostics.rejectedByReason).toEqual({
      non_record_title: 1,
      wrong_category: 1,
    });
  });

  it("marks capped coverage incomplete instead of implying exhaustive search", async () => {
    const result = await discoverEbayPurchases({
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          total: 50,
          next: "https://api.ebay.com/next-page",
          itemSummaries: [ebayItem({ itemId: "v1|one|0" })],
        }),
      ),
      lanes: [lane],
      maxPagesPerLane: 1,
      pageSize: 1,
      token: "test-token",
    });

    expect(result.complete).toBe(false);
    expect(result.rateLimited).toBe(false);
    expect(result.diagnostics.stopReason).toBe("page_cap");
    expect(result.diagnostics.laneReports[0]).toMatchObject({
      complete: false,
      pagesAttempted: 1,
      pagesSucceeded: 1,
      stopReason: "page_cap",
      totalReported: 50,
    });
  });

  it("halts all lanes on 429 and reports Retry-After without automatic retries", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { errors: [{ message: "Too many requests" }] },
        { headers: { "Retry-After": "3" }, status: 429 },
      ),
    );

    const result = await discoverEbayPurchases({
      fetchImpl,
      lanes: [lane, { id: "second", query: "soundtrack vinyl" }],
      maxLanes: 2,
      token: "test-token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      complete: false,
      rateLimited: true,
      retryAfterMs: 3_000,
      diagnostics: {
        lanesProcessed: 1,
        requestsMade: 1,
        stopReason: "rate_limited",
      },
    });
    expect(result.diagnostics.laneReports[0]).toMatchObject({
      complete: false,
      pagesAttempted: 1,
      pagesSucceeded: 0,
      stopReason: "rate_limited",
    });
    expect(result.diagnostics.pageReports[0]).toMatchObject({
      failureKind: "rate_limited",
      httpStatus: 429,
      status: "error",
    });
  });
});

function ebayItem(overrides: Record<string, unknown> = {}) {
  return {
    buyingOptions: ["FIXED_PRICE"],
    categories: [{ categoryId: "176985", categoryName: "Vinyl Records" }],
    condition: "New",
    conditionId: "1000",
    itemId: "v1|default|0",
    itemLocation: { country: "US", postalCode: "90210" },
    itemWebUrl: "https://www.ebay.com/itm/123456789",
    leafCategoryIds: ["176985"],
    price: { currency: "USD", value: "10.00" },
    seller: {
      feedbackPercentage: "99.8",
      feedbackScore: 1200,
      sellerAccountType: "BUSINESS",
      username: "trusted-records",
    },
    shippingOptions: [
      { shippingCost: { currency: "USD", value: "4.00" }, shippingCostType: "FIXED" },
    ],
    title: "Miles Davis - Kind of Blue Vinyl LP New Sealed",
    ...overrides,
  };
}

function jsonResponse(
  payload: unknown,
  options: { headers?: HeadersInit; status?: number } = {},
) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...options.headers },
    status: options.status ?? 200,
  });
}
