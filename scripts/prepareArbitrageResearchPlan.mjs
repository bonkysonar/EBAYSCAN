import { deferredResearch } from "./lib/researchMemory.mjs";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  buildProductResearchPlan,
  researchCheckpointComplete,
} from "./lib/productResearchCuration.mjs";

const WORKSPACE = process.cwd();
const FINDS_DIR = join(WORKSPACE, "exports", "arbitrage-finds");
const requestedPath = process.argv[2];
const maxEntriesArgument = process.argv.find((argument) =>
  argument.startsWith("--max="),
);
const maxEntries = maxEntriesArgument
  ? Number(maxEntriesArgument.split("=")[1])
  : undefined;
const sourcePath =
  requestedPath && !requestedPath.startsWith("--")
    ? resolve(WORKSPACE, requestedPath)
    : latestRawScanPath();

if (!existsSync(sourcePath))
  throw new Error(`Arbitrage source payload not found: ${sourcePath}`);

const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
const checkpointArgument = process.argv.find((argument) =>
  argument.startsWith("--checkpoint="),
);
const checkpoint = checkpointArgument
  ? JSON.parse(
      readFileSync(resolve(WORKSPACE, checkpointArgument.slice(13)), "utf8"),
    )
  : {};
if (checkpoint.runId && checkpoint.runId !== payload.runId)
  throw new Error("Checkpoint belongs to another scan");
const pool = payload.researchCandidates ?? payload.finds ?? [];
const allEntries = buildProductResearchPlan(pool, { maxEntries });
const completed = new Set(
  allEntries
    .filter((plan) =>
      researchCheckpointComplete(
        plan,
        (checkpoint.entries ?? []).find(
          (entry) => entry.findId === plan.findId,
        ),
      ),
    )
    .map((entry) => entry.findId),
);
const memoryPath = join(FINDS_DIR, "research-memory.json");
const memory = existsSync(memoryPath)
  ? JSON.parse(readFileSync(memoryPath, "utf8"))
  : {};
const deferred = pool.flatMap((find) => {
  const old = deferredResearch(find, memory);
  return old
    ? [
        {
          findId: find.id,
          reason: "unchanged_successful_empty_search",
          checkedAt: old.checkedAt,
        },
      ]
    : [];
});
const deferredIds = new Set(deferred.map((entry) => entry.findId));
const entries = buildProductResearchPlan(
  pool.filter((find) => !deferredIds.has(find.id)),
  { maxEntries },
).filter((entry) => !completed.has(entry.findId));
const runId = payload.runId ?? payload.createdAt ?? new Date().toISOString();
const plan = {
  createdAt: new Date().toISOString(),
  entries,
  deferred,
  runId,
  checkpointedCount: completed.size,
  sourcePayload: sourcePath.startsWith(WORKSPACE)
    ? sourcePath.slice(WORKSPACE.length + 1)
    : sourcePath,
  status: "ready",
};
const outputName = `product-research-plan-${safeFilePart(runId)}.json`;
const outputPath = join(FINDS_DIR, outputName);
writeFileSync(outputPath, JSON.stringify(plan, null, 2));

console.log(
  JSON.stringify({ entries: entries.length, outputPath, sourcePath }, null, 2),
);

function latestRawScanPath() {
  const candidates = readdirSync(FINDS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^retail-arbitrage-.*\.json$/i.test(entry.name),
    )
    .map((entry) => {
      const path = join(FINDS_DIR, entry.name);
      const payload = safeJson(path);
      return {
        path,
        phase: payload?.phase,
        runMode: payload?.runMode,
        mtimeMs: statSync(path).mtimeMs,
      };
    })
    .filter((entry) => entry.phase !== "final" || entry.runMode)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!candidates[0])
    throw new Error(`No retail-arbitrage scan JSON found in ${FINDS_DIR}.`);
  return candidates[0].path;
}

function safeJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function safeFilePart(value) {
  return basename(String(value))
    .replace(/[:.]/g, "-")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}
