import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { publicationPreflight, publicationRequest } from "./lib/retailPublicationClient.mjs";
import { createRetailAttempt, retailAttemptStatus } from "./lib/retailAttemptStatus.mjs";
import { beginResearchWrite, readResearchSession, updateResearchSession } from "./lib/retailResearchSession.mjs";
import { resumableResearchWorkflow, carryUnfinishedResearch, carryResearchCheckpoint } from "./lib/retailResearchBacklog.mjs";
import { admittedSourceIds, assertResearchReady, assertWorkflowDraftFresh, browserRecoveryScan, freshWorkflowDraftSummary, researchProgress, scannerOutputPath, workflowFailure, WORKFLOW_RESEARCH_LIMIT } from "./lib/retailWorkflowState.mjs";
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
if (args.has("preflight")) {
  if (args.has("localOnly")) throw new Error("--localOnly does not contact the publication service; omit --preflight.");
  try {
    console.log(JSON.stringify(await publicationPreflight(), null, 2));
    process.exit(0);
  } catch (error) {
    console.error(`Retail publication preflight failed: ${error.message}. Check runner network access and automatic credentials before scanning.`);
    process.exit(1);
  }
}
beginResearchWrite();
mkdirSync(dir, { recursive: true });
const cadencePath = join(dir, "workflow-cadence.json");
const cadence = existsSync(cadencePath)
  ? JSON.parse(readFileSync(cadencePath, "utf8"))
  : {};
if (args.has("finish") && ["full", "browserOnly", "browserObservations", "previousScan", "sources", "webDiscovery", "reviewedOffers"].some((name) => args.has(name)))
  throw new Error("Browser retailer recovery must start a new workflow; these scan options cannot change an existing draft.");
if (args.has("previousScan") && !args.has("browserOnly")) throw new Error("--previousScan requires a new --browserOnly recovery workflow.");
if (args.has("sources") && (args.has("full") || args.has("browserOnly"))) throw new Error("Explicit sources require a separate bounded refresh.");
if (args.has("finish") && args.has("resume")) throw new Error("Choose either --resume or --finish.");
if (args.has("resume") && ["full", "browserOnly", "browserObservations", "previousScan", "sources", "webDiscovery", "reviewedOffers"].some(name => args.has(name)))
  throw new Error("Resume cannot start a replacement scan; use --full without --resume.");
const contextArgument = args.get("finish") ?? args.get("resume");
let context = contextArgument
  ? JSON.parse(readFileSync(resolve(String(contextArgument)), "utf8"))
  : null;
if (context) {
  context.contextPath = resolve(String(contextArgument));
  if (context.publishedAt || context.supersededByRunId) throw new Error("This workflow is already published or superseded.");
  const savedDraft = JSON.parse(readFileSync(context.draftPath, "utf8"));
  if (savedDraft.runId !== context.runId || savedDraft.phase !== "scan") throw new Error("Workflow context does not identify its unpublished scan draft.");
  assertWorkflowDraftFresh(savedDraft);
}
const standaloneRefresh = ["browserOnly", "sources", "previousScan"].some(name => args.has(name));
let priorWorkflows = [];
const session = readResearchSession(cwd);
const attempt = session ? { id: session.ownerAttemptId, startedAt: session.attemptStartedAt } : createRetailAttempt();
try {
priorWorkflows = !context ? readUnfinishedWorkflows() : [];
if (!args.has("finish") && !args.has("full") && !standaloneRefresh) {
  const pending = context ? { context } : resumableResearchWorkflow(priorWorkflows);
  if (pending) {
    context = pending.context;
    const savedDraft = JSON.parse(readFileSync(context.draftPath, "utf8"));
    if (savedDraft.runId !== context.runId || savedDraft.phase !== "scan") throw new Error("Resume context does not identify its unpublished scan draft.");
    readCheckpoint(context.checkpointPath, context.runId);
    if (session) updateResearchSession(cwd, process.env.RETAIL_RESEARCH_OWNER, "bind", { contextPath: context.contextPath });
    context.resumedAt = new Date().toISOString();
    importBrowserResearch();
    prepareResearchPlan();
    context.researchProgress = researchProgress(JSON.parse(readFileSync(context.draftPath, "utf8")), readCheckpoint(context.checkpointPath, context.runId));
    await status("research");
    console.log(JSON.stringify({ resumed: true, contextPath: context.contextPath,
      draftPath: context.draftPath, checkpointPath: context.checkpointPath,
      planPath: context.planPath, researchProgress: context.researchProgress,
      researchQueue: context.researchQueue }, null, 2));
  }
}
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
    const explicitSources = args.has("sources") ? String(args.get("sources")).split(",").map(id => id.trim()).filter(Boolean) : null;
    if (explicitSources && !explicitSources.length) throw new Error("--sources requires at least one source id");
    const selected = explicitSources ?? [
      ...new Set([
        ...pinned,
        ...activeSources.slice(offset),
        ...activeSources.slice(0, offset),
        ...priority,
      ]),
    ].slice(0, 12);
    context = {
      version: 1,
      mode: recovery || explicitSources ? "refresh" : full || !selected.length ? "full" : "refresh",
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
    const scanArgs = recovery?.scanArgs ?? ["scripts/runRetailArbitrageScan.mjs", "--skipUpload", "--skipActiveEnrichment"];
    if (args.has("reviewedOffers")) scanArgs.push("--reviewedOffers=" + argumentPath("reviewedOffers"));
    if (args.has("webDiscovery")) scanArgs.push("--webDiscovery=" + argumentPath("webDiscovery"));
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
    const draft = carryUnfinishedResearch(JSON.parse(readFileSync(draftPath, "utf8")), priorWorkflows);
    writeFileSync(draftPath, JSON.stringify(draft, null, 2));
    Object.assign(context, freshWorkflowDraftSummary(draft, context));
    context.draftPath = draftPath;
    context.checkpointPath = join(
      dir,
      `research-checkpoint-${draft.runId}.json`,
    );
    if (!existsSync(context.checkpointPath))
      writeFileSync(
        context.checkpointPath,
        JSON.stringify(carryResearchCheckpoint(draft, priorWorkflows), null, 2),
      );
    importBrowserResearch();
    prepareResearchPlan();
    context.researchProgress = researchProgress(JSON.parse(readFileSync(context.draftPath, "utf8")), readCheckpoint(context.checkpointPath, draft.runId));
    writeFileSync(contextPath, JSON.stringify(context, null, 2));
    // Retire prior contexts only after the fresh cohort and reusable checkpoint
    // are durable. Historical drafts/checkpoints remain intact for audit; their
    // unrediscovered offers are explicitly deferred, never counted as completed.
    const superseded = new Set(draft.researchBacklog.supersededRunIds);
    for (const prior of priorWorkflows.filter(prior => superseded.has(prior.draft.runId))) {
      const path = prior.context.contextPath;
      writeFileSync(`${path}.tmp`, JSON.stringify({ ...prior.context, supersededByRunId: context.runId, supersededAt: new Date().toISOString() }, null, 2));
      renameSync(`${path}.tmp`, path);
    }
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
    assertWorkflowDraftFresh(draft);
    if (session) updateResearchSession(cwd, process.env.RETAIL_RESEARCH_OWNER, "bind", { contextPath: context.contextPath });
    importBrowserResearch();
    const checkpointPath = args.has("research") ? argumentPath("research") : context.checkpointPath;
    const research = checkpointPath && existsSync(checkpointPath) ? checkpointPath : "--pending";
    context.checkpointPath = checkpointPath;
    if (research !== "--pending") prepareResearchPlan();
    const checkpoint = checkpointPath && existsSync(checkpointPath) ? readCheckpoint(checkpointPath, draft.runId) : { runId: draft.runId, entries: [] };
    context.researchProgress = researchProgress(JSON.parse(readFileSync(context.draftPath, "utf8")), checkpoint);
    await status("research");
    assertResearchReady(context.researchProgress, context.researchQueue);
    if (context.researchProgress.planned > 0) {
      // Refresh the selected current cohort. The enrichment command reuses
      // only current complete checks.
      const active = run(["scripts/enrichArbitrageActiveEbay.mjs",
        "--file=" + relative(cwd, context.draftPath), "--pages=100"], true);
      process.stdout.write(active.stdout);
    }
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
    final.researchQueue = context.researchQueue;
    writeFileSync(curated.finalPath, JSON.stringify(final, null, 2));
    run([
      "scripts/uploadLatestArbitrageFinds.mjs",
      "--file=" + curated.finalPath,
      "--dryRun",
    ]);
    if (!args.has("localOnly")) run([
      "scripts/uploadLatestArbitrageFinds.mjs",
      "--file=" + curated.finalPath,
    ]);
    context.updatedSourceIds = admittedSourceIds(final);
    context.updatedSourceCount = context.updatedSourceIds.length;
    context.finalPath = curated.finalPath;
    context.publicationMode = final.publicationMode;
    if (args.has("localOnly")) context.validatedAt = new Date().toISOString();
    else context.publishedAt = new Date().toISOString();
    await status(args.has("localOnly") ? "validated" : partial ? "partial" : "published", final.funnel);
    console.log(
      JSON.stringify(
        {
          runId: final.runId,
          finalPath: curated.finalPath,
          publicationMode: final.publicationMode,
          funnel: final.funnel,
          updatedSourceCount: context.updatedSourceCount,
          researchProgress: context.researchProgress,
          localOnly: args.has("localOnly"),
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  if (context) {
    context.failure = { ...workflowFailure(error, context.status), failedAt: new Date().toISOString() };
    await status("failed").catch(() => {});
  }
  throw error;
}
function argumentPath(name) {
  const value = args.get(name);
  if (typeof value !== "string") throw new Error(`--${name} requires a file path.`);
  const path = resolve(value);
  if (!existsSync(path)) throw new Error(`--${name} file not found: ${path}`);
  return path;
}
function readUnfinishedWorkflows() {
  return readdirSync(dir).filter(name => /^workflow-\d+\.json$/.test(name)).flatMap(name => {
    try {
      const contextPath = join(dir, name);
      const saved = JSON.parse(readFileSync(contextPath, "utf8"));
      if (saved.publishedAt || saved.supersededByRunId || !saved.draftPath || !existsSync(saved.draftPath)) return [];
      const draft = JSON.parse(readFileSync(saved.draftPath, "utf8"));
      const checkpoint = saved.checkpointPath && existsSync(saved.checkpointPath)
        ? JSON.parse(readFileSync(saved.checkpointPath, "utf8")) : {};
      return [{ context: { ...saved, contextPath }, draft, checkpoint }];
    } catch (error) {
      throw new Error(`Cannot safely recover unfinished research from ${name}: ${error.message}`);
    }
  });
}
function readCheckpoint(path, runId) {
  const checkpoint = JSON.parse(readFileSync(path, "utf8"));
  if (checkpoint.runId !== runId || !Array.isArray(checkpoint.entries)) throw new Error("Research checkpoint must belong to the exact scan draft.");
  return checkpoint;
}
function importBrowserResearch() {
  const defaultCaptures = join(dir, "browser-product-research.json");
  if (!args.has("browserResearch") && (!existsSync(defaultCaptures) || args.has("research"))) return;
  const standardCheckpoint = join(dirname(context.draftPath), `research-checkpoint-${context.runId}.json`);
  if (args.has("research") && argumentPath("research") !== standardCheckpoint) throw new Error("Browser research imports into the draft's own checkpoint; omit --research or supply that same checkpoint path.");
  const capturePath = args.has("browserResearch") ? argumentPath("browserResearch") : defaultCaptures;
  run(["scripts/enrichRetailReleaseIdentity.mjs", context.draftPath]);
  const result = run(["scripts/importBrowserSoldResearch.mjs", context.draftPath, capturePath], true);
  const imported = JSON.parse(result.stdout);
  context.checkpointPath = imported.checkpointPath;
  context.browserResearchPath = capturePath;
  context.browserResearchImport = { accepted: imported.accepted?.length ?? 0, rejected: imported.rejected?.length ?? 0 };
}
function prepareResearchPlan() {
  run(["scripts/enrichRetailReleaseIdentity.mjs", context.draftPath]);
  const command = ["scripts/prepareArbitrageResearchPlan.mjs", context.draftPath, "--max=" + WORKFLOW_RESEARCH_LIMIT, "--checkpoint=" + context.checkpointPath];
  if (context.browserResearchPath) command.push("--captures=" + context.browserResearchPath);
  const result = JSON.parse(run(command, true).stdout);
  context.planPath = result.outputPath;
  context.researchQueue = result.queueSummary;
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
  if (result.status !== 0) {
    const error = new Error(
      `Workflow step ${command[0]} failed: ${result.stderr ?? result.error ?? result.status}`,
    );
    error.workflowStep = command[0];
    throw error;
  }
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
  if (state !== "failed") delete context.failure;
  context.status = state;
  context.updatedAt = new Date().toISOString();
  context.lastAttempt = attempt;
  writeFileSync(context.contextPath, JSON.stringify(context, null, 2));
  if (session && context.draftPath && context.checkpointPath && !context.publishedAt) {
    updateResearchSession(cwd, process.env.RETAIL_RESEARCH_OWNER, "bind", { contextPath: context.contextPath });
    context.browserRecovery = JSON.parse(readFileSync(context.contextPath, "utf8")).browserRecovery;
  }
  if (args.has("localOnly") || !process.env.ARBITRAGE_UPLOAD_TOKEN)
    return;
  const body = retailAttemptStatus(context, attempt, state, funnel);
  try {
    await publicationRequest(
      "/api/arbitrage/operations",
      {
        method: "POST",
        body,
      },
    );
  } catch (error) {
    console.error("Scan status update unavailable: " + error.message);
  }
}
