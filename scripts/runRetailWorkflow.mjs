import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { admittedSourceIds, browserRecoveryScan, freshWorkflowDraftSummary, researchProgress, scannerOutputPath, WORKFLOW_RESEARCH_LIMIT } from "./lib/retailWorkflowState.mjs";
const cwd = process.cwd(),
  dir = join(cwd, "exports", "arbitrage-finds");
for (const line of (existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
  : ""
).split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (match && !process.env[match[1]])
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
}
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || true];
  }),
);
mkdirSync(dir, { recursive: true });
const cadencePath = join(dir, "workflow-cadence.json");
const cadence = existsSync(cadencePath)
  ? JSON.parse(readFileSync(cadencePath, "utf8"))
  : {};
if (args.has("finish") && ["browserOnly", "browserObservations", "previousScan"].some((name) => args.has(name)))
  throw new Error("Browser retailer recovery must start a new workflow; these scan options cannot change an existing draft.");
if (args.has("previousScan") && !args.has("browserOnly")) throw new Error("--previousScan requires a new --browserOnly recovery workflow.");
let context = args.has("finish")
  ? JSON.parse(readFileSync(resolve(String(args.get("finish"))), "utf8"))
  : null;
if (context) context.contextPath = resolve(String(args.get("finish")));
try {
  if (!context) {
    const browserObservationsPath = args.has("browserObservations") ? argumentPath("browserObservations") : null;
    const previousScanPath = args.has("previousScan") ? argumentPath("previousScan") : null;
    const recovery = args.has("browserOnly") ? browserRecoveryScan({
      observationsPath: browserObservationsPath,
      observations: browserObservationsPath ? JSON.parse(readFileSync(browserObservationsPath, "utf8")) : null,
      previousScanPath,
      previousScan: previousScanPath ? JSON.parse(readFileSync(previousScanPath, "utf8")) : null,
    }) : null;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const latest = latestArtifact();
    const localHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()),
    );
    const full =
      args.has("full") ||
      !latest ||
      (localHour >= 5 && cadence.lastBroadDate !== today);
    const activeSources = [
      ...new Set([
        ...(latest?.saleEvents ?? [])
          .filter((c) => !["ended", "unknown"].includes(c.saleStatus))
          .map((c) => c.sourceId),
        ...(latest?.finds ?? [])
          .filter((f) => ["A", "B"].includes(f.candidateTier))
          .map((f) => f.sourceId),
      ]),
    ].filter(Boolean);
    const priority = (latest?.sourceReports ?? [])
      .filter((r) => Number(r.priority) <= 2)
      .map((r) => r.id);
    const offset =
      Number(cadence.rotation ?? 0) % Math.max(1, activeSources.length);
    const pinned = activeSources
      .filter((id) => priority.includes(id))
      .slice(0, 6);
    const selected = [
      ...new Set([
        ...pinned,
        ...activeSources.slice(offset),
        ...activeSources.slice(0, offset),
        ...priority,
      ]),
    ].slice(0, 12);
    context = {
      version: 1,
      mode: recovery ? "refresh" : full || !selected.length ? "full" : "refresh",
      startedAt: new Date().toISOString(),
      runId: "workflow-" + Date.now(),
      ...(recovery ? { browserOnly: true, previousScanPath, previousRunId: recovery.previousRunId, requestedSourceIds: recovery.sourceIds } : {}),
    };
    const contextPath = join(dir, `${context.runId}.json`);
    context.contextPath = contextPath;
    await status("running");
    if (!recovery) {
      if (context.mode === "full") cadence.lastBroadDate = today;
      cadence.rotation = offset + 4;
      writeFileSync(cadencePath, JSON.stringify(cadence, null, 2));
    }
    const scanArgs = recovery?.scanArgs ?? ["scripts/runRetailArbitrageScan.mjs", "--skipUpload"];
    if (browserObservationsPath) {
      context.browserObservationsPath = browserObservationsPath;
    }
    if (browserObservationsPath && !recovery) {
      scanArgs.push("--browserObservations=" + context.browserObservationsPath);
    }
    if (context.mode === "refresh" && !recovery)
      scanArgs.push("--sources=" + selected.join(","), "--skipEbaySync");
    const scanResult = run(scanArgs, true);
    process.stdout.write(scanResult.stdout);
    const draftPath = resolve(scannerOutputPath(scanResult.stdout));
    if (draftPath === previousScanPath) throw new Error("The scanner returned the previous artifact instead of a new draft.");
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    Object.assign(context, freshWorkflowDraftSummary(draft, context));
    context.draftPath = draftPath;
    context.checkpointPath = join(
      dir,
      `research-checkpoint-${draft.runId}.json`,
    );
    if (!existsSync(context.checkpointPath))
      writeFileSync(
        context.checkpointPath,
        JSON.stringify({ runId: draft.runId, entries: [] }, null, 2),
      );
    importBrowserResearch();
    prepareResearchPlan();
    context.researchProgress = researchProgress(draft, readCheckpoint(context.checkpointPath, draft.runId));
    writeFileSync(contextPath, JSON.stringify(context, null, 2));
    await status("research");
    console.log(
      JSON.stringify(
        {
          contextPath,
          draftPath: context.draftPath,
          checkpointPath: context.checkpointPath,
          mode: context.mode,
          sourceCount: context.sourceCount,
          researchProgress: context.researchProgress,
          planPath: context.planPath,
        },
        null,
        2,
      ),
    );
  }
  if (args.has("finish")) {
    const draft = JSON.parse(readFileSync(context.draftPath, "utf8"));
    if (draft.runId !== context.runId || draft.phase !== "scan") throw new Error("Workflow context does not identify this unpublished scan draft.");
    importBrowserResearch();
    const checkpointPath = args.has("research") ? argumentPath("research") : context.checkpointPath;
    const checkpoint = checkpointPath && existsSync(checkpointPath) ? readCheckpoint(checkpointPath, draft.runId) : { runId: draft.runId, entries: [] };
    const research = checkpointPath && existsSync(checkpointPath) ? checkpointPath : "--pending";
    context.checkpointPath = checkpointPath;
    context.researchProgress = researchProgress(draft, checkpoint);
    if (research !== "--pending") prepareResearchPlan();
    await status("research");
    const result = run(
      ["scripts/curateRetailArbitrageRun.mjs", context.draftPath, research],
      true,
    );
    const curated = JSON.parse(result.stdout);
    const final = JSON.parse(readFileSync(curated.finalPath, "utf8"));
    if (final.runId !== draft.runId)
      throw new Error("Curation returned the wrong run.");
    const partial =
      context.mode === "refresh" || !final.runQuality?.publishable;
    final.publicationMode = partial ? "source_updates" : "full";
    if (partial) final.sourceUpdateVersion = 1;
    final.researchProgress = context.researchProgress;
    writeFileSync(curated.finalPath, JSON.stringify(final, null, 2));
    run([
      "scripts/uploadLatestArbitrageFinds.mjs",
      "--file=" + curated.finalPath,
      "--dryRun",
    ]);
    run([
      "scripts/uploadLatestArbitrageFinds.mjs",
      "--file=" + curated.finalPath,
    ]);
    context.updatedSourceIds = admittedSourceIds(final);
    context.updatedSourceCount = context.updatedSourceIds.length;
    context.finalPath = curated.finalPath;
    context.publicationMode = final.publicationMode;
    context.publishedAt = new Date().toISOString();
    await status(partial ? "partial" : "published", final.funnel);
    console.log(
      JSON.stringify(
        {
          runId: final.runId,
          finalPath: curated.finalPath,
          publicationMode: final.publicationMode,
          funnel: final.funnel,
          updatedSourceCount: context.updatedSourceCount,
          researchProgress: context.researchProgress,
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  if (context) await status("failed").catch(() => {});
  throw error;
}
function argumentPath(name) {
  const value = args.get(name);
  if (typeof value !== "string") throw new Error(`--${name} requires a file path.`);
  const path = resolve(value);
  if (!existsSync(path)) throw new Error(`--${name} file not found: ${path}`);
  return path;
}
function readCheckpoint(path, runId) {
  const checkpoint = JSON.parse(readFileSync(path, "utf8"));
  if (checkpoint.runId !== runId || !Array.isArray(checkpoint.entries)) throw new Error("Research checkpoint must belong to the exact scan draft.");
  return checkpoint;
}
function importBrowserResearch() {
  if (!args.has("browserResearch")) return;
  const standardCheckpoint = join(dirname(context.draftPath), `research-checkpoint-${context.runId}.json`);
  if (args.has("research") && argumentPath("research") !== standardCheckpoint) throw new Error("Browser research imports into the draft's own checkpoint; omit --research or supply that same checkpoint path.");
  const capturePath = argumentPath("browserResearch");
  const result = run(["scripts/importBrowserSoldResearch.mjs", context.draftPath, capturePath], true);
  const imported = JSON.parse(result.stdout);
  context.checkpointPath = imported.checkpointPath;
  context.browserResearchPath = capturePath;
  context.browserResearchImport = { accepted: imported.accepted?.length ?? 0, rejected: imported.rejected?.length ?? 0 };
}
function prepareResearchPlan() {
  const result = run(["scripts/prepareArbitrageResearchPlan.mjs", context.draftPath, "--max=" + WORKFLOW_RESEARCH_LIMIT, "--checkpoint=" + context.checkpointPath], true);
  context.planPath = JSON.parse(result.stdout).outputPath;
}
function run(command, capture = false) {
  const result = spawnSync(process.execPath, command, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `Workflow step ${command[0]} failed: ${result.stderr ?? result.error ?? result.status}`,
    );
  return result;
}
function latestArtifact(draftOnly = false, after = 0) {
  return readdirSync(dir)
    .filter((name) => /^retail-arbitrage-.*\.json$/.test(name))
    .flatMap((name) => {
      try {
        const payload = JSON.parse(readFileSync(join(dir, name), "utf8"));
        return (!draftOnly || payload.phase === "scan") &&
          Date.parse(payload.createdAt) >= after
          ? [{ ...payload, path: join(dir, name) }]
          : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}
async function status(state, funnel) {
  context.status = state;
  context.updatedAt = new Date().toISOString();
  writeFileSync(context.contextPath, JSON.stringify(context, null, 2));
  if (!process.env.ARBITRAGE_UPLOAD_URL || !process.env.ARBITRAGE_UPLOAD_TOKEN)
    return;
  const body = { ...context, status: state, funnel };
  try {
    const response = await fetch(
      new URL("/api/arbitrage/operations", process.env.ARBITRAGE_UPLOAD_URL),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.ARBITRAGE_UPLOAD_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
  } catch (error) {
    console.error("Scan status update unavailable: " + error.message);
  }
}
