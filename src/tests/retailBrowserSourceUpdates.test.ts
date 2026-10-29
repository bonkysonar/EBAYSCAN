import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyRetailerBrowserOffer } from "../../scripts/lib/retailBrowserOfferEvidence.mjs";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";
import { mergeVerifiedSourceUpdates } from "../server/retailSourceUpdates";
import type { ArbitrageFind, ArbitrageImportPayload } from "../lib/arbitrage/types";

vi.mock("../lib/arbitrage/vinylShopSources", () => ({
  getActiveRetailSources: () => [{ id: "reddit-vinyl-deals" }],
}));
import { assertFinalArbitragePayload, readLatestArbitrageFinds, uploadArbitrageFinds } from "../server/arbitrageFindsApi";

const now = "2026-10-29T15:00:00.000Z";
const observedAt = "2026-10-29T14:40:00.000Z";
const sourceId = "reddit-vinyl-deals";
const sourceUrl = "https://www.amazon.com/dp/B000ABCDEF";
const originReport = { id: sourceId, catalogHealth: "healthy", catalogPageAvailableCount: 1,
  productParseHealth: "productive", candidateCount: 20, salePageHealth: "healthy", salePageAvailableCount: 1 };

function observedOffer(capturedAt = observedAt, quotedFreeShipping = false): ArbitrageFind {
  const purchaseBlockText = "Vinyl\nBuy new\n$14.99\nIn stock\nAdd to cart\nSold by Amazon.com\nShips from Amazon.com" +
    (quotedFreeShipping ? "\nFree shipping" : "");
  const page = { sourceId, url: sourceUrl, outcome: "available", capturedAt,
    visibleText: `Audit Artist - Audit Album\n${purchaseBlockText}`, purchaseBlockText,
    productEvidence: { artist: "Audit Artist", title: "Audit Album", format: "Vinyl", price: 14.99, currency: "USD", available: true },
    retailerOfferEvidence: { retailerId: "amazon", productId: "B000ABCDEF", selectedFormat: true,
      selectedFormatText: "Vinyl", condition: "new", conditionText: "Buy new", priceText: "$14.99",
      availabilityText: "In stock", purchaseActionText: "Add to cart", sellerText: "Sold by Amazon.com", fulfillerText: "Ships from Amazon.com",
      ...(quotedFreeShipping ? { shippingEvidence: { amount: 0, currency: "USD", visibleText: "Free shipping" } } : {}) } };
  const result = verifyRetailerBrowserOffer({ id: "browser-audit-offer", sourceId, sourceUrl,
    sourceName: "Observed deals feed", artist: "Audit Artist", title: "Audit Album", purchasePrice: 20, capturedAt: now,
    opportunityType: "product_deal", costs: { inboundShipping: 0 } }, page, now);
  expect(result).not.toBeNull();
  return result as ArbitrageFind;
}

function payload(find: ArbitrageFind, publicationMode: "full" | "source_updates" = "source_updates"): ArbitrageImportPayload {
  return { schemaVersion: 2, phase: "final", publicationStatus: "final", runId: "browser-offer-test",
    source: "daily-vinyl-retail-arbitrage-scan", createdAt: now, finds: [find], publicationMode,
    sourceUpdateVersion: 1, sourceReports: [structuredClone(originReport)],
    runManifest: { scannedSourceCount: 1, sourceCatalogCount: 1, requestedSourceIds: [], startedAt: now, scannerVersion: "test" } };
}

function mutate(find: ArbitrageFind, patch: Record<string, unknown>): ArbitrageFind {
  return { ...structuredClone(find), ...patch } as ArbitrageFind;
}

const invalidChanges: Array<[string, Record<string, unknown>]> = [
  ["price", { purchasePrice: 1 }],
  ["USD price", { purchasePriceUsd: 1 }],
  ["currency", { sourceCurrency: "CAD" }],
  ["product identifier", { sourceUrl: "https://www.amazon.com/dp/B000XXXXXX" }],
  ["seller override", { sourceUrl: `${sourceUrl}?smid=another-seller` }],
  ["artist", { artist: "Different Artist" }],
  ["album", { title: "Different Album" }],
  ["format", { recordFormat: "CD" }],
  ["condition", { condition: "used" }],
  ["availability", { available: false }],
  ["discovery provenance", { sourceId: "slickdeals-vinyl-records" }],
  ["observation timestamp", { retailObservedAt: now }],
  ["capture timestamp", { capturedAt: now }],
  ["observation URL", { retailObservationUrl: "https://www.amazon.com/dp/B000XXXXXX" }],
  ["missing evidence", { retailerOfferObservation: undefined }],
  ["unknown shipping changed to free", { costs: { inboundShipping: 0 } }],
  ["inferred free-shipping threshold", { shippingOffer: { freeShippingThreshold: 35 } }],
];

describe("individual retailer browser offers at publication", () => {
  const originalToken = process.env.ARBITRAGE_UPLOAD_TOKEN;
  const originalBlob = process.env.BLOB_READ_WRITE_TOKEN;
  const workspaces: string[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(now)); });
  afterEach(() => {
    vi.useRealTimers();
    for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
    if (originalToken === undefined) delete process.env.ARBITRAGE_UPLOAD_TOKEN; else process.env.ARBITRAGE_UPLOAD_TOKEN = originalToken;
    if (originalBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = originalBlob;
  });

  it("accepts the exact fresh offer without inventing retailer or browser catalog coverage", () => {
    const find = observedOffer();
    const incoming = payload(find);
    const unchanged = structuredClone(incoming);
    const result = mergeVerifiedSourceUpdates(incoming, null, [sourceId], Date.parse(now));
    expect(result.finds).toEqual([find]);
    expect(result.finds[0].sourceId).toBe(sourceId);
    expect(result.finds[0].capturedAt).toBe(observedAt);
    expect(result.finds[0].costs?.inboundShipping).toBeUndefined();
    expect(result.sourceReports).toHaveLength(1);
    expect(result.sourceReports?.[0]).toMatchObject(originReport);
    for (const key of ["browserCatalogCoverage", "browserObservationCount", "browserObservedAt", "browserObservedUrls"])
      expect(result.sourceReports?.[0]).not.toHaveProperty(key);
    expect(result.sourceUpdates?.updatedSourceIds).toEqual([sourceId]);
    expect(incoming).toEqual(unchanged);
  });

  it("cannot replace failed origin catalog coverage with a successful retailer page", () => {
    const find = observedOffer();
    const incoming = payload(find);
    incoming.sourceReports = [{ ...originReport, catalogHealth: "failed", catalogPageAvailableCount: 0, productParseHealth: "failed" }];
    const prior = { ...find, id: "prior-offer", capturedAt: "2026-10-28T10:00:00.000Z" };
    const result = mergeVerifiedSourceUpdates(incoming, { createdAt: prior.capturedAt, finds: [prior] }, [sourceId], Date.parse(now));
    expect(result.finds).toEqual([prior]);
    expect(result.sourceReports?.[0]).toMatchObject({ catalogHealth: "failed", productParseHealth: "failed" });
    expect(result.sourceUpdates?.retainedSourceIds).toEqual([sourceId]);
  });

  it.each(invalidChanges)("rejects changed %s in both publication contracts", (_label, patch) => {
    const changed = mutate(observedOffer(), patch);
    expect(mergeVerifiedSourceUpdates(payload(changed), null, [sourceId], Date.parse(now)).finds).toEqual([]);
    for (const mode of ["full", "source_updates"] as const)
      expect(() => assertFinalArbitragePayload(payload(changed, mode))).toThrow("retailer browser offer evidence");
  });

  it("rejects stale or malformed evidence instead of silently accepting a claimed verified offer", () => {
    const valid = observedOffer();
    expect(() => assertFinalArbitragePayload(payload(valid, "full"))).not.toThrow();
    for (const retailerOfferObservation of [null, {}, { ...(valid as any).retailerOfferObservation, capturedAt: "2026-10-29T08:59:59.999Z" }]) {
      expect(() => assertFinalArbitragePayload(payload(mutate(valid, { retailerOfferObservation }), "full")))
        .toThrow("retailer browser offer evidence");
    }
    expect(() => assertFinalArbitragePayload(payload(mutate(valid, { retailObservationMethod: undefined }), "full")))
      .toThrow("retailer browser offer evidence");
  });

  it("rejects added raw account text instead of persisting it with product-only evidence", () => {
    const valid = observedOffer();
    const snapshot = valid.retailerOfferObservation!;
    for (const retailerOfferObservation of [
      { ...snapshot, rawAccountText: "private-account-sentinel" },
      { ...snapshot, visibleText: `${snapshot.visibleText}\nprivate-account-sentinel` },
    ]) {
      const changed = mutate(valid, { retailerOfferObservation });
      expect(mergeVerifiedSourceUpdates(payload(changed), null, [sourceId], Date.parse(now)).finds).toEqual([]);
      expect(() => assertFinalArbitragePayload(payload(changed, "full"))).toThrow("retailer browser offer evidence");
    }
  });

  it("keeps the six-hour boundary and does not refresh observation age at publication", () => {
    const find = observedOffer("2026-10-29T09:00:00.000Z");
    expect(mergeVerifiedSourceUpdates(payload(find), null, [sourceId], Date.parse(now)).finds).toHaveLength(1);
    expect(mergeVerifiedSourceUpdates(payload(find), null, [sourceId], Date.parse(now) + 1).finds).toEqual([]);
    vi.setSystemTime(new Date(Date.parse(now) + 1));
    expect(() => assertFinalArbitragePayload(payload(find, "full"))).toThrow("retailer browser offer evidence");
  });

  it("expires a published BUY in the shared evaluator immediately after six hours", () => {
    const find: ArbitrageFind = { ...observedOffer("2026-10-29T09:00:00.000Z", true), conservativeResalePrice: 40,
      ebayResearchStatus: "validated", ebayActiveSearchStatus: "available",
      activeEvidence: { capturedAt: observedAt, exactMatchedListingCount: 3, matchConfidence: "high", rawListingsInspected: 100,
        searchComplete: true, status: "available" },
      soldEvidence: { capturedAt: observedAt, condition: "new_sealed", conservativeResalePrice: 40, latestSaleDate: "2026-10-28",
        matchConfidence: "high", source: "local-own-sales-history", status: "validated", unitsSold30Days: 5,
        unitsSold90Days: 12, unitsSold365Days: 30 } };
    const fresh = evaluateOpportunity(find, {}, now);
    expect(fresh.decision).toBe("BUY");
    expect(fresh.gates).toMatchObject({ offerFreshness: true, purchaseOffer: true });
    const expired = evaluateOpportunity(find, { maxOfferAgeDays: 30 }, Date.parse(now) + 1);
    expect(expired.decision).not.toBe("BUY");
    expect(expired.gates).toMatchObject({ offerFreshness: false, purchaseOffer: false });
    expect(expired.reasons.some(reason => reason.includes("six hours"))).toBe(true);
    const malformed = evaluateOpportunity(mutate(find, { retailerOfferObservation: {} }), {}, now);
    expect(malformed.decision).not.toBe("BUY");
    expect(malformed.gates).toMatchObject({ offerFreshness: false, purchaseOffer: false });
    // Existing directly verified retailer offers retain their original age policy.
    const ordinary = { ...find, retailerOfferObservation: undefined, retailObservationMethod: undefined };
    expect(evaluateOpportunity(ordinary, {}, Date.parse(now) + 1).decision).toBe("BUY");
  });

  it("publishes and reads back the verified offer while retaining the normal BUY gate", async () => {
    process.env.ARBITRAGE_UPLOAD_TOKEN = "test-retailer-offer-token";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const workspace = mkdtempSync(join(tmpdir(), "retailer-offer-publication-"));
    workspaces.push(workspace);
    const find = observedOffer();
    expect(() => assertFinalArbitragePayload(payload(mutate(find, { decision: "BUY" }), "full")))
      .toThrow("canonical server evaluation");
    const result = await uploadArbitrageFinds(workspace, payload(find, "full"), "test-retailer-offer-token");
    expect(result.status).toBe("published");
    const latest = await readLatestArbitrageFinds(workspace);
    expect(latest.status).toBe("available");
    if (latest.status !== "available") throw new Error("Expected published offer");
    expect(latest.payload.finds).toHaveLength(1);
    expect(latest.payload.finds[0]).toMatchObject({ sourceId, sourceUrl, capturedAt: observedAt, purchasePrice: 14.99 });
    expect(latest.payload.finds[0].costs?.inboundShipping).toBeUndefined();
    expect(latest.payload.sourceReports).toHaveLength(1);
  });
});
