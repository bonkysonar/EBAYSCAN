import { describe, expect, it } from "vitest";
import {
  dedupeSaleCampaigns,
  discoverSaleLinks,
  extractPromoCode,
  hasBogoOfferSignal,
  hasCouponSignal,
  httpFailureKind,
  isSaleSpecificUrl,
  sourceEntryUrls,
} from "../../scripts/lib/retailSaleDiscovery.mjs";

describe("retail sale discovery", () => {
  it("falls back from a configured collection to the store homepage", () => {
    expect(sourceEntryUrls("https://example.com/collections/vinyl#inventory")).toEqual([
      "https://example.com/collections/vinyl",
      "https://example.com/",
    ]);
    expect(sourceEntryUrls("https://example.com/")).toEqual(["https://example.com/"]);
  });

  it("turns configured sale path hints into explicit crawl targets", () => {
    expect(
      sourceEntryUrls(
        {
          salePathHints: ["/collections/deep-cuts", "/clearance"],
          url: "https://example.com/collections/vinyl",
        },
        { maxHintUrls: 2 },
      ),
    ).toEqual([
      "https://example.com/collections/vinyl",
      "https://example.com/",
      "https://example.com/collections/deep-cuts",
      "https://example.com/clearance",
    ]);
  });

  it("does not probe generic sale guesses when the configured page is already sale-specific", () => {
    const source = {
      salePathHints: ["/sale", "/sales", "/clearance"],
      url: "https://example.com/c/695/vinyl-clearance",
    };

    expect(isSaleSpecificUrl(source.url, source)).toBe(true);
    expect(sourceEntryUrls(source, { maxHintUrls: 3 })).toEqual([
      "https://example.com/c/695/vinyl-clearance",
      "https://example.com/",
    ]);
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

  it("honors source-specific sale URL patterns even when the link label is generic", () => {
    const html = `<a href="/collections/secret-drop">Browse collection</a>`;
    expect(
      discoverSaleLinks(html, "https://shop.example/", 5, {
        saleUrlPatterns: ["collections/secret-drop"],
      }),
    ).toEqual(["https://shop.example/collections/secret-drop"]);
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

  it("does not mistake Oog Bogo for a BOGO promotion", () => {
    expect(hasBogoOfferSignal("Oog Bogo - Plastic LP on Drag City Records")).toBe(false);
    expect(hasBogoOfferSignal("BOGO weekend sale on all vinyl")).toBe(true);
    expect(hasBogoOfferSignal("Buy one get one free")).toBe(true);
  });

  it("keeps multiple distinct campaigns from the same retailer", () => {
    const events = [
      { fingerprint: "summer", sourceId: "shop", title: "40% off sale" },
      { fingerprint: "bogo", sourceId: "shop", title: "BOGO sale" },
      { fingerprint: "summer", sourceId: "shop", title: "40% off sale duplicate" },
    ];

    expect(dedupeSaleCampaigns(events)).toEqual([events[0], events[1]]);
  });

  it("can collapse duplicate evidence fragments for the same normalized sale identity", () => {
    const events = [
      { fingerprint: "fragment-a", sourceId: "shop", sourceUrl: "https://shop.example/sale", title: "Header" },
      { fingerprint: "fragment-b", sourceId: "shop", sourceUrl: "https://shop.example/sale", title: "Body" },
    ];

    expect(
      dedupeSaleCampaigns(events, () => 0, (event) => `${event.sourceId}|${event.sourceUrl}`),
    ).toEqual([events[0]]);
  });
});
