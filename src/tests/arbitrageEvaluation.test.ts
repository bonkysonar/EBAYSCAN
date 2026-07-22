import { describe, expect, it } from "vitest";
import {
  buildCostLedger,
  defaultArbitrageSettings,
  evaluateOpportunity as evaluateNodeOpportunity,
} from "../lib/arbitrage/evaluateOpportunity.mjs";
import {
  evaluateOpportunity as evaluateTypedOpportunity,
  scoreArbitrageFind,
} from "../lib/arbitrage/rules";
import type { ArbitrageFind } from "../lib/arbitrage/types";
import {
  applyVerifiedSaleCampaigns,
  purchaseOfferVerificationForSource,
} from "../../scripts/lib/candidatePipeline.mjs";

const NOW = "2026-07-15T12:00:00.000Z";
const evaluateOpportunity = evaluateNodeOpportunity;

function validatedFind(overrides: Partial<ArbitrageFind> = {}): ArbitrageFind {
  return {
    activeEvidence: {
      capturedAt: "2026-07-15T10:00:00.000Z",
      exactMatchedListingCount: 3,
      matchConfidence: "high",
      rawListingsInspected: 100,
      searchComplete: true,
      status: "available",
    },
    artist: "Test Artist",
    capturedAt: "2026-07-15T09:00:00.000Z",
    condition: "new/sealed",
    conservativeResalePrice: 40,
    costs: { inboundShipping: 0 },
    ebayActiveSearchStatus: "available",
    ebayResearchStatus: "validated",
    id: "validated-test",
    purchasePrice: 10,
    purchaseOfferVerification: "direct_retailer",
    sourceCurrency: "USD",
    soldEvidence: {
      capturedAt: "2026-07-15T10:00:00.000Z",
      condition: "new_sealed",
      conservativeResalePrice: 40,
      latestSaleDate: "2026-07-12",
      matchConfidence: "high",
      source: "local-own-sales-history",
      status: "validated",
      unitsSold30Days: 5,
      unitsSold90Days: 12,
      unitsSold365Days: 30,
    },
    sourceId: "test",
    sourceName: "Test Store",
    sourceUrl: "https://example.test/record",
    title: "Test Album",
    ...overrides,
  };
}

describe("canonical arbitrage evaluation", () => {
  it("returns the same result through the Node scanner API and the typed React wrapper", () => {
    expect(evaluateTypedOpportunity(validatedFind(), defaultArbitrageSettings, NOW)).toEqual(
      evaluateNodeOpportunity(validatedFind(), defaultArbitrageSettings, NOW),
    );
  });

  it("buys only when exact, fresh demand and full-cost economics clear every gate", () => {
    const result = evaluateOpportunity(validatedFind(), defaultArbitrageSettings, NOW);

    expect(result.decision).toBe("BUY");
    expect(result.gates).toEqual({
      activeEvidence: true,
      demand: true,
      economics: true,
      evidenceFreshness: true,
      matchConfidence: true,
      offerFreshness: true,
      purchaseOffer: true,
      soldEvidence: true,
      supply: true,
    });
    expect(result.expectedNetProfit).toBe(13.75);
    expect(result.roiRatio).toBeCloseTo(1.2557, 4);
    expect(result.sellThroughRate).toBe(0.8);
    expect(result.activeSupplyMonths).toBe(0.75);
    expect(result.status).toBe("BUY");
  });

  it.each(["campaign_advertised", "discovery_lead"] as const)(
    "keeps an otherwise qualified %s acquisition offer in review until its live price is confirmed",
    (purchaseOfferVerification) => {
      const result = evaluateOpportunity(
        validatedFind({ purchaseOfferVerification }),
        defaultArbitrageSettings,
        NOW,
      );

      expect(result.decision).toBe("REVIEW");
      expect(result.gates.purchaseOffer).toBe(false);
      expect(result.reasonCodes).toContain("ACQUISITION_OFFER_UNVERIFIED");
      expect(result.reasons.join(" ")).toContain("confirm the live retailer price");
    },
  );

  it.each([undefined, "shipping_unverified", "direct-retailer"])(
    "fails closed for missing or unknown acquisition provenance (%s)",
    (purchaseOfferVerification) => {
      const result = evaluateOpportunity(
        {
          ...validatedFind(),
          purchaseOfferVerification,
        } as unknown as ArbitrageFind,
        defaultArbitrageSettings,
        NOW,
      );

      expect(result.decision).toBe("REVIEW");
      expect(result.reasonCodes).toContain("ACQUISITION_OFFER_UNVERIFIED");
    },
  );

  it("keeps campaign-adjusted and discovery-pipeline prices out of automatic BUY", () => {
    const [campaignCandidate] = applyVerifiedSaleCampaigns(
      [
        {
          ...validatedFind(),
          collectionContext: "summer-sale",
          purchasePrice: 20,
        },
      ],
      [
        {
          discountPercent: 50,
          evidence: "50% off all vinyl",
          scope: "vinyl-wide",
          sourceId: "test",
          sourceUrl: "https://example.test/collections/summer-sale",
          verification: "retailer-page",
        },
      ],
    );
    const discoveryCandidate = {
      ...validatedFind(),
      purchaseOfferVerification: purchaseOfferVerificationForSource(
        {},
        { crawlType: "deal-aggregator", id: "deal-feed" },
      ),
    };
    const unverifiedTargetMarketplaceCandidate = {
      ...validatedFind(),
      purchaseOfferVerification: purchaseOfferVerificationForSource(
        { retailerSoldBySource: null },
        { id: "target", retailSourceType: "marketplace_retailer" },
      ),
    };
    const unverifiedEbayCandidate = {
      ...validatedFind(),
      purchaseOfferVerification: purchaseOfferVerificationForSource(
        {},
        { id: "ebay-purchase", retailSourceType: "marketplace_retailer" },
      ),
    };

    for (const candidate of [
      campaignCandidate,
      discoveryCandidate,
      unverifiedTargetMarketplaceCandidate,
      unverifiedEbayCandidate,
    ]) {
      const result = evaluateOpportunity(candidate, defaultArbitrageSettings, NOW);
      expect(result.decision).toBe("REVIEW");
      expect(result.reasonCodes).toContain("ACQUISITION_OFFER_UNVERIFIED");
    }
  });

  it("allows a smaller margin when the record qualifies for the fast-turn option", () => {
    const result = evaluateOpportunity(
      validatedFind({
        conservativeResalePrice: 30,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          conservativeResalePrice: 30,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("BUY");
    expect(result.gates.demand).toBe(true);
    expect(result.gates.economics).toBe(true);
    expect(result.expectedNetProfit).toBe(5.75);
    expect(result.recommendedStrategy).toBe("fast_turn");
    expect(result.strategyOptions.find((option) => option.id === "fast_turn")).toMatchObject({
      economicsQualified: true,
      eligible: true,
      minNetProfitDollars: 4,
    });
  });

  it("uses strict source floors only for the slower high-margin option", () => {
    const result = evaluateOpportunity(
      validatedFind({
        sourceMinNetProfit: 15,
        sourceMinROI: 1.5,
      }),
      {
        ...defaultArbitrageSettings,
        minNetProfitDollars: 1,
        minRoiRatio: 0.05,
      },
      NOW,
    );

    expect(result.expectedNetProfit).toBe(13.75);
    expect(result.roiRatio).toBeCloseTo(1.2557, 4);
    expect(result.gates.economics).toBe(true);
    expect(result.decision).toBe("BUY");
    expect(result.strategyOptions.find((option) => option.id === "high_margin")).toMatchObject({
      economicsQualified: false,
      minNetProfitDollars: 15,
      minRoiRatio: 1.5,
    });
  });

  it("keeps a profitable slow mover on WATCH only when it is close to the higher-margin option", () => {
    const result = evaluateOpportunity(
      validatedFind({
        soldEvidence: {
          capturedAt: "2026-07-15T10:00:00.000Z",
          condition: "new_sealed",
          conservativeResalePrice: 40,
          latestSaleDate: "2026-05-01",
          matchConfidence: "high",
          source: "local-own-sales-history",
          status: "validated",
          unitsSold30Days: 0,
          unitsSold90Days: 1,
          unitsSold365Days: 2,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("WATCH");
    expect(result.gates.economics).toBe(true);
    expect(result.gates.demand).toBe(false);
    expect(result.reasonCodes).toContain("DEMAND_GATE_FAILED");
    expect(result.reasonCodes).toContain("SLOW_DEMAND_HIGH_MARGIN_WATCH");
    expect(result.strategyOptions.find((option) => option.id === "high_margin")).toMatchObject({
      demandSupport: "partial",
      economicsQualified: false,
      minNetProfitDollars: 15,
      minRoiRatio: 0.6,
      netProfitGapDollars: 1.25,
      watchQualified: true,
    });
  });

  it("rejects a slow mover when it is not close to the larger margin cushion", () => {
    const result = evaluateOpportunity(
      validatedFind({
        purchasePrice: 20,
        soldEvidence: {
          capturedAt: "2026-07-15T10:00:00.000Z",
          condition: "new_sealed",
          conservativeResalePrice: 40,
          latestSaleDate: "2026-05-01",
          matchConfidence: "high",
          source: "local-own-sales-history",
          status: "validated",
          unitsSold30Days: 0,
          unitsSold90Days: 1,
          unitsSold365Days: 2,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REJECT");
    expect(result.reasonCodes).toContain("DEMAND_GATE_FAILED");
    expect(result.strategyOptions.find((option) => option.id === "high_margin")).toMatchObject({
      demandSupport: "partial",
      economicsQualified: false,
      watchQualified: false,
    });
  });

  it("derives demand and supply from canonical evidence before stale summary fields", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          exactMatchedListingCount: 50,
        },
        activeSupplyMonths: 1,
        salesPerMonth: 10,
        sellThroughRate: 0.9,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          salesPerMonth: undefined,
          unitsSold90Days: 3,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REJECT");
    expect(result.salesPerMonth).toBe(1);
    expect(result.sellThroughRate).toBeCloseTo(3 / 53, 4);
    expect(result.activeSupplyMonths).toBe(50);
    expect(result.gates.demand).toBe(false);
    expect(result.gates.supply).toBe(false);
  });

  it("keeps excessive exact supply in review when sold velocity is incomplete", () => {
    const result = evaluateOpportunity(
      {
        ...validatedFind(),
        soldEvidence: {
          capturedAt: "2026-07-15T00:00:00.000Z",
          condition: "new_sealed",
          matchConfidence: "unknown",
          status: "pending",
          velocityEvidence: "unknown",
        },
        activeEvidence: {
          capturedAt: "2026-07-15T00:00:00.000Z",
          exactMatchedListingCount: 99,
          matchConfidence: "high",
          rawListingsInspected: 256,
          searchComplete: true,
          status: "available",
        },
      },
      {},
      "2026-07-16T00:00:00.000Z",
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).not.toContain("SUPPLY_HARD_FAIL");
  });

  it("rejects an exact active market already priced at or below the source buy cost", () => {
    const result = evaluateOpportunity(
      {
        ...validatedFind({
          lowestActivePrice: 9,
          purchasePrice: 10,
        }),
        soldEvidence: {
          capturedAt: "2026-07-15T00:00:00.000Z",
          condition: "new_sealed",
          matchConfidence: "unknown",
          status: "pending",
          velocityEvidence: "unknown",
        },
      },
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REJECT");
    expect(result.reasonCodes).toContain("ACTIVE_MARKET_BELOW_BUY_COST");
    expect(result.reasons).toContainEqual(
      expect.stringContaining(
        "active-market floor ($9.00) is already at or below the source buy price ($10.00)",
      ),
    );
  });

  it("does not use a higher active listing price as positive sold evidence", () => {
    const result = evaluateOpportunity(
      {
        ...validatedFind({
          lowestActivePrice: 12,
          purchasePrice: 10,
        }),
        soldEvidence: {
          capturedAt: "2026-07-15T00:00:00.000Z",
          condition: "new_sealed",
          matchConfidence: "unknown",
          status: "pending",
          velocityEvidence: "unknown",
        },
      },
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("SOLD_EVIDENCE_INCOMPLETE");
    expect(result.reasonCodes).not.toContain("ACTIVE_MARKET_BELOW_BUY_COST");
  });

  it("does not reject a crowded listing market when validated velocity still implies a fast turn", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          exactMatchedListingCount: 64,
        },
        soldEvidence: {
          ...validatedFind().soldEvidence,
          unitsSold30Days: 100,
          unitsSold90Days: 300,
          unitsSold365Days: 500,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.estimatedDaysToSell).toBeLessThan(
      defaultArbitrageSettings.fastTurnMaxDaysToSell,
    );
    expect(result.decision).not.toBe("REJECT");
    expect(result.reasonCodes).not.toContain("SUPPLY_HARD_FAIL");
  });

  it("rejects excessive exact supply when validated long-term velocity implies a very slow turn", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          exactMatchedListingCount: 64,
        },
        soldEvidence: {
          ...validatedFind().soldEvidence,
          latestSaleDate: "2026-06-01",
          unitsSold30Days: 0,
          unitsSold90Days: 0,
          unitsSold365Days: 1,
          unitsSold1095Days: 2,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.estimatedDaysToSell).toBeGreaterThan(
      defaultArbitrageSettings.highMarginMaxDaysToSell,
    );
    expect(result.decision).toBe("REJECT");
    expect(result.reasonCodes).toContain("SUPPLY_HARD_FAIL");
  });

  it("recomputes recency and can route an older sale to the slower high-margin option", () => {
    const result = evaluateOpportunity(
      validatedFind({
        daysSinceLastSale: 0,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          daysSinceLastSale: 0,
          latestSaleDate: "2026-05-01",
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.daysSinceLastSale).toBe(75);
    expect(result.gates.demand).toBe(true);
    expect(result.decision).toBe("BUY");
    expect(result.recommendedStrategy).toBe("high_margin");
  });

  it("does not treat an aggregate total with one latest-sale date as validated 90-day velocity", () => {
    const result = evaluateOpportunity(
      validatedFind({
        soldEvidence: {
          ...validatedFind().soldEvidence,
          source: "ebay-product-research-aggregate",
          velocityEvidence: "aggregate_last_sale_only",
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.gates.soldEvidence).toBe(false);
    expect(result.reasonCodes).toContain("SOLD_VELOCITY_UNVALIDATED");
  });

  it("does not promote legacy raw active totals or undated three-year sold counts to BUY", () => {
    const legacy = validatedFind({
      activeEvidence: undefined,
      activeListingCount: 2,
      averageSoldPrice: 40,
      conservativeResalePrice: undefined,
      ebayActiveSearchStatus: "available",
      ebayResearchStatus: "validated",
      soldEvidence: undefined,
      totalSoldCount: 30,
    });

    const result = evaluateOpportunity(legacy, defaultArbitrageSettings, NOW);

    expect(result.decision).toBe("REVIEW");
    expect(result.gates.activeEvidence).toBe(false);
    expect(result.gates.soldEvidence).toBe(false);
    expect(result.reasonCodes).toContain("SOLD_EVIDENCE_INCOMPLETE");
    expect(result.reasonCodes).toContain("ACTIVE_EVIDENCE_INCOMPLETE");
  });

  it("does not backfill explicit null structured evidence from stale summary fields", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          exactMatchedListingCount: null,
        },
        exactActiveListingCount: 3,
        salesPerMonth: 4,
        sellThroughRate: 0.8,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          unitsSold30Days: null,
          unitsSold90Days: null,
          unitsSold365Days: null,
        },
        soldUnits30Days: 5,
        soldUnits90Days: 12,
        soldUnits365Days: 30,
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.exactActiveListingCount).toBeNull();
    expect(result.soldUnits90Days).toBeNull();
    expect(result.gates.activeEvidence).toBe(false);
    expect(result.gates.soldEvidence).toBe(false);
  });

  it("keeps positive but incomplete economics reviewable instead of applying one hard floor", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: undefined,
        conservativeResalePrice: 25,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          conservativeResalePrice: 25,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("ACTIVE_EVIDENCE_INCOMPLETE");
    expect(result.reasonCodes).not.toContain("ECONOMICS_HARD_FAIL");
  });

  it("does not mistake two aggregate sales against twenty active listings for real velocity", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          exactMatchedListingCount: 20,
        },
        artist: "Sam & Dave",
        conservativeResalePrice: 27.75,
        purchasePrice: 13,
        soldEvidence: {
          capturedAt: "2026-07-15T10:00:00.000Z",
          condition: "new_sealed",
          conservativeResalePrice: 27.75,
          latestSaleDate: "2026-07-12",
          matchConfidence: "high",
          source: "ebay-product-research-aggregate",
          status: "validated",
          unitsSold30Days: null,
          unitsSold90Days: null,
          unitsSold365Days: null,
          unitsSold1095Days: 2,
          velocityEvidence: "aggregate_last_sale_only",
        },
        title: "Hold On, I'm Comin'",
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.priorityBand).toBe("REJECT");
    expect(result.longTermSalesPerMonth).toBeCloseTo(0.06, 2);
    expect(result.longTermSupplyMonths).toBeGreaterThan(300);
    expect(result.gates.demand).toBe(false);
    expect(result.gates.soldEvidence).toBe(false);
    expect(result.strategyOptions.every((option) => !option.eligible)).toBe(true);
  });

  it("raises priority for an evergreen artist without fabricating item-level velocity", () => {
    const ordinary = evaluateOpportunity(validatedFind(), defaultArbitrageSettings, NOW);
    const evergreen = evaluateOpportunity(
      validatedFind({
        artist: "Creedence Clearwater Revival",
        artistSoldUnits365Days: 80,
        artistSoldUnits1095Days: 240,
        retailerBestSeller: true,
        retailerReviewCount: 500,
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(evergreen.priorityScore).toBeGreaterThan(ordinary.priorityScore);
    expect(evergreen.priorityBreakdown.evergreenPrior).toBeGreaterThan(
      ordinary.priorityBreakdown.evergreenPrior,
    );
  });

  it("does not treat zero active listings as scarcity when no sold demand is validated", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          exactMatchedListingCount: 0,
          rawListingsInspected: 0,
          status: "no_results",
        },
        soldEvidence: {
          capturedAt: "2026-07-15T10:00:00.000Z",
          condition: "new_sealed",
          conservativeResalePrice: null,
          latestSaleDate: null,
          matchConfidence: "high",
          source: "local-own-sales-history",
          status: "candidate",
          unitsSold30Days: null,
          unitsSold90Days: null,
          unitsSold365Days: null,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.priorityBreakdown.competitionAndSupply).toBe(0);
  });

  it("uses a bounded evergreen discount only when exact item demand and low supply already qualify", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          exactMatchedListingCount: 1,
        },
        artistSoldUnits365Days: 80,
        artistSoldUnits1095Days: 240,
        conservativeResalePrice: 30,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          conservativeResalePrice: 30,
          unitsSold30Days: 1,
          unitsSold90Days: 3,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    const balanced = result.strategyOptions.find((option) => option.id === "balanced");
    expect(result.expectedNetProfit).toBe(5.75);
    expect(result.decision).toBe("BUY");
    expect(result.recommendedStrategy).toBe("balanced");
    expect(balanced).toMatchObject({
      demandSupport: "qualified",
      economicsQualified: true,
      eligible: true,
      label: "Evergreen balanced buy",
      minNetProfitDollars: 5.6,
      minRoiRatio: 0.24,
    });
    expect(balanced?.thresholdReasons).toContainEqual(
      expect.stringContaining("lowered the balanced floor by 20%"),
    );
    expect(balanced?.thresholdReasons).toContainEqual(
      expect.stringContaining("own artist-level sales"),
    );
  });

  it("keeps a fast mover near the smaller-margin floor as a price-target WATCH", () => {
    const result = evaluateOpportunity(
      validatedFind({
        conservativeResalePrice: 27.5,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          conservativeResalePrice: 27.5,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    const fastTurn = result.strategyOptions.find((option) => option.id === "fast_turn");
    expect(result.expectedNetProfit).toBe(3.74);
    expect(result.decision).toBe("WATCH");
    expect(result.reasonCodes).toContain("PRICE_TARGET_WATCH");
    expect(result.recommendedMaxPurchasePrice).toBeLessThan(result.purchasePrice);
    expect(fastTurn).toMatchObject({
      demandSupport: "qualified",
      economicsQualified: false,
      netProfitGapDollars: 0.26,
      watchQualified: true,
    });
  });

  it("withholds USD profit and BUY when a foreign source price has not been converted", () => {
    const result = evaluateOpportunity(
      validatedFind({
        purchasePrice: 10,
        sourceCurrency: "GBP",
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.currencyConversionRequired).toBe(true);
    expect(result.expectedNetProfit).toBeNull();
    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("SOURCE_CURRENCY_UNCONVERTED");
  });

  it("requires a fresh dated rate before accepting a foreign purchase-price conversion", () => {
    const stale = evaluateOpportunity(
      validatedFind({
        currencyConversionRate: 1.3,
        currencyConversionUpdatedAt: "2026-05-01T00:00:00.000Z",
        purchasePriceUsd: 13,
        sourceCurrency: "GBP",
      }),
      defaultArbitrageSettings,
      NOW,
    );
    const fresh = evaluateOpportunity(
      validatedFind({
        currencyConversionRate: 1.3,
        currencyConversionUpdatedAt: "2026-07-15T10:00:00.000Z",
        purchasePriceUsd: 13,
        sourceCurrency: "GBP",
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(stale.currencyConversionRequired).toBe(true);
    expect(stale.expectedNetProfit).toBeNull();
    expect(fresh.currencyConversionRequired).toBe(false);
    expect(fresh.expectedNetProfit).not.toBeNull();
  });

  it("derives converted purchase cost from source price and rate instead of trusting a stale USD field", () => {
    const result = evaluateOpportunity(
      validatedFind({
        currencyConversionRate: 1.3,
        currencyConversionUpdatedAt: "2026-07-15T10:00:00.000Z",
        purchasePrice: 100,
        purchasePriceUsd: 10,
        sourceCurrency: "GBP",
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.currencyConversionRequired).toBe(false);
    expect(result.purchasePriceUsd).toBe(130);
    expect(result.costLedger.purchasePrice).toBe(130);
    expect(result.decision).toBe("REJECT");
  });

  it("does not treat materially future evidence timestamps as fresh", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          capturedAt: "2099-01-01T00:00:00.000Z",
        },
        soldEvidence: {
          ...validatedFind().soldEvidence,
          capturedAt: "2099-01-01T00:00:00.000Z",
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.gates.evidenceFreshness).toBe(false);
    expect(result.reasonCodes).toContain("EVIDENCE_STALE_OR_UNDATED");
  });

  it("accepts evidence captured after scan start when evaluation happens later", () => {
    const result = evaluateOpportunity(
      validatedFind({
        activeEvidence: {
          ...validatedFind().activeEvidence,
          capturedAt: "2026-07-15T12:10:00.000Z",
        },
        capturedAt: "2026-07-15T12:00:00.000Z",
        soldEvidence: {
          ...validatedFind().soldEvidence,
          capturedAt: "2026-07-15T12:10:00.000Z",
        },
      }),
      defaultArbitrageSettings,
      "2026-07-15T12:11:00.000Z",
    );

    expect(result.gates.evidenceFreshness).toBe(true);
    expect(result.decision).toBe("BUY");
  });

  it("downgrades an otherwise valid BUY when the retailer offer is stale", () => {
    const result = evaluateOpportunity(
      validatedFind({
        capturedAt: "2026-07-12T11:59:59.000Z",
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.gates.offerFreshness).toBe(false);
    expect(result.gates.evidenceFreshness).toBe(false);
    expect(result.gates.demand).toBe(true);
    expect(result.gates.economics).toBe(true);
    expect(result.reasonCodes).toContain("OFFER_STALE_OR_UNDATED");
    expect(result.reasonCodes).not.toContain("EVIDENCE_STALE_OR_UNDATED");
    expect(result.reasons).toContainEqual(
      expect.stringContaining("refresh the source price and availability before buying"),
    );
  });

  it("requires a dated retailer offer even when market evidence is current", () => {
    const result = evaluateOpportunity(
      validatedFind({
        capturedAt: "",
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.gates.offerFreshness).toBe(false);
    expect(result.reasonCodes).toContain("OFFER_STALE_OR_UNDATED");
    expect(result.reasonCodes).not.toContain("EVIDENCE_STALE_OR_UNDATED");
  });

  it("allows the offer-age threshold to be configured explicitly", () => {
    const find = validatedFind({
      capturedAt: "2026-07-12T12:00:00.000Z",
    });
    const strict = evaluateOpportunity(find, defaultArbitrageSettings, NOW);
    const relaxed = evaluateOpportunity(
      find,
      {
        ...defaultArbitrageSettings,
        maxOfferAgeDays: 3,
      },
      NOW,
    );

    expect(strict.decision).toBe("REVIEW");
    expect(relaxed.decision).toBe("BUY");
    expect(relaxed.gates.offerFreshness).toBe(true);
  });

  it("lets UI scoring use an explicit evaluation clock", () => {
    const find = validatedFind({
      capturedAt: "2026-07-15T09:00:00.000Z",
    });

    expect(scoreArbitrageFind(find, defaultArbitrageSettings, NOW).decision).toBe("BUY");
    expect(
      scoreArbitrageFind(
        find,
        defaultArbitrageSettings,
        "2026-07-18T12:00:00.000Z",
      ).decision,
    ).toBe("REVIEW");
  });

  it("does not treat a future latest-sale date as current demand", () => {
    const result = evaluateOpportunity(
      validatedFind({
        daysSinceLastSale: 0,
        soldEvidence: {
          ...validatedFind().soldEvidence,
          daysSinceLastSale: 0,
          latestSaleDate: "2099-01-01",
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.daysSinceLastSale).toBeNull();
    expect(result.gates.demand).toBe(false);
    expect(result.decision).toBe("REJECT");
  });

  it("does not accept a materially future currency-conversion timestamp", () => {
    const result = evaluateOpportunity(
      validatedFind({
        currencyConversionRate: 1.3,
        currencyConversionUpdatedAt: "2099-01-01T00:00:00.000Z",
        purchasePriceUsd: 13,
        sourceCurrency: "GBP",
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.currencyConversionRequired).toBe(true);
    expect(result.expectedNetProfit).toBeNull();
    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("SOURCE_CURRENCY_UNCONVERTED");
  });

  it("withholds economics when neither source currency nor country can identify the currency", () => {
    const result = evaluateOpportunity(
      validatedFind({ sourceCurrency: null, sourceCountry: null }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.currencyConversionRequired).toBe(true);
    expect(result.reasonCodes).toContain("SOURCE_CURRENCY_UNKNOWN");
    expect(result.expectedNetProfit).toBeNull();
  });

  it("uses quantity-weighted Product Research rows to derive a conservative lower-quartile resale", () => {
    const result = evaluateOpportunity(
      validatedFind({
        conservativeResalePrice: undefined,
        productResearchRows: [
          { avgShipping: 5, avgSoldPrice: 35, title: "high comp", totalSold: 1 },
          { avgShipping: 0, avgSoldPrice: 24, title: "repeat comp", totalSold: 5 },
        ],
        soldEvidence: {
          ...validatedFind().soldEvidence,
          conservativeResalePrice: undefined,
        },
      }),
      defaultArbitrageSettings,
      NOW,
    );

    expect(result.conservativeResalePrice).toBe(24);
  });

  it("itemizes every configured acquisition and selling cost", () => {
    const ledger = buildCostLedger(
      20,
      60,
      {
        duty: 2,
        fxFees: 1,
        inboundShipping: 4,
        marketplaceFeeFixed: 0.4,
        marketplaceFeeRate: 0.1,
        otherAcquisitionCosts: 0.5,
        otherSellingCosts: 0.75,
        outboundShipping: 5,
        packaging: 1.25,
        promotedListingRate: 0.03,
        returnsReserveAmount: 0.5,
        returnsReserveRate: 0.02,
        taxRatePercent: 10,
      },
      defaultArbitrageSettings,
    );

    expect(ledger).toMatchObject({
      duty: 2,
      fxFees: 1,
      inboundShipping: 4,
      landedCost: 29.5,
      marketplaceFee: 6.4,
      outboundShipping: 5,
      packaging: 1.25,
      promotedListingFee: 1.8,
      returnsReserve: 1.7,
      salesTax: 2,
      sellingCosts: 16.9,
      totalCost: 46.4,
    });
    expect(ledger.expectedNetProfit).toBe(13.6);
  });
});
