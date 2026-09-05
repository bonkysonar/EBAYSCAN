import { describe, expect, it } from "vitest";
import {
  validateBrowserRetailObservations,
  browserObservationPage,
  browserSourceDiagnostics,
  browserProductCandidates,
} from "../../scripts/lib/browserRetailObservations.mjs";
import { reconcileSaleCampaigns } from "../../scripts/lib/saleCampaignLifecycle.mjs";
import { extractRetailCampaigns } from "../../scripts/lib/campaignOffers.mjs";
const now = "2026-09-05T01:00:00.000Z";
const sources = [
  {
    id: "test-shop",
    url: "https://shop.example/collections/vinyl",
    name: "Test Shop",
  },
];
const page = {
  sourceId: "test-shop",
  url: "https://shop.example/collections/old-sale",
  title: "404 Not Found - Test Shop",
  visibleText: "We can't find the page you're looking for",
  capturedAt: "2026-09-05T00:45:00.000Z",
  outcome: "not_found",
  links: [],
};
const document = (pages: unknown[]) => ({
  version: 1,
  captureMethod: "visible_browser",
  pages,
});
describe("visible browser retail observations", () => {
  it("binds Rough Trade price and availability to the expanded numeric variant", () => {
    const selectedText="LP - Ghostly Blue $9.99 In Stock Add to cart";
    const purchaseText=`Thrice Identity Crisis LP - Sea Blue $16.99 Out of Stock ${selectedText}`;
    const exact={sourceId:"rough-trade",url:"https://www.roughtrade.com/en-us/product/thrice/identity-crisis#123",title:"Thrice Identity Crisis",visibleText:`United States | USD ${purchaseText}`,purchaseBlockText:purchaseText,currencyEvidence:"United States | USD",selectedVariantEvidence:{variantId:"123",expanded:true,visibleText:selectedText},capturedAt:now,outcome:"available",links:[],productEvidence:{artist:"Thrice",title:"Identity Crisis",format:"LP - Ghostly Blue",price:9.99,currency:"USD",available:true,variantId:"123",customerLimit:1}};
    const roughSources=[{id:"rough-trade",url:"https://www.roughtrade.com/en-us/search"}];
    const parsed=validateBrowserRetailObservations(document([exact]),roughSources,now)[0];
    expect(parsed.productEvidence).toMatchObject({price:9.99,customerLimit:1});
    expect(parsed.selectedVariantEvidence?.variantId).toBe("123");
    expect(()=>validateBrowserRetailObservations(document([{...exact,productEvidence:{...exact.productEvidence,price:16.99}}]),roughSources,now)).toThrow(/price/);
    expect(()=>validateBrowserRetailObservations(document([{...exact,url:exact.url.replace("#123","#456")}]),roughSources,now)).toThrow(/variant/);
  });
  it("keeps bounded LP cards honest about currency, stock and missing artist", () => {
    const catalog = {
      ...page,
      outcome: "available",
      title: "Current vinyl",
      visibleText: "Visible catalog cards",
      catalogProducts: [
        {
          artist: "Miles Davis",
          title: "Kind Of Blue",
          format: "2xLP",
          price: 19.99,
          currency: "USD",
          available: true,
          url: "/products/kind-of-blue",
          visibleText: "Miles Davis Kind Of Blue 2xLP USD $19.99 Add to cart",
        },
        {
          artist: null,
          title: "Soundtrack",
          format: "LP",
          price: 12.99,
          currency: "USD",
          url: "/products/soundtrack",
          visibleText: "Soundtrack LP $12.99",
        },
        {
          artist: "Artist",
          title: "Sold Album",
          format: "LP",
          price: 9.99,
          available: true,
          url: "/products/sold",
          visibleText: "Artist Sold Album LP $9.99 Backorder",
        },
        {
          artist: "Artist",
          title: "Compact Disc",
          format: "CD",
          price: 5.99,
          url: "/products/cd",
          visibleText: "Artist Compact Disc CD $5.99",
        },
      ],
    };
    const parsed = validateBrowserRetailObservations(
      document([catalog]),
      sources,
      now,
    );
    expect(parsed[0].catalogProducts).toHaveLength(3);
    const candidates = browserProductCandidates(
      parsed,
      sources[0],
      (...values: unknown[]) => values.join("-"),
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      sourceCurrency: "USD",
      available: true,
      identityStatus: "resolved",
      retailObservationMethod: "visible_browser_catalog",
    });
    expect(candidates[1]).toMatchObject({
      sourceCurrency: null,
      identityStatus: "unresolved",
    });
    expect(candidates[1].available).toBeUndefined();
    expect(
      browserSourceDiagnostics(parsed, "test-shop").browserCatalogCoverage,
    ).toBe("bounded_visible_pages");
    const spoof = {
      ...catalog,
      catalogProducts: [
        { ...catalog.catalogProducts[0], artist: "Invented artist" },
      ],
    };
    expect(() =>
      validateBrowserRetailObservations(document([spoof]), sources, now),
    ).toThrow(/mismatch/);
  });
  it("reads real store-wide spelling and basket tiers without exaggerating scope or dollars", () => {
    const store = {
      id: "music-store",
      name: "Music Store",
      retailSourceType: "major_label_store",
    };
    const url = "https://shop.example/collections/summer-sale";
    const storewide = extractRetailCampaigns(
      store,
      "<p>25% OFF STORE WIDE. Excludes PRE-ORDERS</p>",
      url,
      now,
    );
    expect(storewide[0]).toMatchObject({
      discountPercent: 25,
      scope: "sitewide",
    });
    expect(storewide[0].campaignTerms.excludedTerms).toContain("PRE-ORDERS");
    const tiers = extractRetailCampaigns(
      store,
      "<p>Spend: $50 for 20% off, $75 for 25% off, $150 for $30 off.</p>",
      url,
      now,
    );
    expect(
      tiers.map((offer) => [
        offer.discountPercent,
        offer.campaignTerms.minimumSpend,
        offer.campaignTerms.fixedAmount,
      ]),
    ).toEqual([
      [20, 50, null],
      [25, 75, null],
      [null, 150, 30],
    ]);
    expect(
      extractRetailCampaigns(
        store,
        "<p>Shop the End of Summer Sale for 30% Off. Exclusions apply.</p>",
        url,
        now,
      )[0],
    ).toMatchObject({ discountPercent: 30, scope: "collection" });
  });
  it("accepts a fresh retailer 404, ignores aged evidence and rejects transport challenges", () => {
    expect(
      validateBrowserRetailObservations(document([page]), sources, now)[0]
        .outcome,
    ).toBe("not_found");
    for (const override of [
      { url: "https://other.example/collections/old-sale" },
      { visibleText: "Verifying your connection. Please wait." },
      { title: "Access denied", visibleText: "Access denied by the server." },
    ]) {
      expect(() =>
        validateBrowserRetailObservations(
          document([{ ...page, ...override }]),
          sources,
          now,
        ),
      ).toThrow();
    }
    expect(validateBrowserRetailObservations(document([{...page,capturedAt:"2026-09-04T12:00:00.000Z"}]),sources,now)).toEqual([]);
    expect(()=>validateBrowserRetailObservations(document([{...page,sourceId:"unknown",capturedAt:"2026-09-04T12:00:00.000Z"}]),sources,now)).toThrow();
  });
  it("escapes captured page text and removes account links", () => {
    const parsed = validateBrowserRetailObservations(
      document([
        {
          ...page,
          outcome: "available",
          title: "Music offers",
          visibleText: "Music offer <script>bad()</script>",
          links: [
            {
              url: "https://shop.example/account?token=private",
              text: "Account",
            },
            {
              url: "https://shop.example/products/record",
              text: "Artist - Record LP $10",
            },
          ],
        },
      ]),
      sources,
      now,
    )[0];
    expect(parsed.links).toHaveLength(1);
    expect(browserObservationPage(parsed).html).not.toContain("<script>");
  });
  it("creates a bounded product candidate only when identity, price, format and availability are visible", () => {
    const product = {
      ...page,
      outcome: "available",
      url: "https://shop.example/products/record?variant=123",
      title: "Artist - Album LP",
      visibleText: "Artist - Album LP $10.00 USD Add to cart",
      productEvidence: {
        artist: "Artist",
        title: "Album",
        format: "LP",
        price: 10,
        currency: "USD",
        available: true,
        variantId: "123",
      },
    };
    const parsed = validateBrowserRetailObservations(
      document([product]),
      sources,
      now,
    );
    expect(
      browserProductCandidates(parsed, sources[0], () => "candidate")[0],
    ).toMatchObject({
      artist: "Artist",
      title: "Album",
      purchasePrice: 10,
      physicalFormatConfirmed: true,
      capturedAt: product.capturedAt,
    });
    for (const override of [
      { price: 1 },
      { artist: "Different Artist" },
      { variantId: "456" },
      { barcode: "123456789012" },
      { available: false },
    ])
      expect(() =>
        validateBrowserRetailObservations(
          document([
            {
              ...product,
              productEvidence: { ...product.productEvidence, ...override },
            },
          ]),
          sources,
          now,
        ),
      ).toThrow();
  });
  it("ends only the exact removed campaign and leaves an unrelated blocked page unknown", () => {
    const campaigns = ["old-sale", "other-sale"].map((slug, index) => ({
      id: slug,
      sourceId: "test-shop",
      sourceName: "Test Shop",
      sourceUrl: `https://shop.example/collections/${slug}`,
      title: `${30 + index * 10}% off vinyl`,
      saleSignal: `${30 + index * 10}% off all vinyl`,
      saleScope: "vinyl-wide",
      saleDiscountPercent: 30 + index * 10,
      saleCampaignId: slug,
      saleStatus: "unknown",
      lastSeenAt: "2026-09-01T00:00:00.000Z",
    }));
    const diagnostics = browserSourceDiagnostics([page], "test-shop");
    const initial = reconcileSaleCampaigns({
      saleEvents: campaigns,
      observedAt: "2026-09-01T00:00:00.000Z",
      runId: "before-browser-run",
    });
    const result = reconcileSaleCampaigns({
      previousLedger: initial.ledger,
      saleEvents: [],
      sourceReports: [
        {
          id: "test-shop",
          status: "error",
          salePageHealth: "failed",
          ...diagnostics,
        },
      ],
      observedAt: now,
      runId: "fresh-browser-run",
    });
    expect(
      result.ledger.campaigns.find((row) =>
        row.sourceUrl.endsWith("/old-sale"),
      ),
    ).toMatchObject({
      saleStatus: "ended",
      saleEndReason: "source_page_removed",
    });
    expect(
      result.ledger.campaigns.find((row) =>
        row.sourceUrl.endsWith("/other-sale"),
      )?.saleStatus,
    ).toBe("unknown");
    const bounded = reconcileSaleCampaigns({previousLedger:initial.ledger,saleEvents:[],sourceReports:[{id:"test-shop",status:"partial",evidenceScope:"observed_public_pages_only",...diagnostics}],observedAt:now,runId:"bounded-browser-run"});
    const untouched = bounded.ledger.campaigns.find((row)=>row.sourceUrl.endsWith("/other-sale"));
    const original = initial.ledger.campaigns.find((row)=>row.sourceUrl.endsWith("/other-sale"));
    expect(untouched?.saleStatus).toBe(original?.saleStatus);
    expect(untouched?.saleLastCheckedAt).toBe(original?.saleLastCheckedAt);
    expect(untouched?.saleFailureCount).toBe(0);
  });
});
