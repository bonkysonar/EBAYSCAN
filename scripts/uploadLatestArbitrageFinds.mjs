import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const WORKSPACE = process.cwd();
const FINDS_DIR = join(WORKSPACE, "exports", "arbitrage-finds");
const LOCAL_ENV_PATH = join(WORKSPACE, ".env.local");

loadLocalEnv(LOCAL_ENV_PATH);

const uploadUrl = process.env.ARBITRAGE_UPLOAD_URL;
const uploadToken = process.env.ARBITRAGE_UPLOAD_TOKEN;
if (!uploadUrl || !uploadToken) {
  throw new Error("ARBITRAGE_UPLOAD_URL and ARBITRAGE_UPLOAD_TOKEN are required.");
}

const latestPath = await findLatestArbitrageJson(FINDS_DIR);
const response = await fetch(uploadUrl, {
  body: readFileSync(latestPath, "utf8"),
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

console.log(JSON.stringify({ latestPath, upload: JSON.parse(responseBody) }, null, 2));

async function findLatestArbitrageJson(directory) {
  const files = await readdir(directory, { withFileTypes: true });
  const candidates = files
    .filter((entry) => entry.isFile() && /^retail-arbitrage-.*\.json$/i.test(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const latest = candidates[0];
  if (!latest) throw new Error(`No JSON files found in ${directory}.`);
  return latest.path;
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
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
