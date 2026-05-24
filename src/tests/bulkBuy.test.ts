import { describe, expect, it } from "vitest";
import {
  bulkBuyCategory,
  calculateBulkBuyMath,
  createBulkBuyRow,
  updateBulkBuyRowFromDiscogs,
} from "../lib/bulkBuy/calculateBulkBuy";

describe("bulk buy math", () => {
  it("calculates buy price, best case sale, fees, taxes, supplies, and profit", () => {
    const math = calculateBulkBuyMath(20);

    expect(math.purchasePrice).toBe(8);
    expect(math.bestCaseSalePrice).toBe(22);
    expect(math.estimatedFees).toBe(4);
    expect(math.shippingSupplies).toBe(1);
    expect(math.estimatedTaxes).toBe(1);
    expect(math.estimatedProfit).toBe(8);
  });

  it("uses a flat 50 cent buy price when the reference price is under $5", () => {
    const math = calculateBulkBuyMath(4.99);

    expect(math.purchasePrice).toBe(0.5);
    expect(math.bestCaseSalePrice).toBe(5);
    expect(math.category).toBe("low-end bulk");
  });

  it("rounds calculated money down to the nearest 50 cent mark", () => {
    const math = calculateBulkBuyMath(18);

    expect(math.purchasePrice).toBe(7);
    expect(math.bestCaseSalePrice).toBe(19.5);
    expect(math.estimatedFees).toBe(3.5);
  });

  it("discounts sold price when title matches are crowded", () => {
    expect(calculateBulkBuyMath(20, { discogsMedianPrice: 20, titleMatchCount: 11 }).bestCaseSalePrice).toBe(16);
    expect(
      calculateBulkBuyMath(20, {
        averageCheapestTenTotalPrice: 18,
        discogsMedianPrice: 20,
        titleMatchCount: 51,
      }).bestCaseSalePrice,
    ).toBe(12.5);
  });

  it("categorizes reference prices into low-end bulk, sellable, and high-end", () => {
    expect(bulkBuyCategory(4.99)).toBe("low-end bulk");
    expect(bulkBuyCategory(5)).toBe("sellable");
    expect(bulkBuyCategory(25)).toBe("sellable");
    expect(bulkBuyCategory(25.01)).toBe("high-end");
  });

  it("uses the lower of Discogs sales median and average cheapest 10", () => {
    const row = createBulkBuyRow({
      discogs: {
        confidence: "high",
        matchedTitle: "Test Artist - Test LP",
        salesStats: {
          importedAt: "2026-05-24T10:00:00.000Z",
          medianPrice: { currency: "USD", value: 30 },
          source: "page_fetch",
        },
        status: "available",
        warnings: [],
      },
      input: { conditionFilter: "new", query: "test artist test lp", type: "manual" },
      now: "2026-05-24T10:00:00.000Z",
      order: 7,
      priceSummary: {
        averageCheapestTenTotalPrice: 18,
        cheapestTenCount: 10,
        highOutlierCount: 0,
        lowestTotalPrice: 10,
        medianTotalPrice: 20,
        priceSpread: 12,
        relevantResultCount: 10,
        resultCount: 10,
        sameTitleClusterCount: 10,
        trimmedMedianTotalPrice: 20,
      },
    });

    expect(row.condition).toBe("new");
    expect(row.math?.medianPrice).toBe(18);
    expect(row.math?.purchasePrice).toBe(7);
    expect(row.order).toBe(7);
    expect(row.statsStatus).toBe("cheapest-ten");
  });

  it("updates a pending row when Discogs median stats arrive later", () => {
    const row = createBulkBuyRow({
      discogs: {
        confidence: "high",
        matchedTitle: "Pending Record",
        releaseId: 123,
        status: "available",
        warnings: [],
      },
      input: { barcode: "123", conditionFilter: "used", type: "barcode" },
      order: 1,
    });

    const updated = updateBulkBuyRowFromDiscogs(row, {
      confidence: "high",
      matchedTitle: "Resolved Record",
      releaseId: 123,
      salesStats: {
        importedAt: "2026-05-24T10:00:00.000Z",
        medianPrice: { currency: "USD", value: 10 },
        source: "browser_extension",
      },
      status: "available",
      warnings: [],
    });

    expect(row.math).toBeNull();
    expect(updated.artistTitle).toBe("Resolved Record");
    expect(updated.math?.purchasePrice).toBe(4);
  });
});
