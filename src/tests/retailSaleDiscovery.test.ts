import { describe, expect, it } from "vitest";
import {
  dedupeSaleCampaigns,
  discoverSaleLinks,
  extractPromoCode,
  hasBogoOfferSignal,
  hasCoherentSaleClaim,
  hasCouponSignal,
  httpFailureKind,
  isSaleSpecificUrl,
  sourceEntryUrls,
  sourceEntryTargetsWithPriorRechecks,
  verifiedSalePathOffer,
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

  it("keeps distinct configured sale hints when the configured page is already sale-specific", () => {
    const source = {
      salePathHints: [
        "/collections/deep-cuts-40-off-select-items",
        "/collections/sale",
        "/collections/50-off-select-vinyl",
      ],
      url: "https://example.com/collections/deep-cuts-40-off-select-items",
    };

    expect(isSaleSpecificUrl(source.url, source)).toBe(true);
    expect(sourceEntryUrls(source, { maxHintUrls: 3 })).toEqual([
      "https://example.com/collections/deep-cuts-40-off-select-items",
      "https://example.com/",
      "https://example.com/collections/sale",
      "https://example.com/collections/50-off-select-vinyl",
    ]);
  });

  it("keeps configured and homepage roles when prior campaign rechecks overlap them", () => {
    expect(
      sourceEntryTargetsWithPriorRechecks(
        {
          priorSaleUrls: [
            "https://example.com/collections/vinyl",
            "https://example.com/",
            "https://example.com/collections/clearance",
          ],
          url: "https://example.com/collections/vinyl",
        },
        { maxHintUrls: 0 },
      ),
    ).toEqual([
      { purpose: "configured", url: "https://example.com/collections/vinyl" },
      { purpose: "homepage", url: "https://example.com/" },
      {
        purpose: "prior-campaign-recheck",
        role: "sale",
        url: "https://example.com/collections/clearance",
      },
    ]);
  });

  it("prioritizes Shopify collection sale paths inside the bounded generic hint budget", () => {
    expect(
      sourceEntryUrls(
        {
          salePathHints: [
            "/sale",
            "/sales",
            "/clearance",
            "/outlet",
            "/deals",
            "/collections/sale",
            "/collections/clearance",
            "/collections/outlet",
          ],
          sourceType: "shopify-store",
          url: "https://example.com/collections/vinyl",
        },
        { maxHintUrls: 2 },
      ),
    ).toEqual([
      "https://example.com/collections/vinyl",
      "https://example.com/",
      "https://example.com/collections/sale",
      "https://example.com/collections/clearance",
    ]);
  });

  it("keeps source-specific Shopify hints ahead of the reordered generic suffix", () => {
    expect(
      sourceEntryUrls(
        {
          crawlType: "shopify-store",
          salePathHints: [
            "/collections/deep-cuts-40-off-select-items",
            "/collections/50-off-select-vinyl",
            "/sale",
            "/sales",
            "/clearance",
            "/outlet",
            "/collections/sale",
            "/collections/clearance",
          ],
          url: "https://example.com/collections/vinyl",
        },
        { maxHintUrls: 3 },
      ),
    ).toEqual([
      "https://example.com/collections/vinyl",
      "https://example.com/",
      "https://example.com/collections/deep-cuts-40-off-select-items",
      "https://example.com/collections/50-off-select-vinyl",
      "https://example.com/collections/sale",
    ]);
  });

  it("does not let exact duplicate or off-site hints consume the distinct hint budget", () => {
    expect(
      sourceEntryUrls(
        {
          salePathHints: [
            "/collections/sale",
            "https://other.example/collections/clearance",
            "/collections/sale",
            "/collections/outlet",
            "/collections/last-chance",
          ],
          url: "https://example.com/collections/sale",
        },
        { maxHintUrls: 2 },
      ),
    ).toEqual([
      "https://example.com/collections/sale",
      "https://example.com/",
      "https://example.com/collections/outlet",
      "https://example.com/collections/last-chance",
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

  it("requires the discount and vinyl scope to form one coherent claim", () => {
    expect(hasCoherentSaleClaim("Banner: 40% off all vinyl this weekend", "vinyl-wide")).toBe(true);
    expect(hasCoherentSaleClaim("Shop all vinyl apparel 40% off", "vinyl-wide")).toBe(false);
    expect(hasCoherentSaleClaim("All vinyl new releases and featured artists browse more apparel 40% off", "vinyl-wide")).toBe(false);
  });

  it("recognizes an exact percent-off retailer collection path without trusting up-to claims", () => {
    expect(
      verifiedSalePathOffer(
        "https://thesoundofvinyl.us/collections/deep-cuts-40-off-select-items?page=2",
      ),
    ).toMatchObject({
      discountPercent: 40,
      purchaseOfferVerification: "campaign_advertised",
      saleVerification: "discovery-lead",
      scope: "collection",
    });
    expect(
      verifiedSalePathOffer("https://shop.example/collections/up-to-70-off-select-items"),
    ).toBeNull();
    expect(verifiedSalePathOffer("https://shop.example/collections/vinyl")).toBeNull();
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
