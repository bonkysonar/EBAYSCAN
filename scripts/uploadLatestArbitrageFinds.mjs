import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const WORKSPACE = process.cwd();
const FINDS_DIR = join(WORKSPACE, "exports", "arbitrage-finds");
const LOCAL_ENV_PATH = join(WORKSPACE, ".env.local");
const SCHEMA_VERSION = 2;

loadLocalEnv(LOCAL_ENV_PATH);

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...valueParts] = argument.replace(/^--/, "").split("=");
    return [key, valueParts.length ? valueParts.join("=") : "true"];
  }),
);
const uploadUrl = process.env.ARBITRAGE_UPLOAD_URL;
const uploadToken = process.env.ARBITRAGE_UPLOAD_TOKEN;
if (!args.has("dryRun") && (!uploadUrl || !uploadToken)) {
  throw new Error("ARBITRAGE_UPLOAD_URL and ARBITRAGE_UPLOAD_TOKEN are required.");
}

const selected = args.get("file")
  ? readExplicitFinalPayload(args.get("file"))
  : await findLatestFinalArbitragePayload(FINDS_DIR);
const publishablePayload = prepareFinalPayload(selected.payload, selected.path, args.get("runId"));
if (args.has("dryRun")) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        selectedPath: selected.path,
        selectedSource: selected.payload.source,
        uploadedPhase: publishablePayload.phase,
        uploadedRunId: publishablePayload.runId,
      },
      null,
      2,
    ),
  );
} else {
  const response = await fetch(uploadUrl, {
    body: JSON.stringify(publishablePayload),
    headers: {
      Authorization: `Bearer ${uploadToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Arbitrage upload failed: HTTP ${response.status} ${responseBody}`);
  }

  console.log(
    JSON.stringify(
      {
        selectedPath: selected.path,
        selectedSource: selected.payload.source,
        upload: parseJsonOrText(responseBody),
        uploadedPhase: publishablePayload.phase,
        uploadedRunId: publishablePayload.runId,
      },
      null,
      2,
    ),
  );
}

async function findLatestFinalArbitragePayload(directory) {
  const files = await readdir(directory, { withFileTypes: true });
  const candidates = [];

  for (const entry of files) {
    if (!entry.isFile() || !/^retail-arbitrage-.*\.json$/i.test(entry.name)) continue;
    const path = join(directory, entry.name);
    try {
      const payload = JSON.parse(readFileSync(path, "utf8"));
      if (!isFinalLocalArtifact(payload, entry.name)) continue;
      candidates.push({ createdAtMs: Date.parse(payload.createdAt), path, payload });
    } catch {
      // Ignore malformed and partially written exports.
    }
  }

  candidates.sort((left, right) => right.createdAtMs - left.createdAtMs);
  const latest = candidates[0];
  if (!latest) {
    throw new Error(
      `No final Retail Arbitrage JSON found in ${directory}. Raw scan/enrichment artifacts are intentionally not publishable.`,
    );
  }
  return latest;
}

function readExplicitFinalPayload(value) {
  const requestedPath = isAbsolute(value) ? resolve(value) : resolve(WORKSPACE, value);
  assertPathWithinWorkspace(requestedPath);
  const payload = JSON.parse(readFileSync(requestedPath, "utf8"));
  if (!isFinalLocalArtifact(payload, basename(requestedPath))) {
    throw new Error(`${requestedPath} is a raw/draft artifact. Only a curated final Retail Arbitrage payload can be published.`);
  }
  return { path: requestedPath, payload };
}

function isFinalLocalArtifact(payload, fileName) {
  if (!payload || typeof payload !== "object" || !validIsoTimestamp(payload.createdAt) || !Array.isArray(payload.finds)) return false;
  if (payload.phase === "final" && payload.publicationStatus === "final" && payload.schemaVersion === SCHEMA_VERSION) return true;
  const hasExplicitPublicationMarkers =
    Object.prototype.hasOwnProperty.call(payload, "phase") ||
    Object.prototype.hasOwnProperty.call(payload, "publicationStatus");
  if (hasExplicitPublicationMarkers) return false;
  const curatedLegacyArtifact =
    payload.source === "daily-vinyl-retail-arbitrage-scan" &&
    /^retail-arbitrage-\d{4}-\d{2}-\d{2}\.json$/i.test(fileName);
  return curatedLegacyArtifact;
}

function prepareFinalPayload(payload, path, requestedRunId) {
  const runId = requestedRunId || payload.runId || deriveRunId(payload, path);
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(runId)) {
    throw new Error("runId must use only letters, numbers, dots, underscores, and hyphens.");
  }
  return {
    ...payload,
    phase: "final",
    publicationStatus: "final",
    runId,
    saleObservations: Array.isArray(payload.saleObservations) ? payload.saleObservations : payload.saleEvents ?? [],
    schemaVersion: SCHEMA_VERSION,
  };
}

function deriveRunId(payload, path) {
  const date = String(payload.createdAt).slice(0, 10);
  const contentHash = createHash("sha256")
    .update(stableJson({ createdAt: payload.createdAt, fileName: basename(path), finds: payload.finds, source: payload.source }))
    .digest("hex")
    .slice(0, 16);
  return `daily-${date}-${contentHash}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertPathWithinWorkspace(path) {
  const workspace = resolve(WORKSPACE);
  const relativePath = relative(workspace, path);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Upload file must stay within the workspace: ${path}`);
  }
}

function parseJsonOrText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function validIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function loadLocalEnv(path) {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
