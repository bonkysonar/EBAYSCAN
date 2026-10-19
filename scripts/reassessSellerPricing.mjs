import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf("="); return i < 0 ? [arg.slice(2), true] : [arg.slice(2, i), arg.slice(i + 1)]; }));
if (!args.source || !args.output) throw new Error("Provide --source=<checkpoint.json> and a fresh --output=<private-directory>.");
const output = path.resolve(String(args.output));
if (fs.existsSync(path.join(output, "checkpoint.json"))) throw new Error("Use a fresh output directory; prior evidence is preserved.");
fs.mkdirSync(output, { recursive: true });
const lockPath = path.join(output, "run.lock");
const lock = fs.openSync(lockPath, "wx"); fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
const server = await createServer({ configFile: false, server: { middlewareMode: true } });
try {
  const { readLocalEnv, searchMarketplace, fetchBrowseQuota } = await server.ssrLoadModule("/src/server/marketplaceApi.ts");
  const { sellerSearchInput, mediaGradeFromListing, mediaGradeFromDescription } = await server.ssrLoadModule("/src/lib/seller/search.ts");
  const { sellerListingBlocker } = await server.ssrLoadModule("/src/lib/seller/matching.ts");
  const { analyzeSellerPrice, SELLER_EVIDENCE_TTL_MS } = await server.ssrLoadModule("/src/lib/seller/analyzeSellerPrice.ts");
  const { draftSellerPrice } = await server.ssrLoadModule("/src/lib/seller/queue.ts");
  const env = { ...process.env, ...readLocalEnv(path.resolve(String(args["env-dir"] ?? "."))) };
  const source = JSON.parse(fs.readFileSync(String(args.source), "utf8"));
  const ownIds = source.rows.map(row => row.listing.id);
  const groups = new Map();
  const keyFor = listing => JSON.stringify(sellerSearchInput(listing));
  for (const row of source.rows) {
    const key = keyFor(row.listing);
    if (!groups.has(key)) groups.set(key, { key, input: sellerSearchInput(row.listing), rows: [], observations: new Map(), timestamp: null });
    const group = groups.get(key); group.rows.push(row);
  }
  function observe(group, result) {
    const age = Date.now() - Date.parse(result.timestamp);
    if (!Number.isFinite(age) || age < -60_000 || age > SELLER_EVIDENCE_TTL_MS) return;
    // Oldest contributing timestamp wins. Pooling never refreshes old evidence.
    group.timestamp = group.timestamp && group.timestamp < result.timestamp ? group.timestamp : result.timestamp;
    group.marketSnapshot = result.marketSnapshot;
    for (const original of result.listings) {
      const { recordGrade: _oldGrade, recordGradeSource: _oldSource, ...comp } = original;
      const titleGrade = mediaGradeFromListing(comp);
      const descriptionGrade = titleGrade === "Unknown" ? mediaGradeFromDescription(comp.raw?.shortDescription ?? "") ?? (original.recordGradeSource === "description" ? original.recordGrade : undefined) : undefined;
      group.observations.set(comp.id, { ...comp, recordGrade: titleGrade === "Unknown" ? descriptionGrade : titleGrade,
        recordGradeSource: titleGrade !== "Unknown" ? "title" : descriptionGrade ? "description" : undefined,
        sellerId: comp.sellerId ?? comp.raw?.seller?.username, buyingOptions: comp.buyingOptions ?? comp.raw?.buyingOptions });
    }
  }
  for (const row of source.rows) if (row.searchResult) observe(groups.get(keyFor(row.listing)), row.searchResult);
  if (args.audit) {
    for (const row of JSON.parse(fs.readFileSync(String(args.audit), "utf8")).rows) {
      const group = groups.get(keyFor(row.listing)); if (group) observe(group, row.result);
    }
  }
  let reusedResearchQueries = 0, reusedResearchRows = 0;
  if (args.research) {
    for (const line of fs.readFileSync(String(args.research), "utf8").split("\n").filter(Boolean)) {
      const record = JSON.parse(line); const group = groups.get(record.key);
      if (!group) continue;
      const age = Date.now() - Date.parse(record.result.timestamp);
      if (!Number.isFinite(age) || age < -60_000 || age > SELLER_EVIDENCE_TTL_MS) continue;
      group.observations.clear(); group.timestamp = null; observe(group, record.result);
      reusedResearchQueries++; reusedResearchRows += group.rows.length;
    }
  }
  const outputRows = new Map();
  function evaluate(group) {
    const result = { input: group.input, listings: [...group.observations.values()], source: "ebay", timestamp: group.timestamp ?? "", marketSnapshot: group.marketSnapshot, warnings: [] };
    for (const row of group.rows) {
      if (!group.timestamp) { outputRows.set(row.listing.id, { ...row, state: "pending", analysis: undefined, searchResult: undefined }); continue; }
      const analysis = analyzeSellerPrice(row.listing, result, {}, ownIds);
      const ids = new Set(analysis.comparableIds);
      const searchResult = { ...result, listings: result.listings.filter(comp => ids.has(comp.id)).map(({ raw: _raw, ...comp }) => comp) };
      outputRows.set(row.listing.id, { ...row, analysis, searchResult, state: "done", error: undefined });
    }
  }
  for (const group of groups.values()) evaluate(group);
  function save(status) {
    const file = path.join(output, "checkpoint.json");
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 2, status, updatedAt: new Date().toISOString(), rows: [...outputRows.values()] }));
    fs.renameSync(`${file}.tmp`, file);
  }
  save("running");
  const requested = Number(args["refresh-queries"] ?? 0);
  if (!Number.isSafeInteger(requested) || requested < 0) throw new Error("Invalid refresh query count.");
  const quota = requested ? await fetchBrowseQuota(env) : undefined;
  const maximum = Math.min(requested, Math.max(0, (quota?.remaining ?? 0) - 60));
  console.log(JSON.stringify({ phase: "preflight", quota, maximumFreshQueries: maximum, sourceRows: source.rows.length }));
  const eligible = [...groups.values()].filter(group => !group.rows.every(row => sellerListingBlocker(row.listing)));
  const score = group => group.rows.length * 10 + Math.min(10, Math.max(...group.rows.map(row => row.analysis?.matchedCount ?? 0)));
  eligible.sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key));
  const buckets = [eligible.filter(group => group.input.conditionFilter === "new"),
    eligible.filter(group => group.input.conditionFilter !== "new" && group.rows.every(row => !row.analysis?.matchedCount)),
    eligible.filter(group => group.input.conditionFilter !== "new" && group.rows.some(row => row.analysis?.matchedCount > 0))];
  const selected = new Map();
  for (let i = 0; selected.size < maximum; i++) {
    let added = false;
    for (const bucket of buckets) if (bucket[i] && selected.size < maximum) { selected.set(bucket[i].key, bucket[i]); added = true; }
    if (!added) break;
  }
  const pending = [...selected.values()]; let cursor = 0, completed = 0, refreshedRows = 0, stopReason;
  async function worker() {
    while (cursor < pending.length && !stopReason) {
      const group = pending[cursor++];
      try {
        const result = await searchMarketplace(group.input, env);
        // A fresh result replaces this query's old sample, rather than mixing ages.
        group.observations.clear(); group.timestamp = null; observe(group, result); evaluate(group);
        fs.appendFileSync(path.join(output, "research.jsonl"), JSON.stringify({ key: group.key, result: { ...result, listings: result.listings.map(({ raw: _raw, ...comp }) => comp) } }) + "\n");
        completed++; refreshedRows += group.rows.length;
        if (completed % 10 === 0) { save("running"); console.log(JSON.stringify({ phase: "refresh", completed, total: pending.length, refreshedRows })); }
      } catch (error) { stopReason = error.message; }
      if (!stopReason) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  await Promise.all([worker(), worker()]);
  const rows = [...outputRows.values()];
  const status = stopReason ? "partial" : rows.every(row => row.state === "done") ? "complete" : "partial";
  save(status);
  const counts = {}, confidence = {};
  for (const row of rows) { const state = row.analysis?.status ?? row.state; counts[state] = (counts[state] ?? 0) + 1; const label = row.analysis?.confidence ?? "pending"; confidence[label] = (confidence[label] ?? 0) + 1; }
  const summary = { status, total: rows.length, counts, confidence, draftCount: rows.filter(row => draftSellerPrice(row) !== null).length, freshQueries: completed, freshRows: refreshedRows, reusedResearchQueries, reusedResearchRows, reusedRows: rows.length - refreshedRows, stopReason, quotaBefore: quota };
  fs.writeFileSync(path.join(output, "coverage.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  if (status !== "complete") process.exitCode = 2;
} finally { await server.close(); fs.closeSync(lock); fs.unlinkSync(lockPath); }
