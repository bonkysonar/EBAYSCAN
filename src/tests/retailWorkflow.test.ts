import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admittedSourceIds, browserRecoveryScan, freshWorkflowDraftSummary, researchProgress, scannerOutputPath } from "../../scripts/lib/retailWorkflowState.mjs";
import { buildProductResearchPlan } from "../../scripts/lib/productResearchCuration.mjs";
import { mergeVerifiedSourceUpdates } from "../server/retailSourceUpdates";

const at = "2026-09-05T00:00:00.000Z";
const find = { id: "record", artist: "Mother Love Bone", title: "Shine", purchasePrice: 10, sourceId: "shop", sourceName: "Shop", sourceUrl: "https://shop.example/products/shine", capturedAt: at };
const draft = { runId: "scan-test", researchCandidates: [find], createdAt: at, finds: [find] };
const query = buildProductResearchPlan([find])[0].variants[0].query;

describe("retail workflow state", () => {
  it("starts browser recovery as a bounded refresh from exact prior evidence", () => {
    const previousScan = { ...draft, phase: "final", sourceReports: [{ id: "old" }] };
    const input = { previousScan, previousScanPath: "prior-final.json", observationsPath: "visible-pages.json", now: at,
      observations: { version: 1, captureMethod: "visible_browser", pages: [
        { sourceId: "shop", capturedAt: at }, { sourceId: "shop", capturedAt: at },
        { sourceId: "other", capturedAt: at }, { sourceId: "stale", capturedAt: "2026-09-04T00:00:00Z" },
      ] },
    };
    const recovery = browserRecoveryScan(input);
    expect(recovery).toMatchObject({ mode: "refresh", previousRunId: draft.runId, sourceIds: ["shop", "other"] });
    expect(recovery.scanArgs).toEqual(["scripts/runRetailArbitrageScan.mjs", "--skipUpload", "--skipEbaySync", "--browserOnly", "--browserObservations=visible-pages.json", "--previousScan=prior-final.json", "--sources=shop,other"]);
    expect(() => browserRecoveryScan({ ...input, previousScanPath: "" })).toThrow("requires");
    expect(() => browserRecoveryScan({ ...input, previousScan: { ...previousScan, phase: "published-context" } })).toThrow("exact scan draft or final");
    expect(() => browserRecoveryScan({ ...input, observations: { ...input.observations, pages: [{ sourceId: "stale", capturedAt: "2026-09-04T00:00:00Z" }] } })).toThrow("no fresh");
  });

  it("uses the scanner's exact new draft and counts actual output sources", () => {
    expect(scannerOutputPath('Progress: retailer checked\n{\n  "outputPath": "new-draft.json"\n}\n')).toBe("new-draft.json");
    expect(() => scannerOutputPath('{"status":"complete"}')).toThrow("exact output path");
    const output = { ...draft, runId: "new-scan", phase: "scan", sourceReports: [{ id: "shop" }, { id: "other" }] };
    expect(freshWorkflowDraftSummary(output, { startedAt: at, previousRunId: draft.runId })).toEqual({ runId: "new-scan", sourceCount: 2 });
    for (const change of [{ phase: "final" }, { runId: draft.runId }, { createdAt: "2026-09-04T00:00:00Z" }])
      expect(() => freshWorkflowDraftSummary({ ...output, ...change }, { startedAt: at, previousRunId: draft.runId })).toThrow("new unpublished draft");
  });

  it("creates a separate browser recovery workflow without changing published evidence or broad cadence", () => {
    const workspace = mkdtempSync(join(tmpdir(), "retail-workflow-browser-"));
    try {
      const exportDir = join(workspace, "exports", "arbitrage-finds");
      mkdirSync(exportDir, { recursive: true });
      mkdirSync(join(workspace, "scripts"));
      const oldPath = join(exportDir, "prior-final.json");
      const previous = JSON.stringify({ ...draft, phase: "final", sourceReports: [{ id: "prior" }] });
      writeFileSync(oldPath, previous);
      const cadencePath = join(exportDir, "workflow-cadence.json");
      const cadence = JSON.stringify({ lastBroadDate: "1900-01-01", rotation: 37 });
      writeFileSync(cadencePath, cadence);
      const observationPath = join(workspace, "observations.json");
      writeFileSync(observationPath, JSON.stringify({ version: 1, captureMethod: "visible_browser", pages: ["shop", "other", "third"].map((sourceId) => ({ sourceId, capturedAt: new Date().toISOString() })) }));
      writeFileSync(join(workspace, "scripts", "runRetailArbitrageScan.mjs"), `
        import { writeFileSync } from "node:fs";
        import { resolve } from "node:path";
        writeFileSync("scanner-arguments.json", JSON.stringify(process.argv.slice(2)));
        const outputPath = resolve("exports/arbitrage-finds/new-browser-draft.json");
        const payload = { runId: "fresh-browser-run", phase: "scan", createdAt: new Date().toISOString(), finds: [${JSON.stringify(find)}], sourceReports: [{id:"shop"}, {id:"other"}] };
        writeFileSync(outputPath, JSON.stringify(payload));
        writeFileSync("exports/arbitrage-finds/retail-arbitrage-decoy.json", JSON.stringify({...payload, runId:"wrong-concurrent-run", createdAt:"2099-01-01T00:00:00Z"}));
        console.log("Mock scanner progress");
        console.log(JSON.stringify({activeEnrichment:{status:"skipped"}, outputPath}, null, 2));
      `);
      writeFileSync(join(workspace, "scripts", "prepareArbitrageResearchPlan.mjs"), `
        import { writeFileSync } from "node:fs";
        import { resolve } from "node:path";
        const outputPath = resolve("exports/arbitrage-finds/new-browser-plan.json");
        writeFileSync(outputPath, "{}");
        console.log(JSON.stringify({outputPath}));
      `);
      const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "runRetailWorkflow.mjs"), "--browserOnly", "--full", "--browserObservations=" + observationPath, "--previousScan=" + oldPath], {
        cwd: workspace, encoding: "utf8", windowsHide: true,
        env: { ...process.env, ARBITRAGE_UPLOAD_URL: "", ARBITRAGE_UPLOAD_TOKEN: "" },
      });
      expect(result.status, result.stderr).toBe(0);
      const contextName = readdirSync(exportDir).find((name) => /^workflow-\d+\.json$/.test(name))!;
      const context = JSON.parse(readFileSync(join(exportDir, contextName), "utf8"));
      expect(context).toMatchObject({ mode: "refresh", browserOnly: true, runId: "fresh-browser-run", previousRunId: draft.runId, sourceCount: 2, status: "research", researchProgress: { planned: 1, pending: 1, completed: 0, complete: false } });
      expect(context.draftPath).toBe(join(exportDir, "new-browser-draft.json"));
      expect(context.checkpointPath).toBe(join(exportDir, "research-checkpoint-fresh-browser-run.json"));
      expect(context.planPath).toBe(join(exportDir, "new-browser-plan.json"));
      expect(JSON.parse(readFileSync(join(workspace, "scanner-arguments.json"), "utf8"))).toContain("--sources=shop,other,third");
      expect(readFileSync(oldPath, "utf8")).toBe(previous);
      expect(readFileSync(cadencePath, "utf8")).toBe(cadence);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
  it("does not call an empty or pending checkpoint completed research", () => {
    expect(researchProgress(draft, { runId: draft.runId, entries: [] }, new Date(at))).toMatchObject({ planned: 1, completed: 0, validated: 0, noRows: 0, pending: 1, complete: false });
    expect(researchProgress(draft, { runId: draft.runId, entries: [{ findId: find.id, runs: [{ query, status: "pending", rows: [] }] }] }, new Date(at))).toMatchObject({ completed: 0, noRows: 0, pending: 1, complete: false });
  });

  it("counts successful empty searches separately from failed searches", () => {
    const checkpoint = (status: string) => ({ runId: draft.runId, entries: [{ findId: find.id, runs: [{ query, status, rows: [] }] }] });
    expect(researchProgress(draft, checkpoint("complete"), new Date(at))).toMatchObject({ completed: 1, validated: 0, noRows: 1, pending: 0, complete: true });
    expect(researchProgress(draft, checkpoint("blocked"), new Date(at))).toMatchObject({ completed: 0, noRows: 0, failed: 1, complete: false });
  });

  it("counts validated matched evidence while retaining incomplete work in the full plan", () => {
    const second = { ...find, id: "other", title: "Other Release" };
    const checkpoint = { runId: draft.runId, entries: [{ findId: find.id, runs: [{ query, status: "complete", rows: [{ title: "Mother Love Bone - Shine Vinyl LP New Sealed", totalSold: 2, avgSoldPrice: 30, avgShipping: 5, dateLastSold: "2026-08-30" }] }] }] };
    expect(researchProgress({ ...draft, researchCandidates: [find, second] }, checkpoint, new Date(at))).toMatchObject({ planned: 2, completed: 1, validated: 1, researchedRows: 1, pending: 1, complete: false });
  });

  it("keeps the workflow bounded at 240 and refuses a wrong-run checkpoint", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ ...find, id: `row-${i}` }));
    const entries = rows.slice(0, 240).map((row) => ({ findId: row.id, runs: [{ query, status: "complete", rows: [] }] }));
    expect(researchProgress({ ...draft, researchCandidates: rows }, { runId: draft.runId, entries }, new Date(at))).toMatchObject({ planned: 240, completed: 240, outsidePlan: 60, limit: 240, complete: false });
    expect(() => researchProgress(draft, { runId: "scan-other", entries: [] })).toThrow("another scan");
  });

  it("reports the same admitted source count as the publication contract", () => {
    const reports = [
      { id: "productive", catalogPageAvailableCount: 1, catalogHealth: "healthy", productParseHealth: "productive" },
      { id: "empty", catalogPageAvailableCount: 1, catalogHealth: "healthy", productParseHealth: "empty" },
      { id: "failed", catalogPageAvailableCount: 1, catalogHealth: "failed", productParseHealth: "productive" },
      { id: "sale", salePageAvailableCount: 1, salePageHealth: "partial" },
      { id: "failed-sale", salePageAvailableCount: 1, salePageHealth: "failed" },
    ];
    const ids = reports.map((row) => row.id);
    const payload = { ...draft, sourceReports: reports, sourceUpdateVersion: 1, runManifest: { scannedSourceCount: reports.length, sourceCatalogCount: reports.length } };
    const admitted = mergeVerifiedSourceUpdates(payload, null, ids, Date.parse(at));
    expect(admittedSourceIds(payload)).toEqual(["productive", "sale"]);
    expect(admittedSourceIds(payload)).toEqual(admitted.sourceUpdates!.updatedSourceIds);
  });
});
