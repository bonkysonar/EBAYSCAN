import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

function csvCell(value) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf("="); return i < 0 ? [arg.replace(/^--/, ""), true] : [arg.slice(2, i), arg.slice(i + 1)]; }));
const outputDir = path.resolve(String(args.output ?? path.join(process.env.LOCALAPPDATA ?? "exports", "RecordScanner", "seller-pricing")));
fs.mkdirSync(outputDir, { recursive: true });
const lockPath = path.join(outputDir, "run.lock");
let lock;
try { lock = fs.openSync(lockPath, "wx"); } catch { throw new Error(`Another pricing run may be active. Inspect ${lockPath} before resuming.`); }
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
let server;
try {
  server = await createServer({ configFile: false, server: { middlewareMode: true } });
  const { readLocalEnv, searchMarketplace } = await server.ssrLoadModule("/src/server/marketplaceApi.ts");
  const { fetchSellerActiveListings } = await server.ssrLoadModule("/src/server/sellerListingsApi.ts");
  const { runSellerAnalysis, mergeSellerListings, restoreRows, draftSellerPrice } = await server.ssrLoadModule("/src/lib/seller/queue.ts");
  const env = { ...process.env, ...readLocalEnv(path.resolve(String(args["env-dir"] ?? "."))) };
  const checkpoint = path.join(outputDir, "checkpoint.json");
  const journal = path.join(outputDir, "progress.jsonl");
  let rows = [];
  if (args.resume && fs.existsSync(checkpoint)) {
    rows = JSON.parse(fs.readFileSync(checkpoint, "utf8")).rows;
    const byId = new Map(rows.map(row => [row.listing.id, row]));
    if (fs.existsSync(journal)) {
      const lines = fs.readFileSync(journal, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        let row;
        try { row = JSON.parse(lines[i]); }
        catch (error) { if (i === lines.length - 1) break; throw error; }
        if (byId.has(row.listing.id)) byId.set(row.listing.id, row);
      }
    }
    rows = restoreRows([...byId.values()]);
  } else {
    if (fs.existsSync(checkpoint)) throw new Error("An existing checkpoint is present. Use --resume or a new --output directory.");
    let inventory;
    if (args.inventory) {
      inventory = JSON.parse(fs.readFileSync(String(args.inventory), "utf8"));
      const inventoryAge = Date.now() - Date.parse(inventory.timestamp);
      if (!Number.isFinite(inventoryAge) || inventoryAge < -60_000 || inventoryAge > 6 * 60 * 60 * 1000) throw new Error("Inventory snapshot is expired or invalid.");
    } else {
      const listings = []; let pageNumber = 1;
      do {
        inventory = await fetchSellerActiveListings(env, { maxPages: 5, pageNumber });
        listings.push(...inventory.listings); pageNumber = inventory.nextPageNumber;
        console.log(JSON.stringify({ phase: "inventory", loaded: listings.length, reportedTotal: inventory.reportedTotal }));
      } while (inventory.hasMore);
      inventory.listings = listings;
    }
    const unique = [...new Map(inventory.listings.map(row => [row.id, row])).values()];
    if (!inventory.complete || (inventory.reportedTotal !== undefined && inventory.reportedTotal !== unique.length)) throw new Error(`Inventory is incomplete: ${unique.length} unique / ${inventory.reportedTotal ?? "unknown"} reported. Refresh before claiming full-store coverage.`);
    rows = mergeSellerListings(unique, []);
  }
  const index = new Map(rows.map((row, i) => [row.listing.id, i]));
  const save = (status) => {
    const data = { version: 2, updatedAt: new Date().toISOString(), status, rows };
    fs.writeFileSync(`${checkpoint}.tmp`, JSON.stringify(data)); fs.renameSync(`${checkpoint}.tmp`, checkpoint);
  };
  if (!args["report-only"]) {
    save("running");
    // The atomic snapshot now includes every replayed row. Start a fresh journal,
    // including after a process interruption left an incomplete trailing record.
    fs.writeFileSync(journal, "");
  }
  let pause = false, count = 0;
  process.on("SIGINT", () => { pause = true; });
  const started = Date.now();
  const outcome = args["report-only"] ? {} : await runSellerAnalysis({ rows, search: input => searchMarketplace(input, env), shouldPause: () => pause,
    onRow: row => {
      rows[index.get(row.listing.id)] = row;
      if (row.state !== "analyzing") {
        fs.appendFileSync(journal, `${JSON.stringify(row)}\n`);
        count++;
        if (count % 50 === 0) { save("running"); console.log(JSON.stringify({ phase: "analysis", finished: rows.filter(r => r.state === "done").length, total: rows.length, seconds: Math.round((Date.now() - started) / 1000) })); }
      }
    }
  });
  const status = outcome.stopReason ? "blocked" : pause ? "paused" : rows.every(row => row.state === "done") ? "complete" : "partial";
  save(status);
  const counts = {}; for (const row of rows) { const key = row.analysis?.status ?? row.state; counts[key] = (counts[key] ?? 0) + 1; }
  const csv = [['item_id','sku','title','currency','current_item_price','benchmark_item_price','matched_count','status','confidence','maximum_reduction_percent','draft_item_price','reason'],
    ...rows.map(row => [row.listing.id,row.listing.sku ?? row.listing.customLabel,row.listing.title,row.listing.currency,row.listing.currentPrice,row.analysis?.benchmarkPrice,row.analysis?.matchedCount,row.analysis?.status ?? row.state,row.analysis?.confidence,row.analysis?.maximumDraftReductionPercent,draftSellerPrice(row),row.error ?? row.analysis?.reasons.join(' | ')])]
    .map(cells => cells.map(csvCell).join(',')).join('\n');
  fs.writeFileSync(path.join(outputDir, "review.csv"), csv);
  const drafts = rows.map(row => ({ row, price: draftSellerPrice(row) })).filter(item => item.price !== null);
  const draftCsv = [['item_id','sku','title','currency','current_item_price','draft_item_price','reduction_percent','matched_count','confidence','maximum_reduction_percent','review_required'],
    ...drafts.map(({row,price}) => [row.listing.id,row.listing.sku ?? row.listing.customLabel,row.listing.title,row.listing.currency,row.listing.currentPrice,price,Math.round((1-price/row.listing.currentPrice)*10000)/100,row.analysis?.matchedCount,row.analysis?.confidence,row.analysis?.maximumDraftReductionPercent,'Confirm pressing, sleeve grade, shipping, promotions and margin. Not an eBay upload file.'])]
    .map(cells => cells.map(csvCell).join(',')).join('\n');
  fs.writeFileSync(path.join(outputDir, "price-change-drafts.csv"), draftCsv);
  const summary = { status, total: rows.length, counts, draftCount: drafts.length, draftPolicy: "faster-sales; reductions only; maximum 20%; review required", stopReason: outcome.stopReason, updatedAt: new Date().toISOString(), checkpoint, report: path.join(outputDir, "review.csv"), drafts: path.join(outputDir, "price-change-drafts.csv") };
  fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  if (status !== "complete") process.exitCode = 2;
} finally {
  await server?.close(); fs.closeSync(lock); fs.unlinkSync(lockPath);
}
