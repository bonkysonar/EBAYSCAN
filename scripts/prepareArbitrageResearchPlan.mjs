import { buildPersistentResearchQueue } from "./lib/persistentResearchQueue.mjs";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

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
const checkpointPath = checkpointArgument ? resolve(WORKSPACE, checkpointArgument.slice(13)) : join(dirname(sourcePath), `research-checkpoint-${payload.runId}.json`);
const checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) : {};
if (checkpoint.runId && checkpoint.runId !== payload.runId)
  throw new Error("Checkpoint belongs to another scan");
const captureArgument = process.argv.find(argument => argument.startsWith("--captures="));
const capturePath = captureArgument ? resolve(captureArgument.slice(11)) : join(FINDS_DIR, "browser-product-research.json");
const captures = existsSync(capturePath) ? JSON.parse(readFileSync(capturePath, "utf8")) : {};
const statePath = join(FINDS_DIR, "research-queue-state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const queue = buildPersistentResearchQueue(payload, { captures, checkpoint, state, maxEntries });
const entries = queue.plan.entries;
const runId = payload.runId ?? payload.createdAt ?? new Date().toISOString();
const plan = {
  ...queue.plan,
  runId,
  checkpointedCount: new Set(queue.plan.completed.flatMap(task => task.findIds)).size,
  sourcePayload: sourcePath.startsWith(WORKSPACE)
    ? sourcePath.slice(WORKSPACE.length + 1)
    : sourcePath,
  status: "ready",
};
const outputName = `product-research-plan-${safeFilePart(runId)}.json`;
const outputPath = join(FINDS_DIR, outputName);
mkdirSync(FINDS_DIR, { recursive: true });
for (const [path, value] of [[checkpointPath,queue.checkpoint],[statePath,queue.state],[outputPath,plan]]) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}

console.log(
  JSON.stringify({ entries: entries.length, outputPath, sourcePath, checkpointPath, queueSummary: plan.summary }, null, 2),
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
