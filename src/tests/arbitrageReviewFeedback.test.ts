import { beforeEach, describe, expect, it } from "vitest";
import {
  loadReviewFeedback,
  pruneStaleRecordFeedback,
  pruneStaleSaleFeedback,
  recordOutcomeForFind,
  retailOfferFeedbackKey,
  saleCampaignObservationKey,
  saleFeedbackKey,
  saleOutcomeForCampaign,
  saveReviewFeedback,
  setRecordOutcome,
  setSaleOutcome,
} from "../lib/arbitrage/reviewFeedback";
import type { ArbitrageFind } from "../lib/arbitrage/types";

describe("arbitrage review feedback", () => {
  beforeEach(() => localStorage.clear());

  it("persists record and sale outcomes without mutating the previous state", () => {
    const initial = loadReviewFeedback();
    const withRecord = setRecordOutcome(initial, "find-1", "bought", "2026-07-15T10:00:00.000Z");
    const withSale = setSaleOutcome(withRecord, "campaign-1", "confirmed", "2026-07-15T10:01:00.000Z");
    saveReviewFeedback(withSale);

    expect(initial.recordOutcomes).toEqual({});
    expect(loadReviewFeedback()).toEqual(withSale);
  });

  it("removes cleared outcomes and prefers the stable campaign identity", () => {
    const feedback = setRecordOutcome(loadReviewFeedback(), "find-1", "false_positive");
    expect(setRecordOutcome(feedback, "find-1", null).recordOutcomes).toEqual({});
    expect(
      saleFeedbackKey({
        id: "sale-1",
        saleCampaignId: "campaign-1",
        saleFingerprint: "fingerprint-1",
      }),
    ).toBe("campaign-1");
  });

  it("releases record outcomes when a material offer field changes", () => {
    const original = recordFind(10);
    const changed = recordFind(8);
    const feedback = setRecordOutcome(
      loadReviewFeedback(),
      original.id,
      "false_positive",
      "2026-07-15T10:00:00.000Z",
      retailOfferFeedbackKey(original),
    );

    expect(recordOutcomeForFind(feedback, original)).toBe("false_positive");
    expect(recordOutcomeForFind(feedback, changed)).toBeUndefined();
    expect(pruneStaleRecordFeedback(feedback, [changed]).recordOutcomes).toEqual({});
  });

  it("releases sale outcomes when campaign content changes or reopens", () => {
    const original = saleCampaign("content-v1", null);
    const reopened = saleCampaign("content-v2", "2026-07-16T10:00:00.000Z");
    const key = saleFeedbackKey(original);
    const feedback = setSaleOutcome(
      loadReviewFeedback(),
      key,
      "expired",
      "2026-07-15T10:00:00.000Z",
      saleCampaignObservationKey(original),
    );

    expect(saleOutcomeForCampaign(feedback, original)).toBe("expired");
    expect(saleOutcomeForCampaign(feedback, reopened)).toBeUndefined();
    expect(pruneStaleSaleFeedback(feedback, [reopened]).saleOutcomes).toEqual({});
  });

  it("releases negative sale feedback when an unknown campaign is observed again", () => {
    const unknown = { ...saleCampaign("content-v1", null), saleStatus: "unknown" as const };
    const recovered = { ...unknown, saleStatus: "ongoing" as const };
    const key = saleFeedbackKey(unknown);
    const feedback = setSaleOutcome(
      loadReviewFeedback(),
      key,
      "false_positive",
      "2026-07-15T10:00:00.000Z",
      saleCampaignObservationKey(unknown),
    );

    expect(saleOutcomeForCampaign(feedback, unknown)).toBe("false_positive");
    expect(saleOutcomeForCampaign(feedback, recovered)).toBeUndefined();
    expect(pruneStaleSaleFeedback(feedback, [recovered]).saleOutcomes).toEqual({});
  });
});

function recordFind(purchasePrice: number): ArbitrageFind {
  return {
    artist: "Test Artist",
    capturedAt: "2026-07-15T10:00:00.000Z",
    condition: "new/sealed",
    id: "find-1",
    opportunityType: "product_deal",
    purchasePrice,
    sourceCurrency: "USD",
    sourceId: "test-store",
    sourceListingTitle: "Test Artist - Test Album Vinyl LP",
    sourceName: "Test Store",
    sourceUrl: "https://test-store.example/test-album",
    title: "Test Album",
  };
}

function saleCampaign(contentHash: string, reopenedAt: string | null): ArbitrageFind {
  return {
    artist: "Sale alert",
    capturedAt: "2026-07-15T10:00:00.000Z",
    id: "sale-1",
    opportunityType: "sitewide_sale",
    purchasePrice: 0,
    reopenedAt,
    saleCampaignId: "campaign-1",
    saleContentHash: contentHash,
    saleDiscountPercent: 40,
    saleScope: "vinyl-wide",
    saleSignal: "40% off vinyl",
    sourceId: "test-store",
    sourceName: "Test Store",
    sourceUrl: "https://test-store.example/sale",
    title: "40% sale",
  };
}
