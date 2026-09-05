import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { importBrowserSoldResearch } from "./lib/browserSoldResearch.mjs";

const [draftArgument, captureArgument] = process.argv.slice(2);
if (!draftArgument) throw new Error("Usage: node scripts/importBrowserSoldResearch.mjs <scan-json> [browser-product-research.json]");
const draftPath=resolve(draftArgument);
const payload=JSON.parse(readFileSync(draftPath,"utf8"));
if (!/^scan-[a-z0-9T_:.\-]+$/i.test(payload.runId)) throw new Error("Invalid scan run ID");
const captures=JSON.parse(readFileSync(resolve(captureArgument || "exports/arbitrage-finds/browser-product-research.json"),"utf8"));
const checkpointPath=join(dirname(draftPath),`research-checkpoint-${payload.runId}.json`);
const previous=existsSync(checkpointPath)?JSON.parse(readFileSync(checkpointPath,"utf8")):{};
const checkpoint=importBrowserSoldResearch(payload,captures,previous);
writeFileSync(`${checkpointPath}.tmp`,JSON.stringify(checkpoint,null,2));
renameSync(`${checkpointPath}.tmp`,checkpointPath);
console.log(JSON.stringify({checkpointPath,...checkpoint.importSummary},null,2));
