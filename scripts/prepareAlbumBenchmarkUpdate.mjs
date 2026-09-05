import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAlbumPriceBenchmarkIndex, normalizeAlbumPriceBenchmark } from "./lib/albumPriceBenchmark.mjs";

const [baselineArgument, captureArgument] = process.argv.slice(2);
if (!baselineArgument) throw new Error("Usage: node scripts/prepareAlbumBenchmarkUpdate.mjs <exact-published-payload-or-API-response.json> [browser-product-research.json]");
const raw = JSON.parse(readFileSync(resolve(baselineArgument), "utf8"));
const previous = raw.payload ?? raw;
if (!previous.runId || previous.phase !== "final" || !Array.isArray(previous.finds))
  throw new Error("An exact published final payload is required.");
const captures = JSON.parse(readFileSync(resolve(captureArgument || "exports/arbitrage-finds/browser-product-research.json"), "utf8"));
const createdAt = new Date().toISOString();
const index = createAlbumPriceBenchmarkIndex(captures, createdAt);
const products = previous.finds.filter((find) => find.opportunityType !== "sitewide_sale");
const finds = products.flatMap((find) => {
  const benchmark = index.match(find);
  if (!benchmark || JSON.stringify(benchmark) === JSON.stringify(normalizeAlbumPriceBenchmark(find.albumPriceBenchmark, createdAt))) return [];
  return [{ ...find, albumPriceBenchmark: benchmark }];
});
if (!finds.length) throw new Error("No new usable album benchmark values match this publication.");
const runId = "evidence-" + createdAt.replace(/[:.]/g, "-");
const outputPath = resolve("exports/arbitrage-finds", `retail-arbitrage-final-${runId}.json`);
if (existsSync(outputPath)) throw new Error("Evidence artifact already exists; never overwrite an existing run.");
const payload = {
  schemaVersion: 2, phase: "final", publicationStatus: "final", runId, createdAt,
  source: "album-price-benchmark-update", publicationMode: "evidence_updates", evidenceUpdateVersion: 1,
  evidenceUpdates: { scope: "album_price_benchmarks", baseRunId: previous.runId },
  finds, saleEvents: [], saleObservations: [],
};
writeFileSync(outputPath, JSON.stringify(payload, null, 2));
const exactPrice = (find) => find.ebayResearchStatus === "validated" && Number(find.averageSoldPrice) > 0;
const updatedIds = new Set(finds.map((find) => find.id));
console.log(JSON.stringify({
  outputPath, runId, baseRunId: previous.runId, publicationMode: "evidence_updates",
  publishedProductCount: products.length, benchmarkUpdateCount: finds.length,
  volumeSupportedCount: finds.filter((find) => find.albumPriceBenchmark.volumeSupported).length,
  partialSampleCount: finds.filter((find) => find.albumPriceBenchmark.sampleComplete === false).length,
  priceBlanksBefore: products.filter((find) => !exactPrice(find) && !normalizeAlbumPriceBenchmark(find.albumPriceBenchmark, createdAt)).length,
  projectedPriceBlanksAfter: products.filter((find) => !exactPrice(find) && !updatedIds.has(find.id) && !normalizeAlbumPriceBenchmark(find.albumPriceBenchmark, createdAt)).length,
  retailerObservationsRefreshed: 0,
}, null, 2));
