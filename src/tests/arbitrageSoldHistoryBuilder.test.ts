import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

describe("arbitrage sold-history CSV builder", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true });
  });

  it("produces condition-specific, quantity-weighted 30/90/365-day evidence", () => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-sold-builder-"));
    workspaces.push(workspace);
    const input = join(workspace, "orders.csv");
    const output = join(workspace, "output");
    writeFileSync(
      input,
      [
        "Sales Record Number,Order Number,Item Number,Item Title,Custom Label,Quantity,Sold For,Shipping And Handling,Total Price,Sale Date",
        '1,order-1,1001,"Artist - Album Brand New/Sealed Vinyl",Whole Test,3,$20.00,$6.00,$66.00,Jul-10-26',
        '2,order-2,1001,"Artist - Album Factory Sealed Vinyl",Whole Test,1,$30.00,$0.00,$30.00,Jun-01-26',
        '3,order-3,1001,"Artist - Album VG+/VG+ Vinyl",Used Test,2,$10.00,$4.00,$24.00,Oct-01-25',
        '4,order-4,1001,"Artist - Album Vinyl",Unknown Test,1,$8.00,$4.00,$12.00,Jan-01-24',
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/buildSoldHistoryFromEbayCsv.mjs"),
        input,
        output,
        "test-sheet",
        "--as-of=2026-07-15",
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const index = JSON.parse(readFileSync(join(output, "sold-comps-index.json"), "utf8"));
    const comp = index.comps[0];

    expect(index).toMatchObject({
      recordCount: 4,
      snapshotDate: "2026-07-15",
      unitCount: 7,
      version: 2,
    });
    expect(comp).toMatchObject({
      conditionCounts: { new_sealed: 4, unknown: 1, used: 2 },
      conditionTransactionCounts: { new_sealed: 2, unknown: 1, used: 1 },
      count: 7,
      evidenceScope: "single-account-own-sales",
      oneSellerSoldCount: null,
      supportsMarketplaceSellerRepeatProof: false,
      transactionCount: 4,
      unitsSold: 7,
      unitsSold30Days: 3,
      unitsSold90Days: 4,
      unitsSold365Days: 6,
    });
    expect(comp.conservativeResalePrice).toBe(22);
    expect(comp.conditionMetrics.new_sealed).toMatchObject({
      averageShipping: 1.5,
      conservativeResalePrice: 22,
      latestSaleDate: "2026-07-10",
      priceP25_90Days: 22,
      salesPerMonth90Days: 1.33,
      transactionCount: 2,
      unitsSold: 4,
      unitsSold30Days: 3,
      unitsSold90Days: 4,
      unitsSold365Days: 4,
    });
    expect(comp.conditionMetrics.used).toMatchObject({
      averageShipping: 2,
      priceP25: 12,
      unitsSold365Days: 2,
    });
    expect(comp.priceP25).toBe(12);
  });
});
