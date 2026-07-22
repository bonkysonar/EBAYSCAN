import { describe, expect, it } from "vitest";
import {
  classifySourceCoverage,
  normalizeSaleCampaigns,
  normalizeSalePageUrl,
  normalizeSalePayload,
  normalizedSaleScope,
  summarizeSourceCoverage,
  type SaleObservation,
} from "../lib/arbitrage/saleCampaigns";

const CAPTURED_AT = "2026-07-22T12:00:00.000Z";

describe("sale campaign display normalization", () => {
  it("strips pagination, sort parameters, and Shopify collection tags", () => {
    expect(
      normalizeSalePageUrl(
        "https://www.example.com/collections/super-sale-lps/format_tape?page=2&sort_by=best-selling&tag=tapes&utm_source=email",
      ),
    ).toBe("example.com/collections/super-sale-lps");
    expect(normalizeSalePageUrl("https://example.com/sale/page/3?view=grid")).toBe("example.com/sale");
  });

  it("combines raw page fragments into one offer and retains observation counts", () => {
    const rows = [
      sale({
        id: "base",
        saleEvidence: "Garage Sale 2026",
        saleScope: "clearance",
        sourceUrl: "https://store.example/collections/garage-sale",
      }),
      sale({
        id: "page-two",
        saleEvidence: "Shop All Music Vinyl CDs Tapes Digital",
        saleScope: "vinyl-wide",
        sourceUrl: "https://store.example/collections/garage-sale?page=2",
      }),
      sale({
        id: "sorted",
        saleEvidence: "Garage Sale 2026",
        saleScope: "sitewide",
        sourceUrl: "https://store.example/collections/garage-sale?sort_by=best-selling",
      }),
    ];

    const normalized = normalizeSaleCampaigns(rows, rows);

    expect(normalized).toMatchObject({
      pageCount: 1,
      rawObservationCount: 3,
      retailerCount: 1,
      uniqueOfferCount: 1,
    });
    expect(normalized.campaigns[0]).toMatchObject({
      saleObservationCount: 3,
      saleObservationPageCount: 1,
      saleScope: "clearance",
    });
  });

  it("combines one quantified retailer offer across landing pages and discovery sources", () => {
    const rows = [
      sale({
        id: "tagged",
        saleDiscountPercent: 50,
        saleEvidence: "SUPER SALE - 50% OFF LPs - Tagged FORMAT_TAPE",
        saleScope: "clearance",
        sourceId: "lunchbox-records",
        sourceName: "Lunchbox Records",
        sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps/format_tape",
      }),
      sale({
        id: "collection",
        saleDiscountPercent: 50,
        sourceId: "lunchbox-records",
        sourceName: "Lunchbox Records",
        sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps",
      }),
      sale({
        id: "homepage",
        saleDiscountPercent: 50,
        sourceId: "lunchbox-records",
        sourceName: "Lunchbox Records",
        sourceUrl: "https://lunchboxrecords.com/",
      }),
      sale({
        id: "reddit",
        saleDiscountPercent: 50,
        saleVerification: "discovery-lead",
        sourceId: "reddit-vinyl-deals",
        sourceName: "Reddit VinylDeals",
        sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps?page=1",
      }),
    ];

    const normalized = normalizeSaleCampaigns(rows, rows);

    expect(normalized).toMatchObject({
      pageCount: 2,
      rawObservationCount: 4,
      retailerCount: 1,
      uniqueOfferCount: 1,
    });
    expect(normalized.campaigns[0]).toMatchObject({
      saleObservationCount: 4,
      saleObservationPageCount: 2,
      saleVerification: "retailer-page",
      sourceId: "lunchbox-records",
    });
  });

  it("does not collapse unrelated simultaneous offers from one retailer", () => {
    const rows = [
      sale({
        id: "clearance",
        saleDiscountPercent: 40,
        saleEvidence: "40% off warehouse clearance vinyl",
        sourceUrl: "https://store.example/collections/warehouse-clearance",
      }),
      sale({
        id: "bogo",
        saleDiscountPercent: null,
        saleEvidence: "Buy one get one free with code BOGOLP",
        saleSignal: "BOGO vinyl with promo code BOGOLP",
        sourceUrl: "https://store.example/pages/summer-bogo",
      }),
    ];

    const normalized = normalizeSaleCampaigns(rows, rows);

    expect(normalized.uniqueOfferCount).toBe(2);
    expect(normalized.retailerCount).toBe(1);
  });

  it("shows confirmed evidence once when the same offer also arrived as a lead", () => {
    const normalized = normalizeSaleCampaigns([
      sale({ id: "lead", saleVerification: "discovery-lead" }),
      sale({ id: "confirmed", saleVerification: "retailer-page" }),
    ]);

    expect(normalized.uniqueOfferCount).toBe(1);
    expect(normalized.campaigns[0]).toMatchObject({
      mergedCampaignIds: [],
      saleVerification: "retailer-page",
    });
  });

  it("prefers confirmed evidence over a newer conflicting lead on the same offer page", () => {
    const normalized = normalizeSaleCampaigns([
      sale({
        id: "confirmed",
        saleDiscountPercent: 50,
        saleStatus: "ongoing",
        saleVerification: "retailer-page",
      }),
      sale({
        id: "lead",
        saleDiscountPercent: 40,
        saleStatus: "new",
        saleVerification: "discovery-lead",
      }),
    ]);

    expect(normalized.uniqueOfferCount).toBe(1);
    expect(normalized.campaigns[0]).toMatchObject({
      saleDiscountPercent: 50,
      saleVerification: "retailer-page",
    });
  });

  it("supports legacy finds and newer ledger plus observation payloads", () => {
    const legacy = normalizeSalePayload({ finds: [sale()] });
    expect(legacy).toMatchObject({ rawObservationCount: 1, uniqueOfferCount: 1 });

    const active = sale({ id: "ledger", saleCampaignId: "campaign-ledger", saleStatus: "evergreen" });
    const ended = sale({
      id: "ended",
      saleCampaignId: "campaign-ended",
      saleDiscountPercent: 50,
      saleStatus: "ended",
      sourceUrl: "https://store.example/collections/clearance",
    });
    const modern = normalizeSalePayload({
      saleCampaignLedger: { campaigns: [active, ended] },
      saleEvents: [active],
      saleObservations: [sale({ id: "raw-a" }), sale({ id: "raw-b", sourceUrl: "https://store.example/collections/sale?page=2" })],
    });

    expect(modern.rawObservationCount).toBe(2);
    expect(modern.uniqueOfferCount).toBe(1);
    expect(modern.campaigns.some((campaign) => campaign.saleStatus === "ended")).toBe(true);
  });

  it("downgrades generic navigation scope without an economic offer", () => {
    const navOnly = sale({
      saleDiscountPercent: null,
      saleEvidence: "Store Shop All Products Pre-Orders New Releases Shop All Music Vinyl CDs Tapes Digital Shop All Merch",
      saleScope: "vinyl-wide",
      sourceUrl: "https://store.example/collections/music",
    });
    const explicit = sale({
      saleDiscountPercent: 40,
      saleEvidence: "40% off all vinyl",
      saleScope: "vinyl-wide",
    });

    expect(normalizedSaleScope(navOnly)).toBe("unknown");
    expect(normalizedSaleScope(explicit)).toBe("vinyl-wide");
  });
});

describe("sale source coverage", () => {
  it("requires meaningful parsing before calling a source healthy", () => {
    const reports = [
      { id: "productive", name: "Productive", productParseHealth: "productive", status: "candidates", url: "https://a.example" },
      {
        catalogHealth: "healthy",
        catalogPageAttemptCount: 2,
        id: "empty",
        name: "Empty",
        productParseHealth: "empty",
        status: "partial",
        url: "https://b.example",
      },
      { catalogHealth: "failed", id: "blocked", name: "Blocked", status: "error", url: "https://c.example" },
      {
        candidateCount: 12,
        id: "degraded",
        name: "Degraded",
        pageErrors: [{ failureKind: "not_found" }],
        status: "partial",
        url: "https://d.example",
      },
      { id: "unchecked", name: "Unchecked", status: "not_checked", url: "https://e.example" },
    ];

    expect(reports.map(classifySourceCoverage)).toEqual(["healthy", "empty", "blocked", "degraded", "not_checked"]);
    expect(summarizeSourceCoverage(reports)).toMatchObject({
      blocked: 1,
      degraded: 1,
      empty: 1,
      healthy: 1,
      not_checked: 1,
      total: 5,
    });
  });

  it("distinguishes failed sale-page checks from genuinely empty coverage", () => {
    const degraded = {
      catalogHealth: { status: "healthy" },
      catalogPageAvailableCount: 1,
      id: "degraded-sale-pages",
      name: "Degraded sale pages",
      pageErrors: [{ failureKind: "timeout" }],
      salePageHealth: { status: "failed" },
      status: "partial",
    };
    const blocked = {
      catalogHealth: "failed",
      id: "blocked-everywhere",
      name: "Blocked everywhere",
      pageErrors: [{ failureKind: "blocked" }],
      salePageHealth: "failed",
      status: "error",
    };
    const empty = {
      catalogHealth: "healthy",
      catalogPageAvailableCount: 1,
      id: "empty",
      name: "Empty",
      productParseHealth: "empty",
      salePageAvailableCount: 1,
      salePageHealth: "healthy",
      status: "empty",
    };

    expect([degraded, blocked, empty].map(classifySourceCoverage)).toEqual(["degraded", "blocked", "empty"]);
  });
});

function sale(overrides: Partial<SaleObservation> = {}): SaleObservation {
  return {
    artist: "Sale alert",
    capturedAt: CAPTURED_AT,
    id: "sale",
    opportunityType: "sitewide_sale",
    purchasePrice: 0,
    saleDiscountPercent: 30,
    saleEvidence: "30% off all vinyl",
    saleScope: "vinyl-wide",
    saleSignal: "Store has 30% off all vinyl",
    saleStatus: "ongoing",
    saleVerification: "retailer-page",
    sourceId: "store",
    sourceName: "Store",
    sourceUrl: "https://store.example/collections/sale",
    title: "Store sale",
    ...overrides,
  };
}
