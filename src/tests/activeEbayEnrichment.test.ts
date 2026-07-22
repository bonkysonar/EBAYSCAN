import { describe, expect, it, vi } from "vitest";
import { buildActiveSearchProfile } from "../lib/arbitrage/activeEbayMatching.mjs";
import { enrichActiveEntry, searchVariantPages, type ActiveVariantResult } from "../../scripts/enrichArbitrageActiveEbay.mjs";
import type { ArbitrageFind } from "../lib/arbitrage/types";

function sourceFind(): ArbitrageFind {
  return {
    artist: "Artist",
    capturedAt: "2026-07-15T00:00:00.000Z",
    condition: "new/sealed",
    id: "active-enrichment",
    purchasePrice: 10,
    sourceId: "test",
    sourceListingTitle: "Artist - Great Escape Vinyl LP",
    sourceName: "Test",
    sourceUrl: "https://example.test",
    title: "Great Escape",
  };
}

function ebayItem(id: string, title: string, price: number) {
  return {
    condition: "Brand New",
    conditionId: "1000",
    itemId: id,
    itemLocation: { country: "US" },
    itemWebUrl: `https://www.ebay.com/itm/${id}`,
    price: { currency: "USD", value: String(price) },
    shippingOptions: [
      {
        shippingCost: { currency: "USD", value: "5" },
        shippingCostType: "FIXED",
      },
    ],
    title,
  };
}

describe("active eBay enrichment", () => {
  it("excludes the source eBay purchase listing from its own active comparisons", async () => {
    const find = {
      ...sourceFind(),
      ebayItemId: "v1|own-item|0",
      sourceId: "ebay-purchase",
      sourceUrl: "https://www.ebay.com/itm/own-item",
    } as ArbitrageFind & { ebayItemId: string };
    const profile = buildActiveSearchProfile(find)!;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemSummaries: [
            ebayItem("v1|own-item|0", "Artist Great Escape Vinyl LP New Sealed", 10),
            ebayItem("v1|real-comp|0", "Artist Great Escape Vinyl LP New Sealed", 20),
          ],
          total: 2,
        }),
        { status: 200 },
      ),
    );

    const result = await searchVariantPages("Artist Great Escape", profile, {
      env: { EBAY_DELIVERY_POSTAL_CODE: "19406", EBAY_ENV: "production", EBAY_MARKETPLACE_ID: "EBAY_US" },
      fetchImpl,
      maxPages: 1,
      pageLimit: 2,
      token: "test-token",
    });

    expect(result.excludedSourceListingCount).toBe(1);
    expect(result.listings.map((listing) => listing.id)).toEqual(["v1|real-comp|0"]);
    const [requestedUrl, requestInit] = fetchImpl.mock.calls[0];
    expect(new URL(String(requestedUrl)).searchParams.get("filter")).toContain(
      "conditionIds:{1000}",
    );
    expect(new Headers(requestInit?.headers).get("X-EBAY-C-ENDUSERCTX")).toBe(
      "contextualLocation=country%3DUS%2Czip%3D19406",
    );
  });

  it("paginates beyond ten results and counts only exact matched listings", async () => {
    const profile = buildActiveSearchProfile(sourceFind())!;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            itemSummaries: [
              ebayItem("cd", "Artist Great Escape 2CD Deluxe", 5),
              ebayItem("match-1", "Artist Great Escape Vinyl LP New Sealed", 20),
            ],
            next: "page-2",
            total: 4,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            itemSummaries: [
              ebayItem("match-2", "Artist Great Escape LP Vinyl Brand New", 18),
              ebayItem("other", "Different Artist Different Album Vinyl LP", 1),
            ],
            total: 4,
          }),
          { status: 200 },
        ),
      );

    const result = await searchVariantPages("Artist Great Escape", profile, {
      env: { EBAY_DELIVERY_POSTAL_CODE: "19406", EBAY_ENV: "production", EBAY_MARKETPLACE_ID: "EBAY_US" },
      fetchImpl,
      maxPages: 2,
      pageLimit: 2,
      token: "test-token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("offset"))).toEqual(["0", "2"]);
    expect(result).toMatchObject({
      pagesFetched: 2,
      rawListingsInspected: 4,
      searchComplete: true,
    });
    expect(result.listings.map((listing) => listing.id)).toEqual(["match-2", "match-1"]);
  });

  it("marks a capped search incomplete instead of claiming an exact active count", async () => {
    const profile = buildActiveSearchProfile(sourceFind())!;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemSummaries: [ebayItem("match-1", "Artist Great Escape Vinyl LP", 20)],
          next: "page-2",
          total: 100,
        }),
        { status: 200 },
      ),
    );

    const result = await searchVariantPages("Artist Great Escape", profile, {
      env: { EBAY_DELIVERY_POSTAL_CODE: "19406", EBAY_ENV: "production", EBAY_MARKETPLACE_ID: "EBAY_US" },
      fetchImpl,
      maxPages: 1,
      pageLimit: 1,
      token: "test-token",
    });

    expect(result.searchComplete).toBe(false);
  });

  it("makes active evidence incomplete when matching listings lack trustworthy landed shipping", async () => {
    const profile = buildActiveSearchProfile(sourceFind())!;
    const valid = ebayItem("valid", "Artist Great Escape Vinyl LP New Sealed", 20);
    const calculated = {
      ...ebayItem("calculated", "Artist Great Escape Vinyl LP New Sealed", 19),
      shippingOptions: [
        {
          shippingCost: { currency: "USD", value: "3" },
          shippingCostType: "CALCULATED",
          shipToLocationUsedForEstimate: { country: "US", postalCode: "19406" },
        },
      ],
    };
    const mixedCurrency = {
      ...ebayItem("mixed-currency", "Artist Great Escape Vinyl LP New Sealed", 18),
      shippingOptions: [
        {
          shippingCost: { currency: "CAD", value: "1" },
          shippingCostType: "FIXED",
          shipToLocationUsedForEstimate: { country: "US", postalCode: "19406" },
        },
      ],
    };
    const missingShipping = {
      ...ebayItem("missing-shipping", "Artist Great Escape Vinyl LP New Sealed", 17),
      shippingOptions: [],
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemSummaries: [valid, calculated, mixedCurrency, missingShipping],
          total: 4,
        }),
        { status: 200 },
      ),
    );

    const result = await searchVariantPages("Artist Great Escape", profile, {
      env: { EBAY_DELIVERY_POSTAL_CODE: "19406", EBAY_ENV: "production", EBAY_MARKETPLACE_ID: "EBAY_US" },
      fetchImpl,
      maxPages: 1,
      pageLimit: 4,
      token: "test-token",
    });

    expect(result.listings.map((listing) => listing.id)).toEqual(["valid"]);
    expect(result.searchComplete).toBe(false);
    expect(result.untrustedMatchedListingCount).toBe(3);
  });

  it("aborts a stalled Browse API request after the configured timeout", async () => {
    const profile = buildActiveSearchProfile(sourceFind())!;
    const fetchImpl = vi.fn((_url: URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    });

    await expect(
      searchVariantPages("Artist Great Escape", profile, {
        env: { EBAY_DELIVERY_POSTAL_CODE: "19406", EBAY_ENV: "production", EBAY_MARKETPLACE_ID: "EBAY_US" },
        fetchImpl: fetchImpl as typeof fetch,
        maxPages: 1,
        pageLimit: 1,
        requestTimeoutMs: 10,
        token: "test-token",
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("runs every query variant and deduplicates exact matches across them", async () => {
    const profile = buildActiveSearchProfile(sourceFind())!;
    const searched: string[] = [];
    const listing = {
      currency: "USD",
      id: "same-item",
      price: 20,
      shippingPrice: 5,
      title: "Artist Great Escape Vinyl LP",
      totalPrice: 25,
    };
    const searchVariant = async (keyword: string): Promise<ActiveVariantResult> => {
      searched.push(keyword);
      return {
        listings: [{ ...listing, matchedVariant: keyword }],
        pagesFetched: 1,
        rawListingsInspected: 5,
        searchComplete: true,
      };
    };

    const result = await enrichActiveEntry(
      {
        key: profile.key,
        primary: profile.primary,
        profile,
        variants: ["Artist Great Escape", "Great Escape LP"],
      },
      { searchVariant },
    );

    expect(searched).toEqual(["Artist Great Escape", "Great Escape LP"]);
    expect(result.activeListingCount).toBe(1);
    expect(result.rawListingsInspected).toBe(10);
    expect(result.searchComplete).toBe(true);
  });

  it("enriches a mixed-format Shopify product through its explicit vinyl variant", async () => {
    const profile = buildActiveSearchProfile({
      ...sourceFind(),
      shopifyVariantTitle: "Blue 2-LP",
      sourceListingTitle: "Artist - Great Escape (CD / Vinyl) - Blue 2-LP",
    });
    expect(profile).not.toBeNull();

    const result = await enrichActiveEntry(
      {
        key: profile!.key,
        primary: profile!.primary,
        profile: profile!,
        variants: profile!.variants,
      },
      {
        searchVariant: async (keyword) => ({
          listings: [
            {
              currency: "USD",
              id: "shopify-2lp",
              matchedVariant: keyword,
              price: 20,
              shippingPrice: 5,
              title: "Artist Great Escape Blue Vinyl 2LP New Sealed",
              totalPrice: 25,
            },
          ],
          pagesFetched: 1,
          rawListingsInspected: 1,
          searchComplete: true,
        }),
      },
    );

    expect(result).toMatchObject({
      activeListingCount: 1,
      matchConfidence: "high",
      searchComplete: true,
    });
  });

  it("stops subsequent variants on a non-JSON 429 response", async () => {
    const profile = buildActiveSearchProfile(sourceFind())!;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>rate limited</html>", {
        headers: { "Retry-After": "5" },
        status: 429,
        statusText: "Too Many Requests",
      }),
    );

    const result = await enrichActiveEntry(
      {
        key: profile.key,
        primary: profile.primary,
        profile,
        variants: ["Artist Great Escape", "Great Escape LP"],
      },
      {
        searchOptions: {
          env: { EBAY_DELIVERY_POSTAL_CODE: "19406", EBAY_ENV: "production", EBAY_MARKETPLACE_ID: "EBAY_US" },
          fetchImpl,
          maxPages: 1,
          token: "test-token",
        },
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Stopped the batch");
  });
});
