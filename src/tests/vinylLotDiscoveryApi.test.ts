import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { authorizeVinylLotScanRequest } from "../../api/vinyl-lots/scan";
import {
  buildVinylLotSearchUrl,
  scanVinylLots,
  VINYL_LOT_DEFAULT_SCAN_TIMEOUT_MS,
  VINYL_LOT_SEARCH_FAMILIES,
} from "../server/vinylLotDiscoveryApi";

describe("vinyl lot discovery API", () => {
  it("gives the hosted scan a 60-second function window before the 30-second API default", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      functions: Record<string, { maxDuration: number }>;
    };
    const patterns = Object.keys(config.functions);

    expect(config.functions["api/vinyl-lots/scan.ts"].maxDuration).toBe(60);
    expect(config.functions["api/**/*.ts"].maxDuration).toBe(30);
    expect(patterns.indexOf("api/vinyl-lots/scan.ts")).toBeLessThan(patterns.indexOf("api/**/*.ts"));
    expect(VINYL_LOT_DEFAULT_SCAN_TIMEOUT_MS).toBe(50_000);
    expect(config.functions["api/vinyl-lots/scan.ts"].maxDuration * 1_000 - VINYL_LOT_DEFAULT_SCAN_TIMEOUT_MS)
      .toBeGreaterThanOrEqual(10_000);
  });

  it("builds a bounded official Browse query for current US fixed-price lots", () => {
    const url = buildVinylLotSearchUrl(VINYL_LOT_SEARCH_FAMILIES[0]);

    expect(url.pathname).toBe("/buy/browse/v1/item_summary/search");
    expect(url.searchParams.get("category_ids")).toBe("176985");
    expect(url.searchParams.get("sort")).toBe("newlyListed");
    expect(url.searchParams.get("fieldgroups")).toBe("EXTENDED");
    expect(url.searchParams.get("filter")).toContain("conditions:{USED}");
    expect(url.searchParams.get("filter")).toContain("buyingOptions:{FIXED_PRICE|BEST_OFFER}");
    expect(url.searchParams.get("filter")).toContain("itemLocationCountry:US");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("deduplicates, removes noise, and returns only transient discovery evidence", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input)).searchParams.get("q") ?? "";
      const itemSummaries = query.includes("hip hop")
        ? [qualifyingItem(), choiceListing()]
        : query.includes("classic rock")
          ? [qualifyingItem()]
          : [];
      return new Response(JSON.stringify({ itemSummaries, total: itemSummaries.length }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    const result = await scanVinylLots(
      { EBAY_MARKETPLACE_ID: "EBAY_US" },
      {
        accessToken: "test-application-token",
        clock: () => new Date("2026-07-28T12:00:00.000Z"),
        fetchImpl: fetchMock,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].classification.status).toBe("qualifying");
    expect(result.listings[0].matchedSearchFamilyIds).toEqual(expect.arrayContaining(["hip-hop-collection", "classic-rock-collection"]));
    expect(result.diagnostics.duplicateCount).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.classificationCounts.rejected).toBe(1);
    expect(result.diagnostics.genreCoverage).toHaveLength(4);
    expect(result.diagnostics.genreCoverage.every((coverage) => coverage.status === "shortfall")).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.expiresAt).toBe("2026-07-28T18:00:00.000Z");
    expect(result.storage).toBe("transient-no-persistence");
    expect(result.soldDataIncluded).toBe(false);
    expect(result.schemaVersion).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/profit|roi|undervalued|maximum.?offer/i);
  });

  it("fails closed for hosted production scans and validates configured access keys", () => {
    expect(authorizeVinylLotScanRequest({}, { VERCEL_ENV: "production" })).toEqual({
      authorized: false,
      message: "VINYL_LOT_SCAN_TOKEN must be configured before production scans are enabled.",
      statusCode: 503,
    });
    expect(authorizeVinylLotScanRequest(
      { authorization: "Bearer correct-key" },
      { VERCEL_ENV: "production", VINYL_LOT_SCAN_TOKEN: "correct-key" },
    )).toEqual({ authorized: true });
    expect(authorizeVinylLotScanRequest(
      { authorization: "Bearer wrong-key" },
      { VERCEL_ENV: "production", VINYL_LOT_SCAN_TOKEN: "correct-key" },
    )).toMatchObject({ authorized: false, statusCode: 401 });
  });

  it("never exceeds the 20-call budget while expanding short genres with artists", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ itemSummaries: [], total: 0 }), { status: 200 }));
    const priorityArtists = Array.from({ length: 12 }, (_, index) => ({
      genre: "1990s-rock" as const,
      mode: "priority" as const,
      name: `Artist ${index + 1}`,
    }));

    const result = await scanVinylLots(
      { EBAY_MARKETPLACE_ID: "EBAY_US" },
      {
        accessToken: "test-application-token",
        fetchImpl: fetchMock,
        scanRequest: { priorityArtists },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(result.diagnostics.requestsMade).toBe(20);
    expect(result.diagnostics.limits.maxBrowseCalls).toBe(20);
    expect(result.complete).toBe(false);
  });

  it("stops starting Browse calls when the overall scan runtime budget expires", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      if (callCount <= 8) {
        return new Response(JSON.stringify({ itemSummaries: [], total: 0 }), { status: 200 });
      }

      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const priorityArtists = Array.from({ length: 12 }, (_, index) => ({
      genre: "1990s-rock" as const,
      mode: "priority" as const,
      name: `Artist ${index + 1}`,
    }));

    const result = await scanVinylLots(
      { EBAY_MARKETPLACE_ID: "EBAY_US" },
      {
        accessToken: "test-application-token",
        fetchImpl: fetchMock,
        requestTimeoutMs: 8_000,
        scanRequest: { priorityArtists },
        scanTimeoutMs: 100,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(result.diagnostics.requestsMade).toBe(12);
    expect(result.diagnostics.families).toHaveLength(20);
    expect(result.diagnostics.limits.scanTimeoutMs).toBe(100);
    expect(result.warnings).toContain("Vinyl-lot scan stopped at its 100 ms runtime budget; coverage may be incomplete.");
    expect(result.complete).toBe(false);
  });
});

function qualifyingItem() {
  return {
    buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
    condition: "Used",
    conditionId: "3000",
    image: { imageUrl: "https://i.ebayimg.com/images/g/test/s-l500.jpg" },
    itemId: "v1|lot-20|0",
    itemLocation: { country: "US", stateOrProvince: "CA" },
    itemOriginDate: "2026-07-28T10:00:00.000Z",
    itemWebUrl: "https://www.ebay.com/itm/lot-20",
    price: { currency: "USD", value: "80.00" },
    seller: { feedbackPercentage: "100.0", feedbackScore: 120, username: "seller" },
    shippingOptions: [{ shippingCost: { currency: "USD", value: "12.00" } }],
    shortDescription: "Twenty LP collection. Media visually graded VG+.",
    title: "Lot of 20 Hip-Hop Rap LP Records Nas Outkast VG+",
  };
}

function choiceListing() {
  return {
    buyingOptions: ["FIXED_PRICE"],
    condition: "Used",
    itemId: "v1|choice|0",
    itemLocation: { country: "US" },
    itemWebUrl: "https://www.ebay.com/itm/choice",
    price: { currency: "USD", value: "3.49" },
    title: "Hip-Hop Vinyl Records You Pick - $3.49 each",
  };
}
