import { describe, expect, it } from "vitest";
import { discoverSaleLinks, extractPromoCode, hasCouponSignal, httpFailureKind, sourceEntryUrls } from "../../scripts/lib/retailSaleDiscovery.mjs";

describe("retail sale discovery", () => {
  it("falls back from a configured collection to the store homepage", () => {
    expect(sourceEntryUrls("https://example.com/collections/vinyl#inventory")).toEqual([
      "https://example.com/collections/vinyl",
      "https://example.com/",
    ]);
    expect(sourceEntryUrls("https://example.com/")).toEqual(["https://example.com/"]);
  });

  it("ranks same-store sale links and ignores product, account, and external links", () => {
    const html = `
      <a href="/collections/clearance">Clearance</a>
      <a href="/pages/summer-event">40% off all vinyl sitewide</a>
      <a href="/products/sale-album">Sale Album</a>
      <a href="/account">Sale account</a>
      <a href="https://unrelated.example/sale">External sale</a>
    `;

    expect(discoverSaleLinks(html, "https://shop.example/collections/vinyl")).toEqual([
      "https://shop.example/pages/summer-event",
      "https://shop.example/collections/clearance",
    ]);
  });

  it("caps discovered links and classifies stale paths separately from blocking", () => {
    const html = `<a href="/sale">Sale</a><a href="/clearance">Clearance</a>`;
    expect(discoverSaleLinks(html, "https://example.com/", 1)).toHaveLength(1);
    expect(httpFailureKind(404)).toBe("not_found");
    expect(httpFailureKind(403)).toBe("blocked");
    expect(httpFailureKind(503)).toBe("server_error");
  });

  it("does not mistake artist names containing Code for coupon codes", () => {
    expect(hasCouponSignal("Youth Code Zac Scheinbaum All Vinyl 12-inch LPs")).toBe(false);
    expect(extractPromoCode("Youth Code Zac Scheinbaum All Vinyl")).toBeNull();
    expect(hasCouponSignal("Save 40% on all vinyl with promo code SUMMER40")).toBe(true);
    expect(extractPromoCode("Save 40% on all vinyl with promo code SUMMER40")).toBe("SUMMER40");
  });
});
