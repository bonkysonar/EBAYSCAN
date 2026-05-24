import { useEffect, useMemo, useRef, useState } from "react";
import { EbayClient } from "../lib/ebay/client";
import type { CandidateListing, SearchResult } from "../lib/ebay/types";
import { analyzeSellerPrice } from "../lib/seller/analyzeSellerPrice";
import { SellerListingsClient } from "../lib/seller/client";
import type { SellerListing, SellerPricingAnalysis, SellerPricingStatus } from "../lib/seller/types";

type AnalyzerRow = {
  analysis?: SellerPricingAnalysis;
  changeNote?: string;
  error?: string;
  isTaggedForChange?: boolean;
  listing: SellerListing;
  proposedPrice?: number;
  searchResult?: SearchResult;
  state: "pending" | "analyzing" | "done" | "error";
};

type StatusFilter = "ALL" | SellerPricingStatus | "ERROR" | "PENDING" | "TAGGED";
type SortKey = "status" | "currentPrice" | "deltaPercent" | "activeComparableCount";
type SortDirection = "asc" | "desc";

const STORAGE_KEY = "record-scanner-seller-price-analyzer-v1";
const RATE_LIMIT_STORAGE_KEY = "record-scanner-seller-price-analyzer-rate-limit-until";
const ANALYSIS_BATCH_SIZE = 25;
const ANALYSIS_ROW_DELAY_MS = 2_500;
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

const statusLabels: Record<SellerPricingStatus, string> = {
  CROWDED_PRICE_HIGH: "Crowded + high",
  NEEDS_REVIEW: "Needs review",
  OK: "Looks okay",
  PRICE_HIGH: "Priced high",
  PRICE_LOW: "Possibly low",
  VERY_CROWDED_PRICE_HIGH: "Very crowded + high",
};

const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "Tagged for change", value: "TAGGED" },
  { label: "Very crowded + high", value: "VERY_CROWDED_PRICE_HIGH" },
  { label: "Crowded + high", value: "CROWDED_PRICE_HIGH" },
  { label: "Priced high", value: "PRICE_HIGH" },
  { label: "Possibly low", value: "PRICE_LOW" },
  { label: "Needs review", value: "NEEDS_REVIEW" },
  { label: "Looks okay", value: "OK" },
  { label: "Errors", value: "ERROR" },
  { label: "Pending", value: "PENDING" },
];

export function SellerPriceAnalyzer() {
  const sellerClient = useMemo(() => new SellerListingsClient(), []);
  const ebayClient = useMemo(() => new EbayClient(), []);
  const [rows, setRows] = useState<AnalyzerRow[]>(() => loadCachedRows());
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [isLoadingListings, setIsLoadingListings] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isPauseRequested, setIsPauseRequested] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [rateLimitUntil, setRateLimitUntil] = useState(() => loadRateLimitUntil());
  const pauseRequestedRef = useRef(false);

  useEffect(() => {
    saveCachedRows(rows);
  }, [rows]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function loadListings() {
    setIsLoadingListings(true);
    setError(null);
    setWarnings([]);

    try {
      const result = await sellerClient.listActive();
      setRows((current) => mergeLoadedListings(result.listings, current));
      setWarnings(result.warnings);
      pauseRequestedRef.current = false;
      setIsPauseRequested(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Seller listing pull failed.");
      if (rows.length === 0) setRows([]);
    } finally {
      setIsLoadingListings(false);
    }
  }

  async function analyzeListings() {
    if (rows.length === 0 || isAnalyzing) return;
    if (rateLimitUntil > Date.now()) {
      setError(`eBay Browse rate limit cooldown is active. Try again in ${formatCooldown(rateLimitUntil - Date.now())}.`);
      return;
    }
    const rowsToAnalyze = rows.filter(isAnalyzableRow).slice(0, ANALYSIS_BATCH_SIZE);
    if (rowsToAnalyze.length === 0) return;

    pauseRequestedRef.current = false;
    setIsPauseRequested(false);
    setIsAnalyzing(true);
    setError(null);

    try {
      for (const row of rowsToAnalyze) {
        if (pauseRequestedRef.current) break;

        updateRow(row.listing.id, { state: "analyzing" });

        try {
          const result = await ebayClient.search({
            conditionFilter: "used",
            query: row.listing.title,
            searchProfile: "seller-pricing",
            type: "manual",
          });
          const analysis = analyzeSellerPrice(row.listing, result);
          updateRow(row.listing.id, { analysis, error: undefined, searchResult: result, state: "done" });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Analysis failed.";
          if (message.includes("429") || /too many requests/i.test(message)) {
            const cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            setRateLimitUntil(cooldownUntil);
            saveRateLimitUntil(cooldownUntil);
            updateRow(row.listing.id, { error: undefined, state: "pending" });
            setError(`eBay rate limit hit. Analysis paused automatically; try again in ${formatCooldown(RATE_LIMIT_COOLDOWN_MS)}.`);
            pauseRequestedRef.current = true;
            setIsPauseRequested(true);
            break;
          }

          updateRow(row.listing.id, {
            error: message,
            state: "error",
          });
        }

        if (pauseRequestedRef.current) break;
        await sleep(ANALYSIS_ROW_DELAY_MS);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateRow(listingId: string, patch: Partial<AnalyzerRow>) {
    setRows((current) => current.map((row) => (row.listing.id === listingId ? { ...row, ...patch } : row)));
  }

  function clearCachedAnalysis() {
    if (isAnalyzing) return;
    setRows([]);
    setSelectedListingId(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function importSnapshotCsv(file: File | undefined) {
    if (!file || isAnalyzing) return;

    try {
      const importedRows = rowsFromSnapshotCsv(await file.text(), rows);
      setRows(importedRows);
      setSelectedListingId(null);
      setError(null);
      setWarnings([`Imported ${importedRows.length} rows from ${file.name}. SKU/custom label is preserved where active listings were already loaded.`]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Snapshot CSV import failed.");
    }
  }

  const analyzedCount = rows.filter((row) => row.state === "done" || row.state === "error").length;
  const remainingCount = rows.filter((row) => isAnalyzableRow(row) || row.state === "analyzing").length;
  const taggedCount = rows.filter((row) => row.isTaggedForChange).length;
  const isRateLimited = rateLimitUntil > now;
  const visibleRows = useMemo(
    () => filterAndSortRows(rows, statusFilter, sortKey, sortDirection),
    [rows, sortDirection, sortKey, statusFilter],
  );
  const selectedRow = rows.find((row) => row.listing.id === selectedListingId) ?? null;

  return (
    <section className="seller-page compact-seller-page">
      <div className="seller-hero panel compact-seller-hero">
        <div>
          <p className="eyebrow">Separate page</p>
          <h2>Seller Price Analyzer</h2>
          <p>Compact work queue for active listings. Click a row for analytics and tag price changes for later export.</p>
        </div>
        <div className="seller-actions">
          <button type="button" onClick={loadListings} disabled={isLoadingListings || isAnalyzing}>
            {isLoadingListings ? "Loading..." : rows.length ? "Refresh Listings" : "Load Active Listings"}
          </button>
          <button type="button" onClick={analyzeListings} disabled={rows.length === 0 || isAnalyzing || isLoadingListings}>
            {isRateLimited
              ? `Rate limited ${formatCooldown(rateLimitUntil - now)}`
              : isAnalyzing
              ? `Analyzing ${analyzedCount}/${rows.length}`
              : analyzedCount > 0 && remainingCount > 0
                ? `Analyze Next ${Math.min(ANALYSIS_BATCH_SIZE, remainingCount)}`
                : `Analyze Next ${Math.min(ANALYSIS_BATCH_SIZE, remainingCount || ANALYSIS_BATCH_SIZE)}`}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              pauseRequestedRef.current = true;
              setIsPauseRequested(true);
            }}
            disabled={!isAnalyzing || isPauseRequested}
          >
            {isPauseRequested ? "Pausing..." : "Pause"}
          </button>
          <button type="button" onClick={() => downloadRowsCsv(visibleRows)} disabled={visibleRows.length === 0}>
            Download CSV
          </button>
          <label className="import-csv-button">
            Import Snapshot CSV
            <input type="file" accept=".csv,text/csv" onChange={(event) => importSnapshotCsv(event.target.files?.[0])} />
          </label>
          <button type="button" className="secondary-button" onClick={clearCachedAnalysis} disabled={isAnalyzing || rows.length === 0}>
            Clear Cache
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setRateLimitUntil(0);
              saveRateLimitUntil(0);
              setError(null);
            }}
            disabled={!isRateLimited || isAnalyzing}
          >
            Clear Cooldown
          </button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {warnings.map((warning) => (
        <div className="warning-box" key={warning}>{warning}</div>
      ))}

      <div className="seller-stats compact-seller-stats">
        <Stat label="Active" value={rows.length} />
        <Stat label="Analyzed" value={analyzedCount} />
        <Stat label="Remaining" value={remainingCount} />
        <Stat label="Tagged" value={taggedCount} />
        <Stat label="Visible" value={visibleRows.length} />
        <Stat label="Alerts" value={rows.filter((row) => row.analysis && highStatus(row.analysis.status)).length} />
      </div>

      <section className="panel seller-table-panel compact-table-panel">
        <div className="section-heading seller-table-heading">
          <div>
            <h2>Store Pricing Queue</h2>
            <span>Saved in this browser. No eBay listings are changed.</span>
          </div>
          <div className="seller-controls">
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Sort by
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                <option value="status">Status</option>
                <option value="currentPrice">Price</option>
                <option value="deltaPercent">Delta</option>
                <option value="activeComparableCount">Active comps</option>
              </select>
            </label>
            <label>
              Direction
              <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as SortDirection)}>
                <option value="asc">Low / urgent first</option>
                <option value="desc">High first</option>
              </select>
            </label>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="muted">Load active listings to start the store pricing pass.</p>
        ) : (
          <div className="seller-spreadsheet">
            <div className="seller-sheet-header">
              <span>Status</span>
              <span>SKU</span>
              <span>Title</span>
              <span>Your $</span>
              <span>Avg 10</span>
              <span>Delta</span>
              <span>Comps</span>
              <span>Change</span>
            </div>
            {visibleRows.map((row) => (
              <SellerRow
                isSelected={row.listing.id === selectedListingId}
                onOpen={() => setSelectedListingId(row.listing.id)}
                row={row}
                key={row.listing.id}
              />
            ))}
          </div>
        )}
      </section>

      {selectedRow ? (
        <SellerAnalyticsPanel
          row={selectedRow}
          onClose={() => setSelectedListingId(null)}
          onUpdate={(patch) => updateRow(selectedRow.listing.id, patch)}
        />
      ) : null}
    </section>
  );
}

function SellerRow({ isSelected, onOpen, row }: { isSelected: boolean; onOpen: () => void; row: AnalyzerRow }) {
  const analysis = row.analysis;
  const status = rowStatus(row);
  const statusClass = status.toLowerCase().replace(/_/g, "-");

  return (
    <button className={`seller-sheet-row ${statusClass} ${isSelected ? "selected" : ""}`} type="button" onClick={onOpen}>
      <span className="seller-status-pill">{statusLabel(row)}</span>
      <span>{sellerSku(row.listing) || "-"}</span>
      <span className="seller-sheet-title">{row.listing.title}</span>
      <strong>{money(row.listing.currentPrice, row.listing.currency)}</strong>
      <span>{analysis?.benchmarkPrice === null || !analysis ? "n/a" : money(analysis.benchmarkPrice)}</span>
      <span>{analysis?.deltaPercent === null || !analysis ? "n/a" : `${analysis.deltaPercent > 0 ? "+" : ""}${analysis.deltaPercent}%`}</span>
      <span>{analysis?.activeComparableCount ?? "n/a"}</span>
      <span>{row.isTaggedForChange ? "Tagged" : "-"}</span>
    </button>
  );
}

function SellerAnalyticsPanel({
  onClose,
  onUpdate,
  row,
}: {
  onClose: () => void;
  onUpdate: (patch: Partial<AnalyzerRow>) => void;
  row: AnalyzerRow;
}) {
  const analysis = row.analysis;
  const topListings = cheapestListings(row.searchResult?.listings ?? [], 10);
  const activeSearchUrl = ebaySellerSearchUrl(row.listing, "active");
  const soldSearchUrl = ebaySellerSearchUrl(row.listing, "sold");

  return (
    <div className="seller-detail-backdrop" role="dialog" aria-modal="true" aria-label="Seller listing analytics">
      <section className="seller-detail panel">
        <div className="seller-detail-header">
          <div>
            <p className="eyebrow">Listing analytics</p>
            <h2>{row.listing.title}</h2>
            <p>{row.listing.id} | SKU {sellerSku(row.listing) || "n/a"}</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <div className="seller-detail-grid">
          <Metric label="Your price" value={money(row.listing.currentPrice, row.listing.currency)} />
          <Metric label="Cheapest 10 avg" value={analysis?.benchmarkPrice ? money(analysis.benchmarkPrice) : "n/a"} />
          <Metric label="Delta" value={analysis?.deltaPercent === null || !analysis ? "n/a" : `${analysis.deltaPercent > 0 ? "+" : ""}${analysis.deltaPercent}%`} />
          <Metric label="Active comps" value={analysis?.activeComparableCount ?? "n/a"} />
          <Metric label="Status" value={statusLabel(row)} />
        </div>

        <div className="seller-detail-actions">
          {row.listing.itemUrl ? <a href={row.listing.itemUrl} rel="noreferrer" target="_blank">Open eBay listing</a> : null}
          <a href={activeSearchUrl} rel="noreferrer" target="_blank">Open eBay active</a>
          <a href={soldSearchUrl} rel="noreferrer" target="_blank">Open eBay sold</a>
          {row.searchResult?.marketSnapshot?.ebayResearchUrl ? (
            <a href={row.searchResult.marketSnapshot.ebayResearchUrl} rel="noreferrer" target="_blank">Open sold research</a>
          ) : null}
        </div>

        <div className="seller-change-box">
          <label>
            <input
              type="checkbox"
              checked={Boolean(row.isTaggedForChange)}
              onChange={(event) => onUpdate({ isTaggedForChange: event.target.checked })}
            />
            Tag for price change
          </label>
          <label>
            Proposed price
            <input
              type="number"
              min="0"
              step="0.01"
              value={row.proposedPrice ?? ""}
              onChange={(event) => onUpdate({ proposedPrice: event.target.value ? Number(event.target.value) : undefined })}
            />
          </label>
          <label>
            Change note
            <textarea
              value={row.changeNote ?? ""}
              onChange={(event) => onUpdate({ changeNote: event.target.value })}
              placeholder="Example: lower to match cheapest comps, crowded title."
            />
          </label>
        </div>

        {row.error ? <div className="error-box">{row.error}</div> : null}
        {analysis?.reasons.length ? (
          <div className="seller-detail-reasons">
            <h3>Recommendation</h3>
            <ul>{analysis.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        ) : null}

        <div className="seller-comps-panel">
          <div className="section-heading">
            <h3>Cheapest 10 Active Comps</h3>
            {topListings[0] ? <span>Lowest: {money(topListings[0].totalPrice, topListings[0].currency)}</span> : null}
          </div>
          {topListings.length ? (
            <div className="listing-tile-grid seller-comp-tile-grid">
              {topListings.map((listing) => (
                <a className="listing-tile seller-comp-tile" href={listing.itemUrl} rel="noreferrer" target="_blank" key={listing.id}>
                  <div className="listing-tile-body">
                    <strong>{money(listing.totalPrice, listing.currency)}</strong>
                    <h3>{listing.title}</h3>
                    <p>Media: {mediaGradeFromListing(listing)} - {listing.condition}</p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="muted">No comparable listing details saved for this row yet. Imported CSV snapshots only include aggregate pricing.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="seller-stat panel">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="seller-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function filterAndSortRows(rows: AnalyzerRow[], statusFilter: StatusFilter, sortKey: SortKey, sortDirection: SortDirection): AnalyzerRow[] {
  const filtered = rows.filter((row) => statusFilter === "ALL" || rowStatus(row) === statusFilter);
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...filtered].sort((a, b) => {
    const left = sortValue(a, sortKey);
    const right = sortValue(b, sortKey);
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return rowPriority(a) - rowPriority(b) || a.listing.title.localeCompare(b.listing.title);
  });
}

function rowStatus(row: AnalyzerRow): StatusFilter {
  if (row.isTaggedForChange) return "TAGGED";
  if (row.analysis) return row.analysis.status;
  if (row.state === "error" && !isRateLimitError(row.error)) return "ERROR";
  return "PENDING";
}

function statusLabel(row: AnalyzerRow): string {
  if (row.isTaggedForChange) return "Tagged";
  if (row.analysis) return statusLabels[row.analysis.status];
  if (row.state === "error") return "Error";
  return row.state;
}

function sortValue(row: AnalyzerRow, sortKey: SortKey): number {
  if (sortKey === "status") return rowPriority(row);
  if (sortKey === "currentPrice") return row.listing.currentPrice;
  if (sortKey === "deltaPercent") return row.analysis?.deltaPercent ?? Number.POSITIVE_INFINITY;
  return row.analysis?.activeComparableCount ?? Number.POSITIVE_INFINITY;
}

function rowPriority(row: AnalyzerRow): number {
  if (row.isTaggedForChange) return -1;
  const status = row.analysis?.status;
  if (status === "VERY_CROWDED_PRICE_HIGH") return 0;
  if (status === "CROWDED_PRICE_HIGH") return 1;
  if (status === "PRICE_HIGH") return 2;
  if (status === "PRICE_LOW") return 3;
  if (status === "NEEDS_REVIEW" || row.state === "error") return 4;
  if (status === "OK") return 5;
  if (row.state === "analyzing") return 6;
  return 7;
}

function isAnalyzableRow(row: AnalyzerRow): boolean {
  return row.state === "pending" || (row.state === "error" && isRateLimitError(row.error));
}

function isRateLimitError(message: string | undefined): boolean {
  return Boolean(message && (message.includes("429") || /too many requests/i.test(message)));
}

function downloadRowsCsv(rows: AnalyzerRow[]) {
  const headers = [
    "sku",
    "custom_label",
    "item_id",
    "title",
    "current_price",
    "proposed_price",
    "currency",
    "tagged_for_change",
    "change_note",
    "status",
    "cheapest_10_average",
    "delta_value",
    "delta_percent",
    "active_comparable_count",
    "condition",
    "available_quantity",
    "quantity_sold",
    "item_url",
    "reason",
  ];
  const csvRows = rows.map((row) => {
    const analysis = row.analysis;
    return {
      active_comparable_count: analysis?.activeComparableCount ?? "",
      available_quantity: row.listing.availableQuantity ?? "",
      change_note: row.changeNote ?? "",
      cheapest_10_average: analysis?.benchmarkPrice ?? "",
      condition: row.listing.condition ?? "",
      currency: row.listing.currency,
      current_price: row.listing.currentPrice,
      custom_label: row.listing.customLabel ?? "",
      delta_percent: analysis?.deltaPercent ?? "",
      delta_value: analysis?.deltaValue ?? "",
      item_id: row.listing.id,
      item_url: row.listing.itemUrl ?? "",
      proposed_price: row.proposedPrice ?? "",
      quantity_sold: row.listing.quantitySold ?? "",
      reason: row.error ?? analysis?.reasons.join(" | ") ?? "",
      sku: row.listing.sku ?? row.listing.customLabel ?? "",
      status: rowStatus(row),
      tagged_for_change: row.isTaggedForChange ? "yes" : "no",
      title: row.listing.title,
    };
  });
  const csv = [headers.map(csvEscape).join(","), ...csvRows.map((row) => headers.map((header) => csvEscape(row[header as keyof typeof row])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `seller-price-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function mergeLoadedListings(listings: SellerListing[], current: AnalyzerRow[]): AnalyzerRow[] {
  const currentById = new Map(current.map((row) => [row.listing.id, row]));
  return listings.map((listing) => {
    const existing = currentById.get(listing.id);
    return existing ? { ...existing, listing: { ...existing.listing, ...listing } } : { listing, state: "pending" };
  });
}

export function rowsFromSnapshotCsv(csv: string, current: AnalyzerRow[]): AnalyzerRow[] {
  const records = parseCsv(csv);
  const currentById = new Map(current.map((row) => [row.listing.id, row]));
  const currentByTitle = new Map(current.map((row) => [normalizeKey(row.listing.title), row]));

  return records.map((record) => {
    const id = itemIdFromSnapshot(record);
    const title = record.title || "Untitled eBay listing";
    const existing = (id ? currentById.get(id) : undefined) ?? currentByTitle.get(normalizeKey(title));
    const listing: SellerListing = {
      availableQuantity: existing?.listing.availableQuantity,
      condition: conditionFromMeta(record.meta) ?? existing?.listing.condition,
      currency: existing?.listing.currency ?? "USD",
      currentPrice: parseMoney(record.your_price) ?? existing?.listing.currentPrice ?? 0,
      customLabel: existing?.listing.customLabel,
      id: id || existing?.listing.id || crypto.randomUUID(),
      imageUrl: existing?.listing.imageUrl,
      itemUrl: record.item_url || existing?.listing.itemUrl,
      quantitySold: existing?.listing.quantitySold,
      sku: existing?.listing.sku,
      title,
    };
    const status = statusFromRecommendation(record.recommendation);
    const benchmarkPrice = parseMoney(record.cheapest_10_average);
    const activeComparableCount = parseInteger(record.active_comps);
    const deltaPercent = parsePercent(record.delta);
    const deltaValue = benchmarkPrice !== null ? roundMoney(listing.currentPrice - benchmarkPrice) : null;
    const analysis: SellerPricingAnalysis = {
      activeComparableCount,
      benchmarkPrice,
      benchmarkSource: benchmarkPrice === null ? "insufficient-comps" : "ebay-cheapest-10",
      deltaPercent,
      deltaValue,
      listing,
      reasons: record.reason ? [record.reason] : ["Imported from browser snapshot CSV."],
      status,
    };

    return {
      ...existing,
      analysis,
      error: undefined,
      listing,
      searchResult: existing?.searchResult,
      state: "done" as const,
    };
  });
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.length > 0)) rows.push(row);

  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
  );
}

function itemIdFromSnapshot(record: Record<string, string>): string {
  const fromMeta = record.meta?.match(/(\d{9,})\s*$/)?.[1];
  const fromUrl = record.item_url?.match(/\/(\d{9,})(?:[/?#]|$)/)?.[1];
  return fromMeta ?? fromUrl ?? "";
}

function conditionFromMeta(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [condition] = value.split(/[|\u00b7\u2022]/);
  const normalized = condition.trim();
  return normalized || undefined;
}

function statusFromRecommendation(value: string | undefined): SellerPricingStatus {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("very crowded")) return "VERY_CROWDED_PRICE_HIGH";
  if (normalized.includes("crowded")) return "CROWDED_PRICE_HIGH";
  if (normalized.includes("priced high")) return "PRICE_HIGH";
  if (normalized.includes("low")) return "PRICE_LOW";
  if (normalized.includes("okay")) return "OK";
  return "NEEDS_REVIEW";
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function parsePercent(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function loadCachedRows(): AnalyzerRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AnalyzerRow[]) : [];
  } catch {
    return [];
  }
}

function saveCachedRows(rows: AnalyzerRow[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // If localStorage is full, keep the in-memory queue rather than breaking the page.
  }
}

function loadRateLimitUntil(): number {
  const value = Number(localStorage.getItem(RATE_LIMIT_STORAGE_KEY) ?? "0");
  return Number.isFinite(value) ? value : 0;
}

function saveRateLimitUntil(value: number) {
  if (value > 0) {
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(value));
    return;
  }

  localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
}

function formatCooldown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function cheapestListings(listings: CandidateListing[], count = 20): CandidateListing[] {
  return [...listings]
    .filter((listing) => Number.isFinite(listing.totalPrice))
    .sort((a, b) => a.totalPrice - b.totalPrice)
    .slice(0, count);
}

export function ebaySellerSearchUrl(listing: Pick<SellerListing, "condition" | "title">, mode: "active" | "sold"): string {
  const url = new URL("https://www.ebay.com/sch/i.html");
  const mediaGrade = mediaGradeFromListing({ condition: listing.condition ?? "", title: listing.title });
  const gradeKeyword = ebayGradeKeyword(mediaGrade);
  const keywords = `${cleanTitleForEbaySearch(listing.title)} ${gradeKeyword} vinyl`.replace(/\s+/g, " ").trim();
  const ebayGrade = ebayRecordGradeFilter(mediaGrade);

  url.searchParams.set("_nkw", keywords);
  url.searchParams.set("_sacat", "0");
  url.searchParams.set("_from", "R40");
  url.searchParams.set("_sop", "15");
  if (mode === "sold") url.searchParams.set("LH_Sold", "1");
  if (ebayGrade) {
    url.searchParams.set("_dcat", "176985");
    url.searchParams.set("Record%20Grading", ebayGrade);
  }

  return url.toString();
}

export function mediaGradeFromListing(listing: Pick<CandidateListing, "condition" | "title">): string {
  const explicitMedia = listing.title.match(/\b(?:media|vinyl|record|lp)\s*(?:grade|condition)?\s*[:=-]?\s*(near mint|mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor|sealed)(?=\s|[),/;-]|$)/i);
  if (explicitMedia) return normalizeMediaGrade(explicitMedia[1]);

  const pairedGrade = listing.title.match(/\b(mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)\s*\/\s*(mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)(?=\s|[),/;-]|$)/i);
  if (pairedGrade) return normalizeMediaGrade(pairedGrade[1]);

  const titleGrade = listing.title.match(/\b(sealed|mint|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)(?=\s|[),/;-]|$)/i);
  if (titleGrade) return normalizeMediaGrade(titleGrade[1]);

  if (/new|sealed/i.test(listing.condition)) return "Sealed";
  return "Unknown";
}

function cleanTitleForEbaySearch(title: string): string {
  const titleBeforeGrade = title.split(mediaGradeBoundaryPattern())[0] || title;
  return titleBeforeGrade
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+\+\s+/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaGradeBoundaryPattern(): RegExp {
  return /\b(?:media|vinyl|record|lp)?\s*(?:grade|condition)?\s*[:=-]?\s*(?:sealed|mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)(?:\s*\/\s*(?:mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor))?(?=\s|[),/;-]|$)/i;
}

function ebayGradeKeyword(grade: string): string {
  const normalized = normalizeMediaGrade(grade);
  const keywordMap: Record<string, string> = {
    EX: "EX",
    "EX+": "EX plus",
    Fair: "fair",
    G: "good",
    "G+": "good plus",
    "G-": "good",
    M: "mint",
    NM: "near mint",
    "NM+": "near mint",
    "NM-": "near mint",
    Poor: "poor",
    Sealed: "sealed",
    VG: "VG",
    "VG+": "VG plus",
    "VG++": "VG plus",
    "VG-": "VG",
  };

  return keywordMap[normalized] ?? "";
}

function ebayRecordGradeFilter(grade: string): string | null {
  const normalized = normalizeMediaGrade(grade);
  const gradeMap: Record<string, string> = {
    EX: "Excellent (EX)",
    "EX+": "Excellent (EX)",
    Fair: "Fair (F)",
    G: "Good (G)",
    "G+": "Good Plus (G+)",
    "G-": "Good (G)",
    M: "Mint (M)",
    NM: "Near Mint (NM or M-)",
    "NM+": "Near Mint (NM or M-)",
    "NM-": "Near Mint (NM or M-)",
    Poor: "Poor (P)",
    VG: "Very Good (VG)",
    "VG+": "Very Good Plus (VG+)",
    "VG++": "Very Good Plus (VG+)",
    "VG-": "Very Good (VG)",
  };

  return gradeMap[normalized] ?? null;
}

function normalizeMediaGrade(value: string): string {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  const gradeMap: Record<string, string> = {
    ex: "EX",
    "ex+": "EX+",
    fair: "Fair",
    g: "G",
    "g+": "G+",
    "g-": "G-",
    m: "M",
    mint: "M",
    near: "NM",
    "near mint": "NM",
    nm: "NM",
    "nm+": "NM+",
    "nm-": "NM-",
    poor: "Poor",
    sealed: "Sealed",
    vg: "VG",
    "vg+": "VG+",
    "vg++": "VG++",
    "vg-": "VG-",
  };

  return gradeMap[normalized] ?? value.toUpperCase();
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function sellerSku(listing: SellerListing): string {
  return listing.sku ?? listing.customLabel ?? "";
}

function highStatus(status: SellerPricingStatus): boolean {
  return status === "PRICE_HIGH" || status === "CROWDED_PRICE_HIGH" || status === "VERY_CROWDED_PRICE_HIGH";
}

function money(value: number, currency = "USD"): string {
  return `${currency === "USD" ? "$" : `${currency} `}${value.toFixed(2)}`;
}


