import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectWorkspace = process.cwd();
const scriptPath = join(
  projectWorkspace,
  "scripts",
  "curateRetailArbitrageRun.mjs",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("retail arbitrage curation CLI", () => {
  it("removes dated resale evidence when a browser check identifies another pressing", () => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-curation-"));
    temporaryDirectories.push(workspace);
    const outputDirectory = join(workspace, "exports", "arbitrage-finds");
    mkdirSync(outputDirectory, { recursive: true });
    const at = new Date().toISOString();
    const url = "https://www.amazon.com/dp/B000000001";
    const purchaseBlockText = "Buy New\n$10.00\nIn Stock\nAdd to cart\nShipper / Seller\nAmazon.com";
    const page = { sourceId: "slickdeals-vinyl-records", url, capturedAt: at, outcome: "available",
      productHeadingText: "Actual Album (Amazon Exclusive)", artistText: "Example Artist",
      visibleText: `Actual Album (Amazon Exclusive)\nExample Artist\nFormat: Vinyl\nAmazon Exclusive Edition\n${purchaseBlockText}`,
      purchaseBlockText,
      productEvidence: { artist: "Example Artist", title: "Actual Album", format: "Vinyl", price: 10, currency: "USD", available: true },
      retailerOfferEvidence: { retailerId: "amazon", productId: "B000000001", selectedFormat: true, selectedFormatText: "Format: Vinyl",
        editionText: "Amazon Exclusive Edition", condition: "new", conditionText: "Buy New", priceText: "$10.00",
        availabilityText: "In Stock", purchaseActionText: "Add to cart", sellerText: "Shipper / Seller\nAmazon.com", fulfillerText: "Shipper / Seller\nAmazon.com" } };
    writeFileSync(join(outputDirectory, "browser-source-observations.json"), JSON.stringify({ version: 1, captureMethod: "visible_browser", pages: [page] }));
    const scanPath = join(outputDirectory, "raw-scan.json");
    writeFileSync(scanPath, JSON.stringify({ createdAt: at, phase: "scan", runId: "scan-edition-test", schemaVersion: 2,
      runManifest: { scannerVersion: "retail-arbitrage/5" },
      finds: [{ id: "example", sourceId: page.sourceId, sourceName: "Slickdeals", sourceUrl: url,
        artist: "Example Artist", title: "Actual Album", capturedAt: at, condition: "new/sealed", purchasePrice: 10,
        identityStatus: "resolved", retailEditionText: "Standard black vinyl", averageSoldPrice: 80, conservativeResalePrice: 80,
        activeEvidence: { status: "available", searchComplete: true }, ebayActiveSearchComplete: true, lowestActivePrice: 90,
        soldEvidence: { status: "validated", source: "ebay-product-research", condition: "new_sealed", conservativeResalePrice: 80,
          capturedAt: at, unitsSold90Days: 12, velocityEvidence: "verified_window_totals", matchConfidence: "high" } }] }));
    const result = spawnSync(process.execPath, [scriptPath, scanPath, "--pending"], { cwd: workspace, encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const final = JSON.parse(readFileSync(join(outputDirectory, "retail-arbitrage-final-scan-edition-test.json"), "utf8"));
    expect(final.finds[0].retailVerification.status).toBe("verified");
    expect(final.finds[0].retailEditionText).toContain("Amazon Exclusive");
    expect(final.finds[0].conservativeResalePrice).toBeNull();
    expect(final.finds[0].gates.soldEvidence).toBe(false);
    expect(final.finds[0].activeEvidence?.searchComplete).not.toBe(true);
    expect(final.finds[0].lowestActivePrice).not.toBe(90);
    expect(final.finds[0].decision).not.toBe("BUY");
  });
  it.each(["Artist", null])("can safely finalize pending research with artist %s", (artist) => {
    const workspace = mkdtempSync(join(tmpdir(), "record-scanner-curation-"));
    temporaryDirectories.push(workspace);
    const outputDirectory = join(workspace, "exports", "arbitrage-finds");
    mkdirSync(outputDirectory, { recursive: true });
    const scanPath = join(outputDirectory, "raw-scan.json");
    writeFileSync(
      scanPath,
      JSON.stringify({
        createdAt: "2026-07-22T12:00:00.000Z",
        finds: [
          {
            artist,
            capturedAt: "2026-07-22T12:00:00.000Z",
            condition: "new/sealed",
            id: "candidate-1",
            opportunityType: "product_deal",
            purchasePrice: 10,
            sourceId: "shop",
            sourceName: "Shop",
            sourceUrl: "https://shop.example/products/album",
            title: "Album",
          },
        ],
        phase: "scan",
        publicationStatus: "draft",
        runId: "scan-pending-test",
        schemaVersion: 2,
        source: "sale-radar-retail-arbitrage-scan",
      }),
    );

    const result = spawnSync(
      process.execPath,
      [scriptPath, scanPath, "--pending", "2026-07-22"],
      { cwd: workspace, encoding: "utf8", windowsHide: true },
    );

    expect(result.status, result.stderr).toBe(0);
    const finalPayload = JSON.parse(
      readFileSync(
        join(outputDirectory, "retail-arbitrage-final-scan-pending-test.json"),
        "utf8",
      ),
    );
    expect(finalPayload).toMatchObject({
      phase: "final",
      publicationStatus: "final",
      runId: "scan-pending-test",
    });
    expect(finalPayload.finds[0]).toMatchObject({
      artist: artist ?? "Unknown Artist",
      decision: "REVIEW",
      ebayResearchStatus: "pending",
    });
    if (artist === null) expect(finalPayload.finds[0].identityStatus).toBe("unresolved");
  });
});
