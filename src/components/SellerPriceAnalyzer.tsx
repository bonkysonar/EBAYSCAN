import { useEffect, useMemo, useRef, useState } from "react";
import { EbayClient } from "../lib/ebay/client";
import { ebaySellerSearchUrl, mediaGradeFromListing } from "../lib/seller/search";
import { rowsFromSnapshotCsv } from "../lib/seller/snapshot";
import { runSellerAnalysis, hasFreshAnalysis, mergeSellerListings, restoreRows, draftSellerPrice, type AnalyzerRow } from "../lib/seller/queue";
import { readSellerRows, writeSellerRows } from "../lib/seller/storage";
import { decodeSellerCheckpoint, encodeSellerCheckpoint, MAX_CHECKPOINT_BYTES } from "../lib/seller/checkpoint";
import { SellerListingsClient } from "../lib/seller/client";
import type { SellerListing, SellerPricingStatus } from "../lib/seller/types";

type StatusFilter = "ALL" | SellerPricingStatus | "ERROR" | "PENDING" | "TAGGED" | "SUPPORTED" | "TENTATIVE";
type SortKey = "status" | "currentPrice" | "deltaPercent" | "activeComparableCount";
type SortDirection = "asc" | "desc";

const RATE_LIMIT_STORAGE_KEY = "record-scanner-seller-price-analyzer-rate-limit-until";
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

const statusLabels: Record<SellerPricingStatus, string> = {
  CROWDED_PRICE_HIGH: "Crowded + high",
  NEEDS_REVIEW: "Needs review",
  OK: "Within range",
  PRICE_HIGH: "Priced high",
  PRICE_LOW: "Possibly low",
  VERY_CROWDED_PRICE_HIGH: "Very crowded + high",
};

const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "Tagged for change", value: "TAGGED" },
  { label: "Supported recommendations", value: "SUPPORTED" },
  { label: "Tentative recommendations", value: "TENTATIVE" },
  { label: "Priced high", value: "PRICE_HIGH" },
  { label: "Possibly low", value: "PRICE_LOW" },
  { label: "Needs review", value: "NEEDS_REVIEW" },
  { label: "Within range", value: "OK" },
  { label: "Errors", value: "ERROR" },
  { label: "Pending", value: "PENDING" },
];

export function SellerPriceAnalyzer() {
  const sellerClient = useMemo(() => new SellerListingsClient(), []);
  const ebayClient = useMemo(() => new EbayClient(), []);
  const [rows, setRows] = useState<AnalyzerRow[]>([]);
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [isLoadingListings, setIsLoadingListings] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showCheckpointPaste, setShowCheckpointPaste] = useState(false);
  const checkpointTextRef = useRef<HTMLTextAreaElement>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [tablePage, setTablePage] = useState(0);
  const [isPauseRequested, setIsPauseRequested] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [rateLimitUntil, setRateLimitUntil] = useState(() => loadRateLimitUntil());
  const expiryMinute = Math.floor(now / 60_000);
  const pauseRequestedRef = useRef(false);

  const [storageReady, setStorageReady] = useState(false);
  const savedRowsRef = useRef(new Map<string, AnalyzerRow>());
  const savingRef = useRef(Promise.resolve());
  const activeRunRef = useRef(false);
  useEffect(() => {
    let mounted = true;
    readSellerRows().then(cached => { if (mounted) setRows(cached); })
      .catch(() => { if (mounted) setError("Could not restore the saved queue. Import a checkpoint or refresh inventory."); })
      .finally(() => { if (mounted) setStorageReady(true); });
    return () => { mounted = false; pauseRequestedRef.current = true; };
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    const before = savedRowsRef.current;
    const next = new Map(rows.map(row => [row.listing.id, row]));
    const changed = rows.filter(row => before.get(row.listing.id) !== row);
    const removed = [...before.keys()].filter(id => !next.has(id));
    savedRowsRef.current = next;
    if (!changed.length && !removed.length) return;
    savingRef.current = savingRef.current.then(() => writeSellerRows(changed, removed)).catch(() => {
      savedRowsRef.current = new Map();
      setError("Queue could not be saved. Keep this page open and download a checkpoint before leaving.");
    });
  }, [rows, storageReady]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setRows(current => current.some(row => row.state === "done" && !hasFreshAnalysis(row))
      ? current.map(row => row.state === "done" && !hasFreshAnalysis(row) ? restoreRows([row])[0] : row) : current);
  }, [expiryMinute]);

  useEffect(() => { setTablePage(0); }, [statusFilter, sortKey, sortDirection]);

  async function loadListings() {
    setIsLoadingListings(true);
    setError(null);
    setWarnings([]);

    try {
      const result = await sellerClient.listActive();
      setRows((current) => mergeSellerListings(result.listings, current));
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
    if (!rows.length || activeRunRef.current || rateLimitUntil > Date.now()) return;
    activeRunRef.current = true;
    pauseRequestedRef.current = false;
    setIsPauseRequested(false);
    setIsAnalyzing(true);
    setError(null);
    try {
      const outcome = await runSellerAnalysis({ rows, search: input => ebayClient.search(input),
        shouldPause: () => pauseRequestedRef.current,
        onRow: row => updateRow(row.listing.id, { analysis: row.analysis, searchResult: row.searchResult, state: row.state, error: row.error }) });
      if (outcome.stopReason) {
        setError(`Analysis stopped; completed work is saved. ${outcome.stopReason}`);
        if (isRateLimitError(outcome.stopReason)) {
          const until = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          setRateLimitUntil(until); saveRateLimitUntil(until);
        }
      }
    } finally { activeRunRef.current = false; setIsAnalyzing(false); }
  }

  function prepareDrafts() {
    let count = 0;
    const next = rows.map(row => {
      const price = draftSellerPrice(row);
      if (price === null || row.proposedPrice !== undefined) return row;
      count++;
      return { ...row, proposedPrice: price, isTaggedForChange: true,
        changeNote: `Faster-sales ${row.analysis?.confidence === "supported" ? "supported" : "tentative"} review draft: reduction only, capped at ${row.analysis?.maximumDraftReductionPercent}% from current item price. Verify pressing, shipping, promotions and margin before applying.` };
    });
    setRows(next);
    setWarnings([`${count} review drafts prepared. Existing proposed prices were preserved. These are suggestions; no live revisions were sent.`]);
  }

  async function loadLocalRun() {
    setIsLoadingListings(true);
    setError(null);
    try {
      const response = await fetch("/api/ebay/seller-pricing-checkpoint");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Local checkpoint could not be loaded.");
      const next = restoreRows(data.rows);
      setRows(next); setSelectedListingId(null); setTablePage(0);
      setWarnings([`Loaded local run: ${data.status ?? "saved"}. ${next.filter(row => hasFreshAnalysis(row)).length} of ${next.length} rows have fresh analysis.`]);
    } catch (error) { setError(error instanceof Error ? error.message : "Local checkpoint could not be loaded."); }
    finally { setIsLoadingListings(false); }
  }

  function updateRow(listingId: string, patch: Partial<AnalyzerRow>) {
    setRows((current) => current.map((row) => (row.listing.id === listingId ? { ...row, ...patch } : row)));
  }

  function clearCachedAnalysis() {
    if (isAnalyzing) return;
    setRows([]);
    setSelectedListingId(null);
  }

  async function acceptImportedRows(importedRows: AnalyzerRow[], source: string) {
    await savingRef.current;
    const incomingIds = new Set(importedRows.map(row => row.listing.id));
    await writeSellerRows(importedRows, [...savedRowsRef.current.keys()].filter(id => !incomingIds.has(id)));
    savedRowsRef.current = new Map(importedRows.map(row => [row.listing.id, row]));
    setRows(importedRows);
    setSelectedListingId(null);
    setTablePage(0);
    setStatusFilter(importedRows.some(row => row.isTaggedForChange) ? "TAGGED" : "ALL");
    setError(null);
    setShowCheckpointPaste(false);
    setWarnings([`Imported and saved ${importedRows.length} rows from ${source}, including ${importedRows.filter(row => row.proposedPrice !== undefined).length} proposed prices. No live prices were changed.`]);
  }

  async function importPastedCheckpoint() {
    if (isAnalyzing || isLoadingListings || !storageReady) return;
    setIsLoadingListings(true);
    try { await acceptImportedRows(await decodeSellerCheckpoint(checkpointTextRef.current?.value ?? ""), "pasted checkpoint"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Checkpoint import failed."); }
    finally { setIsLoadingListings(false); }
  }

  async function copyCheckpoint() {
    try {
      await navigator.clipboard.writeText(await encodeSellerCheckpoint(rows));
      setWarnings(["Checkpoint copied. Open the other analyzer, choose Paste Checkpoint, and paste it there. Includes proposed prices; no live prices were changed."]);
    } catch { setError("Could not copy the checkpoint. Download Checkpoint is still available."); }
  }

  async function importSnapshotCsv(file: File | undefined) {
    if (!file || isAnalyzing || isLoadingListings || !storageReady) return;
    if (file.size > MAX_CHECKPOINT_BYTES) { setError("Import exceeds 40 MB."); return; }
    setIsLoadingListings(true);
    try {
      let text: string;
      try { text = await file.text(); }
      catch {
        setShowCheckpointPaste(true);
        throw new Error("The browser could not read this file. Select it again, or use Copy Checkpoint in the source analyzer and paste it below.");
      }
      const importedRows = file.name.toLowerCase().endsWith(".json") ? await decodeSellerCheckpoint(text) : rowsFromSnapshotCsv(text, rows);
      await acceptImportedRows(importedRows, file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Snapshot CSV import failed.");
    } finally { setIsLoadingListings(false); }
  }

  const analyzedCount = rows.filter((row) => hasFreshAnalysis(row, now)).length;
  const remainingCount = rows.filter((row) => !hasFreshAnalysis(row, now)).length;
  const taggedCount = rows.filter((row) => row.isTaggedForChange).length;
  const isRateLimited = rateLimitUntil > now;
  const visibleRows = useMemo(
    () => filterAndSortRows(rows, statusFilter, sortKey, sortDirection),
    [rows, sortDirection, sortKey, statusFilter],
  );
  useEffect(() => { setTablePage(page => Math.min(page, Math.max(0, Math.ceil(visibleRows.length / 100) - 1))); }, [visibleRows.length]);
  const selectedRow = rows.find((row) => row.listing.id === selectedListingId) ?? null;

  return (
    <section className="seller-page compact-seller-page">
      <div className="seller-hero panel compact-seller-hero">
        <div>
          <p className="eyebrow">Separate page</p>
          <h2>Seller Price Analyzer</h2>
          <p>Analyze the full store with saved progress. Review item-price comparisons and prepare bounded price-change drafts.</p>
        </div>
        <div className="seller-actions">
          {["127.0.0.1", "localhost"].includes(window.location.hostname) ? <button type="button" onClick={loadLocalRun} disabled={isAnalyzing || isLoadingListings || !storageReady}>Load Latest Local Run</button> : null}
          <button type="button" onClick={loadListings} disabled={isLoadingListings || isAnalyzing || !storageReady}>
            {isLoadingListings ? "Loading..." : rows.length ? "Refresh Listings" : "Load Active Listings"}
          </button>
          <button type="button" onClick={analyzeListings} disabled={rows.length === 0 || isAnalyzing || isLoadingListings || isRateLimited || !storageReady || remainingCount === 0}>
            {isRateLimited
              ? `Rate limited ${formatCooldown(rateLimitUntil - now)}`
              : isAnalyzing
              ? `Analyzing ${analyzedCount}/${rows.length}`
              : `Analyze All Remaining (${remainingCount})`}
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
            Import CSV / Checkpoint
            <input type="file" accept=".csv,.json,text/csv,application/json" disabled={isAnalyzing || isLoadingListings || !storageReady} onChange={(event) => { const input = event.currentTarget; void importSnapshotCsv(input.files?.[0]).finally(() => { input.value = ""; }); }} />
          </label>
          <button type="button" onClick={() => setShowCheckpointPaste(true)} disabled={isAnalyzing || isLoadingListings || !storageReady}>Paste Checkpoint</button>
          <button type="button" className="secondary-button" onClick={clearCachedAnalysis} disabled={isAnalyzing || isLoadingListings || rows.length === 0}>
            Clear Cache
          </button>
          <button type="button" onClick={prepareDrafts} disabled={isAnalyzing || isLoadingListings || analyzedCount === 0}>Prepare Sale Drafts (10–20%)</button>
          <button type="button" onClick={() => downloadCheckpoint(rows)} disabled={!rows.length}>Download Checkpoint</button>
          <button type="button" onClick={copyCheckpoint} disabled={!rows.length || isAnalyzing || isLoadingListings}>Copy Checkpoint</button>
          <button type="button" className="secondary-button" disabled={isAnalyzing || isLoadingListings || !rows.length} onClick={() => setRows(current => current.map(row => ({ ...row, state: "pending", analysis: undefined, searchResult: undefined, error: undefined })))}>Reanalyze Entire Store</button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {warnings.map((warning) => (
        <div className="warning-box" key={warning}>{warning}</div>
      ))}

      {showCheckpointPaste ? <section className="panel seller-checkpoint-import">
        <h3>Paste Checkpoint</h3>
        <p>Paste copied checkpoint text or the contents of a checkpoint JSON file. Import replaces this browser's saved queue and keeps proposed prices. Expired comparison evidence still requires a refresh.</p>
        <label>Checkpoint text<textarea ref={checkpointTextRef} rows={4} maxLength={MAX_CHECKPOINT_BYTES} spellCheck={false} autoComplete="off" disabled={isLoadingListings} /></label>
        <div className="seller-actions">
          <button type="button" onClick={importPastedCheckpoint} disabled={isLoadingListings}>{isLoadingListings ? "Importing and saving..." : "Import and Save Checkpoint"}</button>
          <button type="button" className="secondary-button" onClick={() => setShowCheckpointPaste(false)} disabled={isLoadingListings}>Cancel</button>
        </div>
      </section> : null}

      <div className="seller-stats compact-seller-stats">
        <Stat label="Active" value={rows.length} />
        <Stat label="Analyzed" value={analyzedCount} />
        <Stat label="Remaining" value={remainingCount} />
        <Stat label="Tagged" value={taggedCount} />
        <Stat label="Errors" value={rows.filter(row => row.state === "error").length} />
        <Stat label="Recommendations" value={rows.filter(row => row.analysis && row.analysis.confidence !== "insufficient" && hasFreshAnalysis(row)).length} />
      </div>

      <section className="panel seller-table-panel compact-table-panel">
        <div className="section-heading seller-table-heading">
          <div>
            <h2>Store Pricing Queue</h2>
            <span>Three or four matches give a tentative recommendation (10% draft cap). Five or more matches from multiple sellers can support a 20% cap. Evidence expires after six hours. No live prices are changed.</span>
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
                <option value="activeComparableCount">Matched sample</option>
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
              <span>Item median</span>
              <span>Delta</span>
              <span>Matched sample</span>
              <span>Proposed $</span>
            </div>
            {visibleRows.slice(tablePage * 100, (tablePage + 1) * 100).map((row) => (
              <SellerRow
                isSelected={row.listing.id === selectedListingId}
                onOpen={() => setSelectedListingId(row.listing.id)}
                row={row}
                key={row.listing.id}
              />
            ))}
          </div>
        )}
        {visibleRows.length > 0 ? <div className="seller-actions">
          <button type="button" className="secondary-button" disabled={tablePage === 0} onClick={() => setTablePage(page => page - 1)}>Previous</button>
          <span>Showing {Math.min(tablePage * 100 + 1, visibleRows.length)}–{Math.min((tablePage + 1) * 100, visibleRows.length)} of {visibleRows.length}. CSV includes all filtered rows.</span>
          <button type="button" className="secondary-button" disabled={(tablePage + 1) * 100 >= visibleRows.length} onClick={() => setTablePage(page => page + 1)}>Next</button>
        </div> : null}
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
      <span className="seller-status-pill">{statusLabel(row)}{analysis?.confidence && analysis.confidence !== "insufficient" ? <small className="seller-confidence">{analysis.confidence === "supported" ? "Supported" : "Tentative"}</small> : null}</span>
      <span>{sellerSku(row.listing) || "-"}</span>
      <span className="seller-sheet-title">{row.listing.title}</span>
      <strong>{money(row.listing.currentPrice, row.listing.currency)}</strong>
      <span>{analysis?.benchmarkPrice === null || !analysis ? "n/a" : money(analysis.benchmarkPrice, row.listing.currency)}</span>
      <span>{analysis?.deltaPercent === null || !analysis ? "n/a" : `${analysis.deltaPercent > 0 ? "+" : ""}${analysis.deltaPercent}%`}</span>
      <span>{analysis?.matchedCount ?? "n/a"}</span>
      <span>{row.proposedPrice !== undefined ? money(row.proposedPrice, row.listing.currency) : row.isTaggedForChange ? "Tagged" : "-"}</span>
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
  const retained = new Set(analysis?.comparableIds ?? []);
  const topListings = (row.searchResult?.listings ?? []).filter(comp => retained.has(comp.id)).sort((a, b) => a.price - b.price).slice(0, 10);
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
          <Metric label="Matched item-price median" value={analysis?.benchmarkPrice ? money(analysis.benchmarkPrice, row.listing.currency) : "n/a"} />
          <Metric label="Delta" value={analysis?.deltaPercent === null || !analysis ? "n/a" : `${analysis.deltaPercent > 0 ? "+" : ""}${analysis.deltaPercent}%`} />
          <Metric label="Matched sample" value={analysis?.matchedCount ?? "n/a"} />
          <Metric label="Status" value={statusLabel(row)} />
          <Metric label="Evidence" value={analysis?.confidence === "supported" ? "Supported" : analysis?.confidence === "indicative" ? "Tentative" : "Insufficient"} />
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
              placeholder="Example: reviewed pressing and shipping; lower price to move inventory."
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
            <h3>Matched Active Sample (item prices)</h3>
            {topListings[0] ? <span>Lowest: {money(topListings[0].price, topListings[0].currency)}</span> : null}
          </div>
          {topListings.length ? (
            <div className="listing-tile-grid seller-comp-tile-grid">
              {topListings.map((listing) => (
                <a className="listing-tile seller-comp-tile" href={listing.itemUrl} rel="noreferrer" target="_blank" key={listing.id}>
                  <div className="listing-tile-body">
                    <strong>{money(listing.price, listing.currency)}</strong>
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
  const filtered = rows.filter(row => statusFilter === "ALL" || (statusFilter === "TAGGED" ? row.isTaggedForChange : statusFilter === "SUPPORTED" ? row.analysis?.confidence === "supported" : statusFilter === "TENTATIVE" ? row.analysis?.confidence === "indicative" : rowStatus(row) === statusFilter));
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
  if (row.analysis) return row.analysis.status;
  if (row.state === "error" && !isRateLimitError(row.error)) return "ERROR";
  return "PENDING";
}

function statusLabel(row: AnalyzerRow): string {
  if (row.analysis) return statusLabels[row.analysis.status];
  if (row.state === "error") return "Error";
  return row.state;
}

function sortValue(row: AnalyzerRow, sortKey: SortKey): number {
  if (sortKey === "status") return rowPriority(row);
  if (sortKey === "currentPrice") return row.listing.currentPrice;
  if (sortKey === "deltaPercent") return row.analysis?.deltaPercent ?? Number.POSITIVE_INFINITY;
  return row.analysis?.matchedCount ?? Number.POSITIVE_INFINITY;
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
    "matched_item_median",
    "confidence",
    "maximum_reduction_percent",
    "delta_value",
    "delta_percent",
    "active_comparable_count",
    "matched_sample_count",
    "comparison_basis",
    "analyzed_at",
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
      matched_sample_count: analysis?.matchedCount ?? "",
      comparison_basis: analysis?.comparisonBasis ?? "legacy-unverified",
      analyzed_at: analysis?.analyzedAt ?? "",
      available_quantity: row.listing.availableQuantity ?? "",
      change_note: row.changeNote ?? "",
      matched_item_median: analysis?.benchmarkPrice ?? "",
      confidence: analysis?.confidence ?? "unverified",
      maximum_reduction_percent: analysis?.maximumDraftReductionPercent ?? "",
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

function csvEscape(value: unknown): string {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function sellerSku(listing: SellerListing): string {
  return listing.sku ?? listing.customLabel ?? "";
}

function money(value: number, currency = "USD"): string {
  return `${currency === "USD" ? "$" : `${currency} `}${value.toFixed(2)}`;
}



function downloadCheckpoint(rows: AnalyzerRow[]) {
  const blob = new Blob([JSON.stringify({ version: 2, rows })], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "seller-pricing-checkpoint.json";
  anchor.click(); URL.revokeObjectURL(url);
}
