import { describe, expect, it } from "vitest";
import { assessBrowserRetailObservations, validateBrowserRetailObservations } from "../../scripts/lib/browserRetailObservations.mjs";

const now = "2026-10-13T14:00:00Z";
const sources = [{ id: "shop", url: "https://shop.example/collections/vinyl" }];
const fresh = { sourceId: "shop", capturedAt: now, url: "https://shop.example/products/album",
  outcome: "available", title: "Artist Album", visibleText: "Artist Album LP 20.00 USD in stock add to cart",
  productEvidence: { artist: "Artist", title: "Album", format: "LP", price: 20, currency: "USD", available: true } };
const doc = pages => ({ version: 1, captureMethod: "visible_browser", pages });

describe("retailer evidence archive admission", () => {
  it("keeps old malformed and unconfigured packets from aborting fresh verified evidence", () => {
    const payload = doc([
      { ...fresh, capturedAt: "2026-10-09T00:00:00Z", productEvidence: { ...fresh.productEvidence, currency: null } },
      { ...fresh, capturedAt: "2026-10-09T00:00:00Z", sourceId: "unconfigured" },
      fresh,
    ]);
    const before = JSON.stringify(payload);
    const result = assessBrowserRetailObservations(payload, sources, now);
    expect(result.summary).toEqual({ total: 3, accepted: 1, expired: 2, rejected: 0 });
    expect(result.pages[0].productEvidence.currency).toBe("USD");
    expect(JSON.stringify(payload)).toBe(before);
  });
  it("never admits fresh invalid data, access failures, private URLs or unconfigured leads", () => {
    const badCurrency = { ...fresh, productEvidence: { ...fresh.productEvidence, currency: null } };
    expect(() => validateBrowserRetailObservations(doc([badCurrency]), sources, now)).toThrow("currency");
    const result = assessBrowserRetailObservations(doc([
      badCurrency, { ...fresh, outcome: "access_failed" }, { ...fresh, sourceId: "unconfigured" },
      { ...fresh, url: "https://shop.example/account/profile" },
      { ...fresh, url: "https://secret:token@shop.example/products/album" },
      { ...fresh, capturedAt: "invalid" }, { ...fresh, capturedAt: "2027-01-01" },
    ]), sources, now);
    expect(result.pages).toEqual([]);
    expect(result.summary.rejected).toBe(7);
    expect(result.diagnostics.map(item => item.reason)).toContain("unconfigured_lead");
    expect(JSON.stringify(result)).not.toContain("secret:token");
  });
  it("fails closed on malformed document containers", () => {
    for (const value of [null, {}, { ...doc([]), pages: {} }, { ...doc([]), version: 0 }])
      expect(() => assessBrowserRetailObservations(value, sources, now)).toThrow("document");
  });
});
