import { selectDecisionList } from "../lib/arbitrage/decisionList.mjs";
import { saleCampaignIdFor } from "../../scripts/lib/saleCampaignLifecycle.mjs";
import { normalizeSaleCampaigns } from "../lib/arbitrage/saleCampaigns";
import { describe, expect, it } from "vitest";
import {
  extractRetailCampaigns,
  applyCampaignOffers,
  priceCampaignBasket,
} from "../../scripts/lib/campaignOffers.mjs";
import {
  retailEligibility,
  shopifyIdentity,
} from "../../scripts/lib/retailIdentity.mjs";
import { verifyRetailOffer } from "../../scripts/lib/retailOfferVerification.mjs";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";

const source = { id: "store", name: "Record Store" };
const at = "2026-09-04T12:00:00.000Z";
const collection = "https://store.example/collections/summer-sale";
const item = {
  id: "record",
  artist: "Artist",
  title: "Album",
  sourceId: "store",
  sourceName: "Store",
  sourceUrl: "https://store.example/products/artist-album",
  collectionContexts: ["summer-sale"],
  purchasePrice: 40,
  sourceCurrency: "USD",
  capturedAt: at,
};
const campaign = (text: string) =>
  extractRetailCampaigns(source, `<p>${text}</p>`, collection, at)[0];

describe("real retail scanner failure regressions", () => {
  it("lets a valid 20% campaign create a worthwhile record with one explicit checkout check", () => {
    const find: any = {
      ...item,
      purchasePrice: 30,
      condition: "new/sealed",
      purchaseOfferVerification: "direct_retailer",
      costs: { inboundShipping: 0 },
      activeEvidence: {
        capturedAt: at,
        status: "available",
        exactMatchedListingCount: 3,
        matchConfidence: "high",
        searchComplete: true,
      },
      soldEvidence: {
        capturedAt: at,
        condition: "new_sealed",
        conservativeResalePrice: 52,
        latestSaleDate: "2026-09-02",
        matchConfidence: "high",
        source: "local-own-sales-history",
        status: "validated",
        unitsSold30Days: 5,
        unitsSold90Days: 12,
        unitsSold365Days: 30,
      },
    };
    const before = evaluateOpportunity(find, {}, at);
    const after = evaluateOpportunity(
      applyCampaignOffers([find], [campaign("20% off all vinyl")], at)[0],
      {},
      at,
    );
    expect(selectDecisionList([before], { now: Date.parse(at) })).toHaveLength(
      0,
    );
    expect(after.expectedNetProfit).toBe(8.02);
    expect(after.decision).toBe("REVIEW");
    expect(selectDecisionList([after], { now: Date.parse(at) })).toHaveLength(
      1,
    );
  });
  it("preserves distinct scopes through lifecycle and display normalization", () => {
    const offers = extractRetailCampaigns(
      source,
      "<p>30% off sitewide</p><h1>50% off selected vinyl</h1>",
      collection,
      at,
    ).map((c) => ({
      ...item,
      ...c,
      opportunityType: "sitewide_sale" as const,
      saleScope: c.scope,
      saleDiscountPercent: c.discountPercent,
      saleEvidence: c.evidence,
    }));
    const ids = offers.map((c) => saleCampaignIdFor(c));
    expect(new Set(ids).size).toBe(2);
    expect(normalizeSaleCampaigns(offers).campaigns).toHaveLength(2);
  });
  it("rejects physical merchandise even when an artist and sale collection match", () => {
    const identity = shopifyIdentity(
      {
        title: "Wrapping Paper Set",
        type: "Other",
        tags: ["artist: A Singer", "Merch", "Summer Sale"],
      },
      { title: "Default Title" },
    );
    expect(retailEligibility(identity).eligible).toBe(false);
  });
  it("recognizes a 20% music sale independently of home decor and shipping", () => {
    const offers = extractRetailCampaigns(
      source,
      "<p>Get 20% off music & merch, up to 15% off home decor, and free US shipping on orders $85+ through Labor Day. See Details & Exclusions.</p>",
      collection,
      at,
    );
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      discountPercent: 20,
      scope: "vinyl-wide",
      campaignTerms: { freeShippingMinimum: 85, minimumSpend: null },
    });
    expect(applyCampaignOffers([item], offers, at)[0].purchasePrice).toBe(32);
  });
  it("keeps a selected 50% offer separate from a 30% sitewide banner", () => {
    const offers = extractRetailCampaigns(
      source,
      "<title>50% off Select Vinyl - Store</title><p>30% Off Sitewide (exclusions apply)</p>",
      collection,
      at,
    );
    expect(offers.map((x) => [x.discountPercent, x.scope])).toEqual([
      [50, "collection"],
      [30, "sitewide"],
    ]);
    const outside = { ...item, collectionContexts: ["ordinary"] };
    expect(applyCampaignOffers([outside], offers, at)[0].purchasePrice).toBe(
      40,
    );
  });
  it("excludes Funko vinyl promotions, digital albums, damaged jackets and preorders", () => {
    expect(
      campaign("EXTRA 20% OFF - USE CODE FUNKO20 FUNKO POP! VINYL CLEARANCE"),
    ).toBeUndefined();
    for (const title of [
      "Album - Digital Album",
      "Artist - Album LP (Damaged Jacket)",
      "Album - Dented Jacket LP",
      "Album LP B-STOCK",
      "Artist - Album LP Pre-order",
    ])
      expect(retailEligibility({ sourceListingTitle: title }).eligible).toBe(
        false,
      );
  });
  it("does not turn color descriptions into release titles or artist names", () => {
    expect(
      shopifyIdentity({
        title: "Nearsighted - Baby Pink LP",
        vendor: "Sleep On It",
      }),
    ).toMatchObject({
      artist: "Sleep On It",
      title: "Nearsighted",
      identityStatus: "resolved",
    });
    expect(
      shopifyIdentity({
        title: "Nearsighted - Baby Pink LP",
        vendor: "Record Store",
      }),
    ).toMatchObject({
      artist: "Unknown Artist",
      title: "Nearsighted",
      identityStatus: "unresolved",
    });
  });
  it("does not apply an extra markdown without confirmed stacking", () => {
    const marked = { ...item, purchasePrice: 30, sourceOriginalPrice: 40 };
    expect(
      applyCampaignOffers([marked], [campaign("20% off all vinyl")], at)[0]
        .purchasePrice,
    ).toBe(30);
    expect(
      applyCampaignOffers(
        [marked],
        [
          campaign(
            "Extra 20% off all vinyl, including sale items. Use code EXTRA20",
          ),
        ],
        at,
      )[0].purchasePrice,
    ).toBe(24);
    expect(
      priceCampaignBasket(
        [item],
        campaign("20% off all vinyl excluding Tone Poet"),
        at,
      ).eligible,
    ).toBe(true);
    expect(
      priceCampaignBasket(
        [{ ...item, title: "Album Tone Poet" }],
        campaign("20% off all vinyl excluding Tone Poet"),
        at,
      ).eligible,
    ).toBe(false);
  });
  it("prices a real basket and keeps minimum spend and shipping separate", () => {
    const offer = campaign(
      "$10 off vinyl orders over $60. Free US shipping on orders $75+",
    );
    expect(priceCampaignBasket([item], offer, at)).toMatchObject({
      eligible: false,
      additionalSpendRequired: 20,
    });
    expect(
      priceCampaignBasket([item, { ...item, id: "other" }], offer, at),
    ).toMatchObject({
      eligible: true,
      total: 70,
      freeShipping: false,
      quantity: 2,
    });
    const bogo = campaign("Buy 2 get 1 free vinyl");
    expect(priceCampaignBasket([item], bogo, at).eligible).toBe(false);
    expect(
      priceCampaignBasket(
        [
          item,
          { ...item, id: "b", purchasePrice: 30 },
          { ...item, id: "c", purchasePrice: 20 },
        ],
        bogo,
        at,
      ),
    ).toMatchObject({ eligible: true, total: 70, discount: 20, quantity: 3 });
  });
  it("will not manufacture uniform up-to savings or refresh an expired campaign", () => {
    expect(
      applyCampaignOffers([item], [campaign("Up to 50% off all vinyl")], at)[0]
        .purchasePrice,
    ).toBe(40);
    expect(
      applyCampaignOffers(
        [item],
        [campaign("20% off all vinyl through 2026-09-01")],
        at,
      )[0].purchasePrice,
    ).toBe(40);
  });
  it("verifies exact variant and currency, keeping checkout-only savings unconfirmed", async () => {
    const candidate = {
      ...item,
      shopifyVariantId: 123,
      appliedSaleCampaignId: "sale",
      purchasePrice: 32,
    };
    const read = async (url: string) =>
      url.endsWith("/cart.js")
        ? { currency: "USD" }
        : {
            handle: "artist-album",
            title: "Artist - Album",
            vendor: "Artist",
            variants: [
              {
                id: 123,
                title: "LP",
                price: 4000,
                available: true,
                requires_shipping: true,
              },
            ],
          };
    const verified: any = await verifyRetailOffer(candidate, read, at);
    expect(verified).toMatchObject({
      purchasePrice: 32,
      purchaseOfferVerification: "campaign_advertised",
      retailVerification: { status: "needs_confirmation" },
    });
    const changed: any = await verifyRetailOffer(
      { ...candidate, appliedSaleCampaignId: undefined },
      read,
      at,
    );
    expect(changed).toMatchObject({
      purchasePrice: 40,
      purchaseOfferVerification: "direct_retailer",
    });
  });
  it("does not call sparse aggregate demand a seven-day sale or a tiny margin promising", () => {
    const scored = evaluateOpportunity(
      {
        ...item,
        purchasePrice: 67.99,
        averageSoldPrice: 108.99,
        averageSoldShipping: 0,
        purchaseOfferVerification: "direct_retailer",
        sourceDiscountPercent: 50,
        activeEvidence: {
          status: "available",
          searchComplete: true,
          exactMatchedListingCount: 0,
          matchConfidence: 1,
          capturedAt: at,
        },
        soldEvidence: {
          status: "validated",
          condition: "new_sealed",
          unitsSold1095Days: 2,
          velocityEvidence: "aggregate_last_sale_only",
          latestSaleDate: "2026-08-15",
          matchConfidence: 1,
          capturedAt: at,
        },
        ebayResearchRows: [
          { title: "Artist Album", totalSold: 2, avgSoldPrice: 108.99 },
        ],
      },
      {},
      at,
    );
    expect(scored.estimatedDaysToSell).toBeNull();
    expect(scored.profitPer30Days).toBeNull();
    expect(scored.candidateTier).toBe("C");
  });
});

it("does not identify a retailer vendor as the artist", () => {
  const identity = shopifyIdentity(
    {
      title: "Hope St.",
      vendor: "Rarewaves",
      product_type: "Vinyl",
      tags: [],
      variants: [],
    },
    {},
    { name: "Rarewaves" },
  );
  expect(identity.artist).toBe("Unknown Artist");
  expect(identity.identityStatus).toBe("unresolved");
});
