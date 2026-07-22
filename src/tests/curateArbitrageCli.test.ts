import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectWorkspace = process.cwd();
const scriptPath = join(projectWorkspace, "scripts", "curateRetailArbitrageRun.mjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("retail arbitrage curation CLI", () => {
  it("can safely finalize a run with research left pending", () => {
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
            artist: "Artist",
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
      readFileSync(join(outputDirectory, "retail-arbitrage-2026-07-22.json"), "utf8"),
    );
    expect(finalPayload).toMatchObject({
      phase: "final",
      publicationStatus: "final",
      runId: "scan-pending-test",
    });
    expect(finalPayload.finds[0]).toMatchObject({
      decision: "REVIEW",
      ebayResearchStatus: "pending",
    });
  });
});
