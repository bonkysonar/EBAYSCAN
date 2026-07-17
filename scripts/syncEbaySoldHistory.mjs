import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyFinancialTransactions,
  assertSanitizedSoldHistoryOutput,
  buildApiSoldHistoryIndex,
  buildEbayEconomicsSummary,
  finalizeSyncState,
  hasFinancialEventCorrections,
  mergeApiSoldRecords,
  mergeSoldHistoryBaseline,
  normalizeSyncState,
  ordersToSoldRecords,
  resolveEbaySyncRange,
  soldHistoryRecordsDigest,
} from "./lib/ebaySoldHistorySync.mjs";

export async function syncEbaySoldHistory(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const outputDir = resolve(cwd, options.outputDir ?? "exports/sold-history");
  const paths = {
    economics: join(outputDir, "ebay-economics-summary.json"),
    index: join(outputDir, "sold-comps-index.json"),
    records: join(outputDir, "sold-records-ebay-api.json"),
    state: join(outputDir, "sync-state.json"),
  };
  const existingStateFile = readJsonIfPresent(paths.state, {});
  const existingState = normalizeSyncState(existingStateFile);
  const storedRecords = readJsonIfPresent(paths.records, []);
  const checkpointMatches =
    Array.isArray(storedRecords) &&
    Boolean(existingState.recordsDigest) &&
    existingState.recordsDigest === soldHistoryRecordsDigest(storedRecords);
  const shouldRebuild = Boolean(
    options.fullRebuild ||
      !existingState.lastSuccessfulTo ||
      !Array.isArray(storedRecords) ||
      !checkpointMatches,
  );
  const range = resolveEbaySyncRange({
    from: options.from,
    lastSuccessfulTo: shouldRebuild ? undefined : existingState.lastSuccessfulTo,
    lookbackDays: options.lookbackDays,
    now: options.now,
    refreshOverlapDays: options.refreshOverlapDays,
    to: options.to,
  });
  const priorRecords = shouldRebuild ? [] : storedRecords;
  const stateForRun = shouldRebuild || priorRecords.length === 0 ? normalizeSyncState({}) : existingState;
  const env = {
    ...process.env,
    ...readLocalEnv(cwd),
    ...(options.env ?? {}),
  };
  const api = options.api ?? (await import("../src/server/ebaySoldHistoryApi.ts"));
  const requestOptions = {
    fetchImpl: options.fetchImpl,
    from: range.from,
    lookbackDays: range.lookbackDays,
    maxPagesPerSlice: options.maxPagesPerSlice,
    maxRetries: options.maxRetries,
    pageSize: options.pageSize,
    requestTimeoutMs: options.requestTimeoutMs,
    retryBaseDelayMs: options.retryBaseDelayMs,
    sliceDays: options.sliceDays,
    to: range.to,
  };

  const [orders, transactions] = await Promise.all([
    api.fetchEbayOrders(env, requestOptions),
    api.fetchEbayFinancialTransactions(env, requestOptions),
  ]);
  if (!shouldRebuild && hasFinancialEventCorrections(transactions, stateForRun)) {
    return syncEbaySoldHistory({
      ...options,
      from: undefined,
      fullRebuild: true,
      to: undefined,
    });
  }
  const freshRecords = ordersToSoldRecords(orders);
  const mergedRecords = mergeApiSoldRecords(priorRecords, freshRecords, {
    replaceFrom: range.from,
    replaceTo: range.to,
  });
  const applied = applyFinancialTransactions(mergedRecords, transactions, stateForRun);
  const completedAt = options.now ? new Date(options.now) : new Date();
  const state = finalizeSyncState(applied.state, range, completedAt);
  state.recordsDigest = soldHistoryRecordsDigest(applied.records);
  const baselineRecords = readBaselineSoldRecords(outputDir);
  const indexRecords = mergeSoldHistoryBaseline(applied.records, baselineRecords);
  const sourceSheets = [
    "eBay Fulfillment API",
    "eBay Finances API",
    ...new Set(baselineRecords.map((record) => record.sourceSheet).filter(Boolean)),
  ];
  const economics = buildEbayEconomicsSummary(applied.records, state, {
    createdAt: completedAt,
    from: range.from,
    to: range.to,
  });
  const index = buildApiSoldHistoryIndex(indexRecords, {
    asOf: range.to,
    source: baselineRecords.length > 0 ? "ebay-sold-history-combined" : "ebay-sold-history-api",
    sourceSheets,
  });
  if (baselineRecords.length > 0 && Number(index.recordCount) < baselineRecords.length) {
    throw new Error(
      `Refusing to replace sold-comps-index.json: combined history has ${index.recordCount} rows, below the ${baselineRecords.length}-row sanitized baseline.`,
    );
  }

  for (const output of [applied.records, economics, index, state]) {
    assertSanitizedSoldHistoryOutput(output);
  }

  const result = {
    dryRun: Boolean(options.dryRun),
    economics,
    financialTransactionCount: transactions.length,
    index,
    orderCount: orders.length,
    outputDir,
    range,
    recordCount: applied.records.length,
    records: applied.records,
    state,
    stats: applied.stats,
  };

  if (!options.dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeJsonAtomic(paths.records, applied.records);
    writeJsonAtomic(paths.economics, economics);
    writeJsonAtomic(paths.index, index);
    writeJsonAtomic(paths.state, state);
  }

  return result;
}

export function parseSyncCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected positional argument: ${argument}`);
    const equalsIndex = argument.indexOf("=");
    const key = argument.slice(2, equalsIndex >= 0 ? equalsIndex : undefined);
    let value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : undefined;
    if (value === undefined && !["dry-run", "full-rebuild", "help"].includes(key)) {
      value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
      index += 1;
    }

    if (key === "dry-run") options.dryRun = true;
    else if (key === "full-rebuild") options.fullRebuild = true;
    else if (key === "from") options.from = value;
    else if (key === "to") options.to = value;
    else if (key === "lookback-days") options.lookbackDays = parsePositiveInteger(value, key);
    else if (key === "refresh-overlap-days") options.refreshOverlapDays = parsePositiveInteger(value, key);
    else if (key === "slice-days") options.sliceDays = parsePositiveInteger(value, key);
    else if (key === "max-pages-per-slice") options.maxPagesPerSlice = parsePositiveInteger(value, key);
    else if (key === "max-retries") options.maxRetries = parseNonNegativeInteger(value, key);
    else if (key === "request-timeout-ms") options.requestTimeoutMs = parsePositiveInteger(value, key);
    else if (key === "retry-base-delay-ms") options.retryBaseDelayMs = parsePositiveInteger(value, key);
    else if (key === "output-dir") options.outputDir = value;
    else if (key === "help") options.help = true;
    else throw new Error(`Unknown option: --${key}`);
  }
  return options;
}

function readLocalEnv(cwd) {
  const env = {};
  for (const fileName of [".env", ".env.local"]) {
    const path = join(cwd, fileName);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key) env[key] = value;
    }
  }
  return env;
}

function readJsonIfPresent(path, fallback) {
  if (!existsSync(path)) return fallback;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed ?? fallback;
}

function readBaselineSoldRecords(outputDir) {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir)
    .filter((fileName) => /^sold-records-.*\.json$/i.test(fileName) && fileName !== "sold-records-ebay-api.json")
    .flatMap((fileName) => {
      const value = readJsonIfPresent(join(outputDir, fileName), []);
      return Array.isArray(value) ? value : [];
    });
}

function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function parsePositiveInteger(value, key) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${key} must be a positive integer.`);
  return Math.floor(parsed);
}

function parseNonNegativeInteger(value, key) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${key} must be a non-negative integer.`);
  return Math.floor(parsed);
}

function printUsage() {
  console.log(`Usage: npm run sold-history:sync -- [options]

Options:
  --dry-run                     Fetch and validate without writing files
  --from=YYYY-MM-DD             Explicit inclusive start date
  --to=YYYY-MM-DD               Explicit inclusive end date
  --lookback-days=730           First-sync lookback, capped by the API client at 730 days
  --refresh-overlap-days=14     Re-fetch overlap for late fees, labels, and refunds
  --full-rebuild                Ignore prior API records and financial-event state
  --output-dir=PATH             Output directory (default: exports/sold-history)
  --slice-days=90               API date-slice size, capped at 90 days
  --max-pages-per-slice=500     Pagination safety limit
  --max-retries=3               Retries for rate limits, transient API errors, and network failures
  --request-timeout-ms=30000    Per-request timeout
  --retry-base-delay-ms=500     Base delay for capped exponential retry backoff
`);
}

async function main() {
  const options = parseSyncCli(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const result = await syncEbaySoldHistory(options);
  const action = result.dryRun ? "Validated" : "Wrote";
  console.log(
    `${action} ${result.recordCount} sanitized sold records from ${result.orderCount} orders; ` +
      `${result.financialTransactionCount} financial transactions fetched, ${result.stats.applied} newly applied, ` +
      `${result.stats.unattributed} retained only as account-level calibration.`,
  );
  console.log(`Range: ${result.range.from} through ${result.range.to}`);
  if (!result.dryRun) console.log(`Output: ${result.outputDir}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
