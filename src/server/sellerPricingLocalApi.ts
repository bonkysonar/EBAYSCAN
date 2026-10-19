import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Vite-only local reader. No caller-supplied filesystem paths and no hosted route.
export function readLocalSellerCheckpoint(env: NodeJS.ProcessEnv = process.env) {
  const root = env.SELLER_PRICING_OUTPUT_DIR ?? join(env.LOCALAPPDATA ?? "exports", "RecordScanner", "seller-pricing");
  if (!existsSync(root)) throw new Error("No local seller analysis found. Run npm run seller:analyze first.");
  const candidates = [join(root, "checkpoint.json"), ...readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}(?:[T_-].*)?$/.test(entry.name))
    .map(entry => join(root, entry.name, "checkpoint.json"))]
    .filter(file => existsSync(file)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!candidates.length) throw new Error("No saved checkpoint is available yet.");
  const file = candidates[0];
  if (statSync(file).size > 40_000_000) throw new Error("Checkpoint exceeds the 40 MB import limit.");
  const checkpoint = JSON.parse(readFileSync(file, "utf8"));
  if (checkpoint.version !== 2 || !Array.isArray(checkpoint.rows)) throw new Error("Invalid seller checkpoint.");
  return checkpoint;
}
