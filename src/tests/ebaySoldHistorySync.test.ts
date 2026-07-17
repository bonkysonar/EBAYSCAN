import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyFinancialTransactions,
  assertSanitizedSoldHistoryOutput,
  buildApiSoldHistoryIndex,
  buildEbayEconomicsSummary,
  mergeSoldHistoryBaseline,
  ordersToSoldRecords,
  resolveEbaySyncRange,
} from "../../scripts/lib/ebaySoldHistorySync.mjs";
import { syncEbaySoldHistory } from "../../scripts/syncEbaySoldHistory.mjs";
import type { EbayFinancialTransaction, EbaySoldOrder } from "../server/ebaySoldHistoryApi";

const order: EbaySoldOrder = {
  creationDate: "2026-07-01T12:00:00.000Z",
  fulfillmentStatus: "FULFILLED",
  lineItems: [
    {
      currency: "USD",
      legacyItemId: "item-1",
      lineItemCost: 40,
      lineItemId: "line-1",
      quantity: 2,
      refunds: [],
      shippingCost: 10,
      sku: "Whole A1",
      title: "Creedence Clearwater Revival - Green River Brand New/Sealed Vinyl",
    },
    {
      currency: "USD",
      legacyItemId: "item-2",
      lineItemCost: 20,
      lineItemId: "line-2",
      quantity: 1,
      refunds: [],
      shippingCost: 5,
      sku: "Whole A2",
      title: "Duran Duran - Rio Factory Sealed Vinyl",
    },
  ],
  orderId: "order-1",
  paymentStatus: "PAID",
};

function transaction(overrides: Partial<EbayFinancialTransaction>): EbayFinancialTransaction {
  return {
    amount: 0,
    chargeCategory: "other",
    currency: "USD",
    lineItems: [],
    references: [],
    totalFeeAmount: 0,
    totalFeeBasisAmount: 0,
    transactionDate: "2026-07-01T13:00:00.000Z",
    transactionId: "transaction-default",
    transactionType: "SALE",
    ...overrides,
  };
}

describe("eBay sold-history synchronization", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true });
  });

  it("joins exact fees, order charges, refunds, and labels without guessing unmatched label costs", () => {
    const records = ordersToSoldRecords([order]);
    const transactions = [
      transaction({
        amount: 60,
        bookingEntry: "CREDIT",
        lineItems: [
          {
            feeBasisAmount: 50,
            fees: [{ amount: 6, currency: "USD", feeType: "FINAL_VALUE_FEE" }],
            lineItemId: "line-1",
          },
          {
            feeBasisAmount: 25,
            fees: [{ amount: 3, currency: "USD", feeType: "FINAL_VALUE_FEE" }],
            lineItemId: "line-2",
          },
        ],
        orderId: "order-1",
        totalFeeAmount: 9,
        transactionId: "sale-1",
      }),
      transaction({
        amount: 3,
        bookingEntry: "DEBIT",
        chargeCategory: "advertising",
        feeType: "AD_FEE",
        orderId: "order-1",
        transactionId: "ad-1",
        transactionType: "NON_SALE_CHARGE",
      }),
      transaction({
        amount: 8,
        bookingEntry: "DEBIT",
        lineItems: [{ feeBasisAmount: 10, fees: [{ amount: 1, currency: "USD", feeType: "FINAL_VALUE_FEE" }], lineItemId: "line-2" }],
        orderId: "order-1",
        totalFeeAmount: 1,
        totalFeeBasisAmount: 10,
        transactionId: "refund-1",
        transactionType: "REFUND",
      }),
      transaction({
        amount: 6,
        bookingEntry: "DEBIT",
        orderId: "order-1",
        transactionId: "label-attributed",
        transactionType: "SHIPPING_LABEL",
      }),
      ...[4, 6, 8, 10].map((amount, index) =>
        transaction({
          amount,
          bookingEntry: "DEBIT",
          transactionDate: `2026-07-0${index + 2}T13:00:00.000Z`,
          transactionId: `label-unattributed-${index}`,
          transactionType: "SHIPPING_LABEL",
        }),
      ),
    ];

    const first = applyFinancialTransactions(records, transactions);
    const ccr = first.records.find((record) => record.lineItemId === "line-1");
    const duran = first.records.find((record) => record.lineItemId === "line-2");

    expect(ccr).toMatchObject({
      conditionBucket: "new_sealed",
      ebaySaleFees: 3,
      shippingLabelCost: 2,
      soldFor: 20,
      shippingPaid: 5,
    });
    expect(duran).toMatchObject({
      ebaySaleFeeCredits: 1,
      ebaySaleFees: 2,
      financialRefundAmount: 10,
      soldFor: 20,
      shippingLabelCost: 2,
    });
    expect(ccr?.ebayAdFees).toBeCloseTo(1, 2);
    expect(duran?.ebayAdFees).toBeCloseTo(1, 2);

    const summary = buildEbayEconomicsSummary(first.records, first.state, {
      from: "2026-07-01",
      to: "2026-07-16",
    }) as {
      shippingLabelCalibration: {
        perLabelCalibration: { status: string };
        unattributedBatchTransactionsByCurrency: {
          USD: {
            batchTransactionMedian: number;
            batchTransactionP25: number;
            batchTransactionP75: number;
            batchTransactionTotal: number;
            sampleCount: number;
          };
        };
      };
    };
    expect(summary.shippingLabelCalibration.perLabelCalibration.status).toBe("unavailable");
    expect(summary.shippingLabelCalibration.unattributedBatchTransactionsByCurrency.USD).toEqual({
      batchTransactionMedian: 6,
      batchTransactionP25: 4,
      batchTransactionP75: 8,
      batchTransactionTotal: 28,
      latestSampleDate: "2026-07-05",
      sampleCount: 4,
    });
    expect(first.records.every((record) => record.shippingLabelCost === 2)).toBe(true);
    expect(() => assertSanitizedSoldHistoryOutput([first.records, first.state, summary])).not.toThrow();
    expect(JSON.stringify(first.state)).not.toContain("label-unattributed");

    const second = applyFinancialTransactions(first.records, transactions, first.state);
    expect(second.stats).toMatchObject({ applied: 0, duplicate: transactions.length });
    expect(second.records).toEqual(first.records);
  });

  it("produces the v2 comp schema and artist aggregates", () => {
    const records = ordersToSoldRecords([order]);
    const index = buildApiSoldHistoryIndex(records, { asOf: "2026-07-16T23:59:59.999Z" }) as {
      artistAggregates: Array<{ artist: string; unitsSold: number }>;
      comps: Array<{ unitsSold: number }>;
      unitCount: number;
      version: number;
    };

    expect(index).toMatchObject({ unitCount: 3, version: 2 });
    expect(index.comps[0].unitsSold).toBe(2);
    expect(index.artistAggregates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artist: "Creedence Clearwater Revival", unitsSold: 2 }),
        expect.objectContaining({ artist: "Duran Duran", unitsSold: 1 }),
      ]),
    );
    expect(JSON.stringify(index)).not.toMatch(/orderNumber|lineItemId|recordKey|sku|ebaySaleFees/);
  });

  it("excludes fully refunded rows from demand velocity and price evidence", () => {
    const refundedOrder: EbaySoldOrder = {
      ...order,
      lineItems: [
        {
          ...order.lineItems[1],
          lineItemId: "line-refunded",
          refunds: [{ amount: 25, date: "2026-07-02T12:00:00.000Z" }],
        },
        {
          ...order.lineItems[1],
          lineItemId: "line-retained",
          refunds: [],
        },
      ],
      orderId: "order-refund-test",
    };
    const records = ordersToSoldRecords([refundedOrder]);
    const index = buildApiSoldHistoryIndex(records, { asOf: "2026-07-16T23:59:59.999Z" }) as {
      comps: Array<{
        fullyRefundedUnits: number;
        medianTotal: number;
        transactionCount: number;
        unitsSold: number;
      }>;
      fullyRefundedUnitCount: number;
      unitCount: number;
    };

    expect(records.find((record) => record.lineItemId === "line-refunded")?.retainedQuantity).toBe(0);
    expect(index).toMatchObject({ fullyRefundedUnitCount: 1, unitCount: 1 });
    expect(index.comps[0]).toMatchObject({
      fullyRefundedUnits: 1,
      medianTotal: 25,
      transactionCount: 1,
      unitsSold: 1,
    });
  });

  it("keeps unmatched sanitized CSV history while preferring API rows for the same order item", () => {
    const apiRecords = ordersToSoldRecords([order]);
    const baseline = [
      {
        conditionBucket: "new_sealed",
        itemNumber: "item-1",
        normalizedKey: apiRecords[0].normalizedKey,
        orderNumber: "order-1",
        quantity: 2,
        saleDate: "2026-07-01",
        shippingPaid: 5,
        soldFor: 20,
        sourceSheet: "2026 Orders",
        title: apiRecords[0].title,
        totalBuyerPaid: 25,
      },
      {
        conditionBucket: "new_sealed",
        itemNumber: "older-item",
        normalizedKey: "older artist::older album",
        orderNumber: "older-order",
        quantity: 1,
        saleDate: "2025-12-31",
        shippingPaid: 4,
        soldFor: 18,
        sourceSheet: "2026 Orders",
        title: "Older Artist - Older Album Sealed",
        totalBuyerPaid: 22,
      },
    ];

    const merged = mergeSoldHistoryBaseline(apiRecords, baseline);

    expect(merged).toHaveLength(apiRecords.length + 1);
    expect(merged.filter((record) => record.orderNumber === "order-1" && record.itemNumber === "item-1")).toHaveLength(1);
    expect(merged).toEqual(expect.arrayContaining([expect.objectContaining({ orderNumber: "older-order" })]));
  });

  it("writes the four sanitized outputs and reuses financial-event digests across the overlap", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-ebay-sync-"));
    workspaces.push(workspace);
    let run = 0;
    const sale = transaction({
      amount: 60,
      bookingEntry: "CREDIT",
      lineItems: [
        {
          feeBasisAmount: 50,
          fees: [{ amount: 6, currency: "USD", feeType: "FINAL_VALUE_FEE" }],
          lineItemId: "line-1",
        },
      ],
      orderId: "order-1",
      totalFeeAmount: 6,
      transactionId: "sale-repeat",
    });
    const api = {
      fetchEbayOrders: async () => [order],
      fetchEbayFinancialTransactions: async () => {
        run += 1;
        return [sale];
      },
    };

    const first = await syncEbaySoldHistory({
      api,
      cwd: workspace,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      now: "2026-07-16T12:00:00.000Z",
    });
    const second = await syncEbaySoldHistory({
      api,
      cwd: workspace,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      now: "2026-07-17T12:00:00.000Z",
    });

    expect(run).toBe(2);
    expect(first.stats.applied).toBe(1);
    expect(second.stats).toMatchObject({ applied: 0, duplicate: 1 });
    for (const fileName of [
      "sold-records-ebay-api.json",
      "ebay-economics-summary.json",
      "sold-comps-index.json",
      "sync-state.json",
    ]) {
      const value = JSON.parse(readFileSync(join(workspace, "exports", "sold-history", fileName), "utf8"));
      expect(() => assertSanitizedSoldHistoryOutput(value)).not.toThrow();
    }
  });

  it("supports a true dry run without creating output files", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-ebay-sync-dry-"));
    workspaces.push(workspace);

    const result = await syncEbaySoldHistory({
      api: {
        fetchEbayOrders: async () => [order],
        fetchEbayFinancialTransactions: async () => [],
      },
      cwd: workspace,
      dryRun: true,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      now: "2026-07-16T12:00:00.000Z",
    });

    expect(result.dryRun).toBe(true);
    expect(() => readFileSync(join(workspace, "exports", "sold-history", "sold-comps-index.json"))).toThrow();
  });

  it("rebuilds instead of double counting when eBay corrects an existing financial event", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-ebay-sync-correction-"));
    workspaces.push(workspace);
    let corrected = false;
    let financeCalls = 0;
    const api = {
      fetchEbayOrders: async () => [order],
      fetchEbayFinancialTransactions: async () => {
        financeCalls += 1;
        return [
          transaction({
            amount: 60,
            bookingEntry: "CREDIT",
            lineItems: [
              {
                feeBasisAmount: 50,
                fees: [{ amount: corrected ? 4 : 6, currency: "USD", feeType: "FINAL_VALUE_FEE" }],
                lineItemId: "line-1",
              },
            ],
            orderId: "order-1",
            totalFeeAmount: corrected ? 4 : 6,
            transactionId: "sale-corrected",
          }),
        ];
      },
    };

    await syncEbaySoldHistory({
      api,
      cwd: workspace,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      now: "2026-07-16T12:00:00.000Z",
    });
    corrected = true;
    const result = await syncEbaySoldHistory({
      api,
      cwd: workspace,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      now: "2026-07-17T12:00:00.000Z",
    });

    expect(financeCalls).toBe(3);
    expect(result.stats).toMatchObject({ applied: 1, duplicate: 0 });
    expect(result.records.find((record) => record.lineItemId === "line-1")?.ebaySaleFees).toBe(2);
  });

  it("forces a safe rebuild when records and sync-state checkpoint digests disagree", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-ebay-sync-checkpoint-"));
    workspaces.push(workspace);
    const requestedFrom: string[] = [];
    const api = {
      fetchEbayOrders: async (_env: unknown, options: { from?: string }) => {
        requestedFrom.push(String(options.from));
        return [order];
      },
      fetchEbayFinancialTransactions: async () => [],
    };

    await syncEbaySoldHistory({
      api,
      cwd: workspace,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      now: "2026-07-16T12:00:00.000Z",
    });
    writeFileSync(join(workspace, "exports", "sold-history", "sold-records-ebay-api.json"), "[]\n");
    await syncEbaySoldHistory({
      api,
      cwd: workspace,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      now: "2026-07-17T12:00:00.000Z",
    });

    expect(requestedFrom).toEqual(["2024-07-17T00:00:00.000Z", "2024-07-18T00:00:00.000Z"]);
  });

  it("clamps a same-day inclusive --to date to the current instant", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-ebay-sync-clamp-"));
    workspaces.push(workspace);
    let requestedTo = "";

    await syncEbaySoldHistory({
      api: {
        fetchEbayOrders: async (_env, options) => {
          requestedTo = String(options.to);
          return [];
        },
        fetchEbayFinancialTransactions: async () => [],
      },
      cwd: workspace,
      dryRun: true,
      env: { EBAY_USER_ACCESS_TOKEN: "not-used-by-fake-api" },
      from: "2026-07-15",
      now: "2026-07-16T18:30:00.000Z",
      to: "2026-07-16",
    });

    expect(requestedTo).toBe("2026-07-16T18:25:00.000Z");
  });

  it("leaves a safety gap so eBay never sees a future end timestamp during clock skew", () => {
    const range = resolveEbaySyncRange({
      from: "2026-07-15",
      now: "2026-07-16T18:30:00.000Z",
    });

    expect(range).toMatchObject({
      clockSkewSafetyMs: 300_000,
      to: "2026-07-16T18:25:00.000Z",
    });
  });

  it("starts incremental overlap at midnight so morning orders on the boundary day are not deleted", () => {
    const range = resolveEbaySyncRange({
      lastSuccessfulTo: "2026-07-16T18:30:00.000Z",
      now: "2026-07-17T18:30:00.000Z",
      refreshOverlapDays: 14,
    });

    expect(range.from).toBe("2026-07-02T00:00:00.000Z");
  });
});
