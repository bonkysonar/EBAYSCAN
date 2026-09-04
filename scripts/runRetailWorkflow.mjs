import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
let context = args.has("finish")
  ? JSON.parse(readFileSync(resolve(String(args.get("finish"))), "utf8"))
  : null;
try {
  if (!context) {
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
      mode: full || !selected.length ? "full" : "refresh",
      startedAt: new Date().toISOString(),
      runId: "workflow-" + Date.now(),
    };
    const contextPath = join(dir, `${context.runId}.json`);
    context.contextPath = contextPath;
    await status("running");
    if (context.mode === "full") cadence.lastBroadDate = today;
    cadence.rotation = offset + 4;
    writeFileSync(cadencePath, JSON.stringify(cadence, null, 2));
    const scanArgs = ["scripts/runRetailArbitrageScan.mjs", "--skipUpload"];
    if (context.mode === "refresh")
      scanArgs.push("--sources=" + selected.join(","), "--skipEbaySync");
    run(scanArgs);
    const draft = latestArtifact(true, Date.parse(context.startedAt));
    if (!draft) throw new Error("The scan produced no new draft.");
    context.runId = draft.runId;
    context.draftPath = draft.path;
    context.sourceCount = draft.sourceReports?.length ?? 0;
    run(["scripts/prepareArbitrageResearchPlan.mjs", draft.path]);
    context.checkpointPath = join(
      dir,
      `research-checkpoint-${draft.runId}.json`,
    );
    if (!existsSync(context.checkpointPath))
      writeFileSync(
        context.checkpointPath,
        JSON.stringify({ runId: draft.runId, entries: [] }, null, 2),
      );
    writeFileSync(contextPath, JSON.stringify(context, null, 2));
    await status("research");
    console.log(
      JSON.stringify(
        {
          contextPath,
          draftPath: context.draftPath,
          checkpointPath: context.checkpointPath,
          mode: context.mode,
        },
        null,
        2,
      ),
    );
  }
  if (args.has("finish")) {
    const draft = JSON.parse(readFileSync(context.draftPath, "utf8"));
    const research = args.get("research")
      ? resolve(String(args.get("research")))
      : "--pending";
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
    context.updatedSourceCount = (final.sourceReports ?? []).filter(
      (r) => r.catalogPageAvailableCount > 0 || r.salePageAvailableCount > 0,
    ).length;
    await status(partial ? "partial" : "published", final.funnel);
    console.log(
      JSON.stringify(
        {
          runId: final.runId,
          finalPath: curated.finalPath,
          publicationMode: final.publicationMode,
          funnel: final.funnel,
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
