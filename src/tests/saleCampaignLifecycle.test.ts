import { describe, expect, it } from "vitest";
import {
  hashSaleContent,
  priorSaleRecheckUrlsForSource,
  reconcileSaleCampaigns,
  saleCampaignIdFor,
  saleCampaignLedgerFromPayload,
  sourceSaleObservationHealth,
} from "../../scripts/lib/saleCampaignLifecycle.mjs";

const DAY_1 = "2026-07-13T12:00:00.000Z";
const DAY_2 = "2026-07-14T12:00:00.000Z";
const DAY_3 = "2026-07-15T12:00:00.000Z";

describe("sale campaign lifecycle", () => {
  it("keeps multiple campaigns for one source and tracks semantic content changes", () => {
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-day-1",
      saleEvents: [
        saleEvent({ saleDiscountPercent: 30, sourceUrl: "https://store.example/collections/sale" }),
        saleEvent({
          saleDiscountPercent: 50,
          saleScope: "clearance",
          saleSignal: "Store has 50% off warehouse clearance vinyl.",
          sourceUrl: "https://store.example/collections/warehouse",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(first.ledger.campaigns).toHaveLength(2);
    expect(first.activeSaleEvents.map((campaign) => campaign.saleStatus)).toEqual(["new", "new"]);
    expect(new Set(first.ledger.campaigns.map((campaign) => campaign.saleCampaignId)).size).toBe(2);

    const changed = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-day-2",
      saleEvents: [
        saleEvent({
          saleDiscountPercent: 40,
          saleSignal: "Store has 40% off all vinyl.",
          sourceUrl: "https://store.example/collections/sale",
        }),
        saleEvent({
          saleDiscountPercent: 50,
          saleScope: "clearance",
          saleSignal: "Store has 50% off warehouse clearance vinyl.",
          sourceUrl: "https://store.example/collections/warehouse",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(changed.ledger.campaigns).toHaveLength(2);
    expect(changed.ledger.campaigns.find((campaign) => campaign.sourceUrl.includes("/sale"))?.saleStatus).toBe("changed");
    expect(changed.ledger.campaigns.find((campaign) => campaign.sourceUrl.includes("/warehouse"))?.saleStatus).toBe("ongoing");
  });

  it("preserves same-page campaign identities when one of several offers changes", () => {
    const offerA = saleEvent({
      saleDiscountPercent: 30,
      saleFingerprint: "offer-a",
      saleSignal: "Store has 30% off all vinyl.",
    });
    const offerB = saleEvent({
      saleDiscountPercent: 40,
      saleFingerprint: "offer-b",
      saleSignal: "Store has 40% off all vinyl.",
    });
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-1",
      saleEvents: [offerA, offerB],
      sourceReports: [healthyReport()],
    });
    const idsByFingerprint = new Map(
      first.ledger.campaigns.map((campaign) => [campaign.saleFingerprint, campaign.saleCampaignId]),
    );
    const changedOfferB = {
      ...offerB,
      saleDiscountPercent: 50,
      saleFingerprint: "offer-b-updated",
      saleSignal: "Store has 50% off all vinyl.",
    };
    const second = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-2",
      saleEvents: [changedOfferB, offerA],
      sourceReports: [healthyReport()],
    });

    expect(second.ledger.campaigns.find((campaign) => campaign.saleFingerprint === "offer-a")).toMatchObject({
      saleCampaignId: idsByFingerprint.get("offer-a"),
      saleStatus: "ongoing",
    });
    expect(second.ledger.campaigns.find((campaign) => campaign.saleFingerprint === "offer-b-updated")).toMatchObject({
      saleCampaignId: idsByFingerprint.get("offer-b"),
      saleStatus: "changed",
    });
  });

  it("collapses duplicate page fragments for the same offer into one campaign", () => {
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-duplicate-fragments",
      saleEvents: [
        saleEvent({
          saleEvidence: "Header: vinyl clearance.",
          saleFingerprint: "header-fragment",
        }),
        saleEvent({
          saleEvidence: "Body: vinyl clearance products.",
          saleFingerprint: "body-fragment",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(first.ledger.campaigns).toHaveLength(1);
  });

  it("uses the shared garage-sale page identity across differing page fragments", () => {
    const result = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-garage-sale",
      saleEvents: [
        saleEvent({
          id: "garage-heading",
          saleDiscountPercent: null,
          saleEvidence: "Garage Sale 2026",
          saleFingerprint: "garage-heading",
          sourceId: "polyvinyl",
          sourceUrl: "https://polyvinylrecords.com/collections/garage-sale",
        }),
        saleEvent({
          id: "clearance-fragment",
          saleDiscountPercent: null,
          saleEvidence: "Clearance vinyl records and accessories",
          saleFingerprint: "clearance-fragment",
          sourceId: "polyvinyl",
          sourceUrl: "https://polyvinylrecords.com/collections/garage-sale",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(result.ledger.campaigns).toHaveLength(1);
    expect(result.ledger.campaigns[0]).toMatchObject({
      saleObservationCount: 2,
      saleObservationPageCount: 1,
    });
  });

  it("canonicalizes pagination, sort, and collection-tag observations without losing raw counts", () => {
    const urls = [
      "https://www.store.example/collections/super-sale-lps",
      "https://store.example/collections/super-sale-lps?sort_by=best-selling&page=2",
      "https://store.example/collections/super-sale-lps/format_tape?utm_source=email",
    ];
    const events = urls.map((sourceUrl, index) =>
      saleEvent({
        id: `sale-${index}`,
        saleDiscountPercent: 50,
        saleEvidence: "Super Sale: 50% off LPs",
        saleFingerprint: `page-fragment-${index}`,
        sourceUrl,
      }),
    );

    expect(new Set(events.map(saleCampaignIdFor)).size).toBe(1);
    const result = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-url-noise",
      saleEvents: events,
      sourceReports: [healthyReport()],
    });

    expect(result.ledger.campaigns).toHaveLength(1);
    expect(result.ledger.campaigns[0]).toMatchObject({
      saleObservationCount: 3,
      saleObservationPageCount: 1,
    });
  });

  it("merges retailer, tagged-page, homepage, and discovery observations for one quantified offer", () => {
    const observations = [
      saleEvent({
        id: "tagged",
        saleDiscountPercent: 50,
        saleEvidence: "SUPER SALE - 50% OFF LPs - Tagged FORMAT_TAPE",
        saleFingerprint: "tagged",
        saleScope: "clearance",
        sourceId: "lunchbox-records",
        sourceName: "Lunchbox Records",
        sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps/format_tape",
      }),
      saleEvent({
        id: "collection",
        saleDiscountPercent: 50,
        saleEvidence: "50% off all LPs",
        saleFingerprint: "collection",
        sourceId: "lunchbox-records",
        sourceName: "Lunchbox Records",
        sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps",
      }),
      saleEvent({
        id: "homepage",
        saleDiscountPercent: 50,
        saleEvidence: "Sale LPs 50% off",
        saleFingerprint: "homepage",
        sourceId: "lunchbox-records",
        sourceName: "Lunchbox Records",
        sourceUrl: "https://lunchboxrecords.com/",
      }),
      saleEvent({
        id: "reddit",
        saleDiscountPercent: 50,
        saleEvidence: "Lunchbox Records SUPER SALE - 50% OFF LPs",
        saleFingerprint: "reddit",
        saleVerification: "discovery-lead",
        sourceId: "reddit-vinyl-deals",
        sourceName: "Reddit VinylDeals",
        sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps?page=1",
      }),
    ];

    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-lunchbox",
      saleEvents: observations,
      sourceReports: [healthyReport()],
    });

    expect(first.ledger.campaigns).toHaveLength(1);
    expect(first.ledger.campaigns[0]).toMatchObject({
      saleDiscountPercent: 50,
      saleObservationCount: 4,
      saleObservationPageCount: 2,
      saleVerification: "retailer-page",
      sourceId: "lunchbox-records",
    });

    const changed = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-lunchbox-changed",
      saleEvents: [
        saleEvent({
          saleDiscountPercent: 40,
          saleEvidence: "SUPER SALE - 40% OFF LPs",
          saleFingerprint: "changed-offer",
          sourceId: "lunchbox-records",
          sourceName: "Lunchbox Records",
          sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps",
        }),
      ],
      sourceReports: [healthyReport()],
    });
    expect(changed.ledger.campaigns).toHaveLength(1);
    expect(changed.ledger.campaigns[0]).toMatchObject({
      saleCampaignId: first.ledger.campaigns[0].saleCampaignId,
      saleDiscountPercent: 40,
      saleStatus: "changed",
    });
  });

  it("coalesces duplicate campaigns from a legacy ledger on the next observation", () => {
    const legacyRows = [
      saleEvent({ saleCampaignId: "legacy-lunchbox-a", saleDiscountPercent: 50, sourceUrl: "https://lunchboxrecords.com/" }),
      saleEvent({ saleCampaignId: "legacy-lunchbox-b", saleDiscountPercent: 50, sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps" }),
    ].map((campaign) => ({
      ...campaign,
      firstSeenAt: DAY_1,
      lastSeenAt: DAY_1,
      saleStatus: "ongoing",
      sourceId: "lunchbox-records",
      sourceName: "Lunchbox Records",
    }));
    const result = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: {
        campaigns: legacyRows,
        history: [],
        runId: "legacy",
        schemaVersion: 1,
        updatedAt: DAY_1,
      } as never,
      runId: "migrated",
      saleEvents: [
        saleEvent({
          saleDiscountPercent: 50,
          sourceId: "lunchbox-records",
          sourceName: "Lunchbox Records",
          sourceUrl: "https://lunchboxrecords.com/collections/super-sale-lps",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(result.ledger.campaigns).toHaveLength(1);
  });

  it("returns bounded same-retailer campaign URLs for explicit rechecks", () => {
    const urls = priorSaleRecheckUrlsForSource(
      {
        campaigns: [
          { sourceId: "store", sourceUrl: "https://store.example/", saleStatus: "ongoing" },
          { sourceId: "store", sourceUrl: "https://store.example/collections/clearance", saleStatus: "unknown" },
          { sourceId: "store", sourceUrl: "https://elsewhere.example/sale", saleStatus: "unknown" },
          { sourceId: "store", sourceUrl: "https://store.example/collections/ended", saleStatus: "ended" },
        ],
      } as never,
      { id: "store", url: "https://www.store.example" },
      2,
    );

    expect(urls).toEqual([
      "https://store.example/collections/clearance",
      "https://store.example/",
    ]);
  });

  it("merges a discovery lead into retailer-confirmed evidence for the same offer", () => {
    const result = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-verification-upgrade",
      saleEvents: [
        saleEvent({
          id: "lead",
          saleDiscountPercent: 50,
          saleFingerprint: "lead-fingerprint",
          saleScope: "collection",
          saleVerification: "discovery-lead",
        }),
        saleEvent({
          id: "confirmed",
          saleDiscountPercent: 50,
          saleEvidence: "Retailer banner: 50% off select vinyl",
          saleFingerprint: "confirmed-fingerprint",
          saleScope: "deal-source",
          saleVerification: "retailer-page",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(result.ledger.campaigns).toHaveLength(1);
    expect(result.ledger.campaigns[0]).toMatchObject({
      saleDiscountPercent: 50,
      saleObservationCount: 2,
      saleVerification: "retailer-page",
    });
  });

  it("suppresses a conflicting URL-only discount when the retailer confirms that page", () => {
    const result = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-conflicting-lead",
      saleEvents: [
        saleEvent({
          id: "lead-40",
          saleDiscountPercent: 40,
          saleFingerprint: "lead-40",
          saleVerification: "discovery-lead",
        }),
        saleEvent({
          id: "confirmed-50",
          saleDiscountPercent: 50,
          saleEvidence: "Retailer banner: 50% off select vinyl",
          saleFingerprint: "confirmed-50",
          saleVerification: "retailer-page",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(result.ledger.campaigns).toHaveLength(1);
    expect(result.ledger.campaigns[0]).toMatchObject({
      saleDiscountPercent: 50,
      saleVerification: "retailer-page",
    });
  });

  it("downgrades navigation-only broad scope instead of presenting it as vinyl-wide", () => {
    const result = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-nav-scope",
      saleEvents: [
        saleEvent({
          saleDiscountPercent: null,
          saleEvidence: "Store Shop All Products Pre-Orders New Releases Shop All Music Vinyl CDs Tapes Digital Shop All Merch",
          saleScope: "vinyl-wide",
          saleSignal: "Store has a vinyl wide vinyl sale signal.",
          sourceUrl: "https://store.example/collections/music",
          title: "Broad sale: Store",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(result.activeSaleEvents[0].saleScope).toBe("unknown");
  });

  it("does not bind an apparel discount to adjacent all-vinyl navigation", () => {
    const result = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-mixed-context",
      saleEvents: [
        saleEvent({
          saleDiscountPercent: 40,
          saleEvidence: "Shop all vinyl apparel 40% off",
          saleScope: "vinyl-wide",
          saleSignal: "Store has 40% off all vinyl.",
        }),
      ],
      sourceReports: [healthyReport()],
    });

    expect(result.activeSaleEvents[0].saleScope).toBe("unknown");
  });

  it("does not treat evidence-only wording changes as a changed campaign", () => {
    const event = saleEvent({ saleEvidence: "Banner: 40% off all vinyl today.", saleDiscountPercent: 40 });
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-day-1",
      saleEvents: [event],
      sourceReports: [healthyReport()],
    });
    const secondEvent = { ...event, saleEvidence: "Banner: 40% off all vinyl now." };

    expect(hashSaleContent(secondEvent)).toBe(hashSaleContent(event));
    const second = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-day-2",
      saleEvents: [secondEvent],
      sourceReports: [healthyReport()],
    });

    expect(second.activeSaleEvents[0]).toMatchObject({
      lastSeenAt: DAY_2,
      saleMissCount: 0,
      saleObservedThisRun: true,
      saleScanCount: 2,
      saleStatus: "ongoing",
    });
    expect(second.activeSaleEvents[0].saleEvidenceHash).not.toBe(first.activeSaleEvents[0].saleEvidenceHash);
    expect(second.historyEvents).toEqual([
      expect.objectContaining({ reason: "confirmed_ongoing", toStatus: "ongoing" }),
    ]);
  });

  it("marks a failed source check unknown without counting a miss", () => {
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-day-1",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    });
    const failed = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-day-2",
      saleEvents: [],
      sourceReports: [{ id: "store", salePageHealth: { status: "blocked" }, status: "partial" }],
    });

    expect(failed.activeSaleEvents).toEqual([]);
    expect(failed.ledger.campaigns[0]).toMatchObject({
      lastSeenAt: DAY_1,
      saleFailureCount: 1,
      saleLastCheckedAt: DAY_2,
      saleMissCount: 0,
      saleObservedThisRun: false,
      saleStatus: "unknown",
    });
    expect(failed.historyEvents[0]).toMatchObject({
      fromStatus: "new",
      reason: "source_check_failed",
      toStatus: "unknown",
    });
  });

  it("ends a campaign only after two successful misses", () => {
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-day-1",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    });
    const missedOnce = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-day-2",
      saleEvents: [],
      sourceReports: [healthyReport()],
    });
    const ended = reconcileSaleCampaigns({
      observedAt: DAY_3,
      previousLedger: missedOnce.ledger,
      runId: "run-day-3",
      saleEvents: [],
      sourceReports: [healthyReport()],
    });

    expect(missedOnce.activeSaleEvents[0]).toMatchObject({ saleMissCount: 1, saleStatus: "ongoing" });
    expect(ended.activeSaleEvents).toEqual([]);
    expect(ended.ledger.campaigns[0]).toMatchObject({
      endedAt: DAY_3,
      lastSeenAt: DAY_1,
      saleMissCount: 2,
      saleStatus: "ended",
    });
  });

  it("does not count a miss when another sale page was checked but the campaign page was not", () => {
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-day-1",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    });
    const unchecked = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-day-2",
      saleEvents: [],
      sourceReports: [
        {
          id: "store",
          resolvedUrls: ["https://store.example/collections/warehouse"],
          salePageHealth: { status: "healthy" },
          status: "candidates",
        },
      ],
    });

    expect(unchecked.activeSaleEvents).toEqual([]);
    expect(unchecked.ledger.campaigns[0]).toMatchObject({
      saleFailureCount: 1,
      saleMissCount: 0,
      saleStatus: "unknown",
    });
  });

  it("counts a miss when the exact retailer homepage was successfully rechecked", () => {
    const homepageSale = saleEvent({ sourceUrl: "https://store.example/" });
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-day-1",
      saleEvents: [homepageSale],
      sourceReports: [healthyReport()],
    });
    const missedOnce = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-day-2",
      saleEvents: [],
      sourceReports: [
        {
          id: "store",
          resolvedUrls: ["https://store.example/"],
          salePageCheckedUrls: [],
          salePageHealth: "not_checked",
          status: "empty",
        },
      ],
    });

    expect(missedOnce.activeSaleEvents[0]).toMatchObject({
      saleFailureCount: 0,
      saleMissCount: 1,
      saleStatus: "ongoing",
    });
  });

  it("ends a missing discovery lead after repeated healthy feed checks", () => {
    const discoveryLead = saleEvent({
      saleVerification: "discovery-lead",
      sourceUrl: "https://retailer.example/products/deal-record",
    });
    const healthyFeedReport = {
      id: "store",
      resolvedUrls: ["https://www.reddit.com/r/VinylDeals/new/.rss"],
      salePageHealth: { status: "healthy" },
      status: "candidates",
    };
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      runId: "run-day-1",
      saleEvents: [discoveryLead],
      sourceReports: [healthyFeedReport],
    });
    const missedOnce = reconcileSaleCampaigns({
      observedAt: DAY_2,
      previousLedger: first.ledger,
      runId: "run-day-2",
      saleEvents: [],
      sourceReports: [healthyFeedReport],
    });
    const ended = reconcileSaleCampaigns({
      observedAt: DAY_3,
      previousLedger: missedOnce.ledger,
      runId: "run-day-3",
      saleEvents: [],
      sourceReports: [healthyFeedReport],
    });

    expect(missedOnce.activeSaleEvents[0]).toMatchObject({
      saleMissCount: 1,
      saleStatus: "ongoing",
    });
    expect(ended.activeSaleEvents).toEqual([]);
  });

  it("promotes a repeatedly observed campaign to evergreen", () => {
    let ledger = reconcileSaleCampaigns({
      observedAt: DAY_1,
      options: { evergreenAfterScans: 3 },
      runId: "run-1",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    }).ledger;

    ledger = reconcileSaleCampaigns({
      observedAt: DAY_2,
      options: { evergreenAfterScans: 3 },
      previousLedger: ledger,
      runId: "run-2",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    }).ledger;

    const third = reconcileSaleCampaigns({
      observedAt: DAY_3,
      options: { evergreenAfterScans: 3 },
      previousLedger: ledger,
      runId: "run-3",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    });

    expect(third.activeSaleEvents[0]).toMatchObject({ saleScanCount: 3, saleStatus: "evergreen" });
    expect(third.historyEvents[0]).toMatchObject({ reason: "evergreen_threshold_reached", toStatus: "evergreen" });
  });

  it("requires consecutive sightings before restoring evergreen after an unknown check", () => {
    const first = reconcileSaleCampaigns({
      observedAt: DAY_1,
      options: { evergreenAfterScans: 3 },
      runId: "run-1",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    });
    const second = reconcileSaleCampaigns({
      observedAt: DAY_2,
      options: { evergreenAfterScans: 3 },
      previousLedger: first.ledger,
      runId: "run-2",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    });
    const unknown = reconcileSaleCampaigns({
      observedAt: DAY_3,
      options: { evergreenAfterScans: 3 },
      previousLedger: second.ledger,
      runId: "run-3",
      saleEvents: [],
      sourceReports: [{ id: "store", salePageHealth: "failed" }],
    });
    const recovered = reconcileSaleCampaigns({
      observedAt: "2026-07-16T12:00:00.000Z",
      options: { evergreenAfterScans: 3 },
      previousLedger: unknown.ledger,
      runId: "run-4",
      saleEvents: [saleEvent()],
      sourceReports: [healthyReport()],
    });

    expect(recovered.activeSaleEvents[0]).toMatchObject({
      saleConsecutiveSeenCount: 1,
      saleScanCount: 3,
      saleStatus: "ongoing",
    });
  });

  it("migrates legacy sale events into a ledger", () => {
    const ledger = saleCampaignLedgerFromPayload({
      createdAt: DAY_1,
      runId: "legacy-run",
      saleEvents: [{ ...saleEvent(), firstSeenAt: DAY_1, saleScanCount: 4, saleStatus: "ongoing" }],
    });

    expect(ledger).toMatchObject({
      campaigns: [
        expect.objectContaining({
          firstSeenAt: DAY_1,
          lastSeenAt: DAY_1,
          saleMissCount: 0,
          saleScanCount: 4,
          saleStatus: "ongoing",
        }),
      ],
      runId: "legacy-run",
      schemaVersion: 1,
    });
  });

  it("uses sale-page health instead of catalog health for absence decisions", () => {
    expect(sourceSaleObservationHealth({ salePageHealth: { status: "healthy" }, status: "partial" })).toBe("success");
    expect(sourceSaleObservationHealth({ catalogHealth: { status: "healthy" }, salePageHealth: { status: "blocked" } })).toBe("unknown");
  });
});

function saleEvent(overrides: Record<string, unknown> = {}) {
  return {
    artist: "Sale alert",
    capturedAt: DAY_1,
    id: "sale-store",
    opportunityType: "sitewide_sale",
    purchasePrice: 0,
    saleDiscountPercent: 30,
    saleEvidence: "Banner: 30% off all vinyl.",
    saleFingerprint: "fingerprint-store-sale",
    saleScope: "vinyl-wide",
    saleSignal: "Store has 30% off all vinyl.",
    saleVerification: "retailer-page",
    sourceId: "store",
    sourceName: "Store",
    sourceUrl: "https://store.example/collections/sale",
    title: "30%+ sale: Store",
    ...overrides,
  };
}

function healthyReport() {
  return {
    id: "store",
    salePageHealth: { status: "healthy" },
    status: "candidates",
  };
}
