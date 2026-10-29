import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admittedSourceIds, assertResearchReady, assertWorkflowDraftFresh, browserRecoveryScan, freshWorkflowDraftSummary, researchProgress, scannerOutputPath, workflowFailure } from "../../scripts/lib/retailWorkflowState.mjs";
import { buildProductResearchPlan } from "../../scripts/lib/productResearchCuration.mjs";
import { mergeVerifiedSourceUpdates } from "../server/retailSourceUpdates";
import { acquireResearchSession, readResearchSession, updateResearchSession } from "../../scripts/lib/retailResearchSession.mjs";

const at = "2026-09-05T00:00:00.000Z";
const find = { id: "record", artist: "Mother Love Bone", title: "Shine", purchasePrice: 10, sourceId: "shop", sourceName: "Shop", sourceUrl: "https://shop.example/products/shine", capturedAt: at };
const draft = { runId: "scan-test", researchCandidates: [find], createdAt: at, finds: [find] };
const query = buildProductResearchPlan([find])[0].variants[0].query;
const verifiedCapture = { query, status: "complete", capturedAt: at, condition: "New", category: "Vinyl Records", complete: true, completePagination: true, periodDays: 90,
  observedWindow: { startDate: "2026-06-07", endDate: "2026-09-05" },
  url: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&conditionId=1000&categoryId=176985&tabName=SOLD&dayRange=90`, rows: [] };

describe("retail workflow state", () => {
  it("retains failure cause and stage without leaking raw output or credentials", () => {
    const failure = workflowFailure({ message: "Workflow failed: HTTP 403 https://secret.example/?token=private-token Authorization: Bearer private-key", workflowStep: "scripts/runRetailArbitrageScan.mjs" }, "running");
    expect(failure).toMatchObject({ code: "access_denied", stage: "scripts/runRetailArbitrageScan.mjs" });
    expect(JSON.stringify(failure)).not.toMatch(/secret\.example|private-token|private-key|Authorization/);
    expect(workflowFailure({ message: "Research incomplete: 1/12 offers completed" }, "research")).toMatchObject({ code: "research_incomplete", stage: "research" });
    expect(workflowFailure({ message: "Unknown error containing private data", workflowStep: "https://secret.example/?token=private" }, "untrusted-value")).toMatchObject({ code: "workflow_step_failed", stage: "unknown" });
  });
  it("expires acquisition drafts before slow research can hold discovery indefinitely", () => {
    expect(() => assertWorkflowDraftFresh(draft, at)).not.toThrow();
    expect(() => assertWorkflowDraftFresh(draft, "2026-09-06T00:00:00Z")).not.toThrow();
    expect(() => assertWorkflowDraftFresh(draft, "2026-09-06T00:00:01Z")).toThrow("Start a fresh scan");
    expect(() => assertWorkflowDraftFresh({ ...draft, createdAt: "invalid" }, at)).toThrow("invalid observation time");
    expect(() => assertWorkflowDraftFresh({ ...draft, createdAt: "2026-09-05T01:00:00Z" }, at)).toThrow("invalid observation time");
  });

  it("still blocks publication when any selected research remains pending or deferred", () => {
    const pending = researchProgress(draft, { runId: draft.runId, entries: [] }, new Date(at));
    expect(() => assertResearchReady(pending)).toThrow("Research incomplete");
    const complete = researchProgress(draft, { runId: draft.runId, entries: [{ findId: find.id, runs: [verifiedCapture] }] }, new Date(at));
    expect(() => assertResearchReady(complete, { deferred: 1 })).toThrow("Research incomplete");
    expect(() => assertResearchReady(complete, { deferred: 0 })).not.toThrow();
    expect(() => assertResearchReady(complete, { editionReviews: 1 })).toThrow("edition reviews");
    expect(() => assertResearchReady(complete, { editionReviews: 0, reviewedEditions: 1 })).not.toThrow();
  });

  it("honors --full despite a recent unfinished workflow and leaves its evidence intact", () => {
    const fixture = workflowFixture();
    try {
      const before = readFileSync(fixture.draftPath, "utf8");
      const result = fixture.run(["--full", "--localOnly"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const context = JSON.parse(readFileSync(fixture.contextPath, "utf8"));
      expect(context.supersededByRunId).toBe("fresh-run");
      expect(readFileSync(fixture.draftPath, "utf8")).toBe(before);
      const fresh = JSON.parse(readFileSync(join(fixture.exportDir, "fresh-draft.json"), "utf8"));
      expect(fresh.researchCandidates).toEqual([]);
      expect(fresh.researchBacklog).toMatchObject({ deferredCount: 1, carriedCount: 0 });
      expect(JSON.parse(readFileSync(join(fixture.workspace, "scanner-arguments.json"), "utf8"))).toContain("--skipUpload");
    } finally { fixture.cleanup(); }
  });

  it("rejects an expired explicit resume or finish before any research or publication work", () => {
    const fixture = workflowFixture("2026-09-05T00:00:00Z");
    try {
      const before = readFileSync(fixture.contextPath, "utf8");
      for (const option of ["resume", "finish"]) {
        const result = fixture.run([`--${option}=${fixture.contextPath}`, "--localOnly"]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Start a fresh scan");
        expect(readFileSync(fixture.contextPath, "utf8")).toBe(before);
      }
      expect(readdirSync(fixture.workspace)).not.toContain("steps.jsonl");
    } finally { fixture.cleanup(); }
  });

  it.each([["--full"], ["--sources=shop"]])("rolls an owned retained session into a deliberate new scan %s", (...scanArgs) => {
    const fixture = workflowFixture();
    try {
      const session = acquireResearchSession(fixture.workspace, { ownerThreadId: "recovery-test", binding: {
        profileName: "Test profile", extensionInstanceId: "test-extension", expectedSellerHandle: "test-seller",
      } });
      updateResearchSession(fixture.workspace, session.ownerToken, "bind", { contextPath: fixture.contextPath });
      const priorBytes = readFileSync(fixture.draftPath, "utf8");
      const result = fixture.run([...scanArgs, "--localOnly"], { RETAIL_RESEARCH_OWNER: session.ownerToken });
      expect(result.status, result.stderr).toBe(0);
      const rolled = readResearchSession(fixture.workspace);
      expect(rolled?.workflowRunId).toBe("fresh-run");
      expect(rolled?.binding).toEqual(session.binding);
      expect(readFileSync(fixture.draftPath, "utf8")).toBe(priorBytes);
    } finally { fixture.cleanup(); }
  });

  it("validates a local-only final without posting status or uploading even when credentials exist", () => {
    const fixture = workflowFixture();
    try {
      // No research is necessary for this source-only fixture. Real records
      // still pass assertResearchReady before curation and uploader validation.
      writeFileSync(fixture.draftPath, JSON.stringify({ runId: "prior-run", phase: "scan", createdAt: new Date().toISOString(), researchCandidates: [], finds: [], sourceReports: [] }));
      const result = fixture.run([`--finish=${fixture.contextPath}`, "--localOnly"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const steps = readFileSync(join(fixture.workspace, "steps.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      const uploads = steps.filter(step => step.step === "upload");
      expect(uploads).toHaveLength(1);
      expect(uploads[0].args).toContain("--dryRun");
      const context = JSON.parse(readFileSync(fixture.contextPath, "utf8"));
      expect(context.status).toBe("validated");
      expect(context.validatedAt).toBeTruthy();
      expect(context.publishedAt).toBeUndefined();
    } finally { fixture.cleanup(); }
  });

  it("records an actionable reason when selected research blocks finish", () => {
    const fixture = workflowFixture();
    try {
      const result = fixture.run([`--finish=${fixture.contextPath}`, "--localOnly"]);
      expect(result.status).not.toBe(0);
      const context = JSON.parse(readFileSync(fixture.contextPath, "utf8"));
      expect(context).toMatchObject({ status: "failed", failure: { code: "research_incomplete", stage: "research" } });
      expect(context.failure.failedAt).toBeTruthy();
      expect(JSON.stringify(context.failure)).not.toContain("test-token");
      expect(readFileSync(join(fixture.workspace, "steps.jsonl"), "utf8")).not.toContain("upload");
    } finally { fixture.cleanup(); }
  });
  it("starts browser recovery as a bounded refresh from exact prior evidence", () => {
    const previousScan = { ...draft, phase: "final", sourceReports: [{ id: "old" }] };
    const input = { previousScan, previousScanPath: "prior-final.json", observationsPath: "visible-pages.json", now: at,
      observations: { version: 1, captureMethod: "visible_browser", pages: [
        { sourceId: "shop", capturedAt: at }, { sourceId: "shop", capturedAt: at },
        { sourceId: "other", capturedAt: at }, { sourceId: "stale", capturedAt: "2026-09-04T00:00:00Z" },
        { sourceId: "discovery-feed", capturedAt: at, retailerOfferEvidence: { retailerId: "amazon" } },
      ] },
    };
    const recovery = browserRecoveryScan(input);
    expect(recovery).toMatchObject({ mode: "refresh", previousRunId: draft.runId, sourceIds: ["shop", "other"] });
    expect(recovery.scanArgs).toEqual(["scripts/runRetailArbitrageScan.mjs", "--skipUpload", "--skipEbaySync", "--browserOnly", "--browserObservations=visible-pages.json", "--previousScan=prior-final.json", "--sources=shop,other"]);
    expect(() => browserRecoveryScan({ ...input, previousScanPath: "" })).toThrow("requires");
    expect(() => browserRecoveryScan({ ...input, previousScan: { ...previousScan, phase: "published-context" } })).toThrow("exact scan draft or final");
    expect(() => browserRecoveryScan({ ...input, observations: { ...input.observations, pages: [{ sourceId: "stale", capturedAt: "2026-09-04T00:00:00Z" }] } })).toThrow("no fresh");
    expect(() => browserRecoveryScan({ ...input, observations: { ...input.observations, pages: [{ sourceId: "discovery-feed", capturedAt: at, retailerOfferEvidence: { retailerId: "amazon" } }] } })).toThrow("no fresh");
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
      writeFileSync(join(workspace, "scripts", "enrichRetailReleaseIdentity.mjs"), 'console.log(JSON.stringify({checked:0,pending:0}));');
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
    const checkpoint = (status: string) => ({ runId: draft.runId, entries: [{ findId: find.id, runs: [{ ...verifiedCapture, status }] }] });
    expect(researchProgress(draft, checkpoint("complete"), new Date(at))).toMatchObject({ completed: 1, validated: 0, noRows: 1, pending: 0, complete: true });
    expect(researchProgress(draft, checkpoint("blocked"), new Date(at))).toMatchObject({ completed: 0, noRows: 0, failed: 1, complete: false });
  });

  it("counts validated matched evidence while retaining incomplete work in the full plan", () => {
    const second = { ...find, id: "other", title: "Other Release" };
    const checkpoint = { runId: draft.runId, entries: [{ findId: find.id, runs: [{ ...verifiedCapture, rows: [{ title: "Mother Love Bone - Shine Vinyl LP New Sealed", itemUrl: "https://www.ebay.com/itm/123456789012", totalSold: 2, avgSoldPrice: 30, avgShipping: 5, dateLastSold: "2026-08-30" }] }] }] };
    expect(researchProgress({ ...draft, researchCandidates: [find, second] }, checkpoint, new Date(at))).toMatchObject({ planned: 2, completed: 1, validated: 1, researchedRows: 1, pending: 1, complete: false });
  });

  it("requires every carried offer across work batches and refuses a wrong-run checkpoint", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ ...find, id: `row-${i}` }));
    const entries = rows.slice(0, 240).map((row) => ({ findId: row.id, runs: [{ ...verifiedCapture }] }));
    expect(researchProgress({ ...draft, researchCandidates: rows }, { runId: draft.runId, entries }, new Date(at))).toMatchObject({ planned: 300, completed: 240, pending: 60, outsidePlan: 0, limit: 300, complete: false });
    expect(researchProgress({ ...draft, researchCandidates: rows }, { runId: draft.runId, entries: rows.map(row => ({ findId: row.id, runs: [{ ...verifiedCapture }] })) }, new Date(at))).toMatchObject({ completed: 300, pending: 0, complete: true });
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

function workflowFixture(createdAt = new Date().toISOString()) {
  const workspace = mkdtempSync(join(tmpdir(), "retail-workflow-lifecycle-"));
  const exportDir = join(workspace, "exports", "arbitrage-finds");
  mkdirSync(exportDir, { recursive: true });
  mkdirSync(join(workspace, "scripts"));
  const draftPath = join(exportDir, "prior-draft.json");
  const checkpointPath = join(exportDir, "research-checkpoint-prior-run.json");
  const contextPath = join(exportDir, "workflow-1.json");
  writeFileSync(draftPath, JSON.stringify({ ...draft, runId: "prior-run", phase: "scan", createdAt }));
  writeFileSync(checkpointPath, JSON.stringify({ runId: "prior-run", entries: [] }));
  writeFileSync(contextPath, JSON.stringify({ runId: "prior-run", status: "research", mode: "full", draftPath, checkpointPath }));
  writeFileSync(join(workspace, "scripts", "enrichRetailReleaseIdentity.mjs"), 'console.log("{}");');
  writeFileSync(join(workspace, "scripts", "prepareArbitrageResearchPlan.mjs"), `
    import { appendFileSync } from "node:fs";
    appendFileSync("steps.jsonl", JSON.stringify({step:"plan"}) + "\\n");
    console.log(JSON.stringify({outputPath:"mock-plan.json", queueSummary:{tasks:0,pending:0,deferred:0}}));
  `);
  writeFileSync(join(workspace, "scripts", "runRetailArbitrageScan.mjs"), `
    import { writeFileSync } from "node:fs";
    import { resolve } from "node:path";
    const outputPath = resolve("exports/arbitrage-finds/fresh-draft.json");
    writeFileSync("scanner-arguments.json", JSON.stringify(process.argv.slice(2)));
    writeFileSync(outputPath, JSON.stringify({runId:"fresh-run", phase:"scan", createdAt:new Date().toISOString(), researchCandidates:[], finds:[], sourceReports:[]}));
    console.log(JSON.stringify({outputPath}));
  `);
  writeFileSync(join(workspace, "scripts", "curateRetailArbitrageRun.mjs"), `
    import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
    import { resolve } from "node:path";
    const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const finalPath = resolve("exports/arbitrage-finds/final.json");
    writeFileSync(finalPath, JSON.stringify({...payload, phase:"final", runQuality:{publishable:true}}));
    appendFileSync("steps.jsonl", JSON.stringify({step:"curate"}) + "\\n");
    console.log(JSON.stringify({finalPath}));
  `);
  writeFileSync(join(workspace, "scripts", "uploadLatestArbitrageFinds.mjs"), `
    import { appendFileSync } from "node:fs";
    appendFileSync("steps.jsonl", JSON.stringify({step:"upload",args:process.argv.slice(2)}) + "\\n");
    if (!process.argv.includes("--dryRun")) throw new Error("Live upload attempted");
  `);
  return { workspace, exportDir, draftPath, contextPath,
    run: (args: string[], extraEnv: Record<string, string> = {}) => spawnSync(process.execPath, [join(process.cwd(), "scripts", "runRetailWorkflow.mjs"), ...args], {
      cwd: workspace, encoding: "utf8", windowsHide: true, timeout: 10000,
      env: { ...process.env, ARBITRAGE_UPLOAD_URL: "http://127.0.0.1:1/api/arbitrage/upload", ARBITRAGE_UPLOAD_TOKEN: "test-token", ...extraEnv },
    }),
    cleanup: () => rmSync(workspace, { recursive: true, force: true }),
  };
}
