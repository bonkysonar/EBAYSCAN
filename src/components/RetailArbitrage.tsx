import { useEffect, useMemo, useState } from "react";
import { buildNewVinylResearchUrl, buildResearchKeywords } from "../lib/arbitrage/normalizeResearch";
import { scoreArbitrageFind } from "../lib/arbitrage/rules";
import { loadArbitrageFinds, loadArbitrageSettings, saveArbitrageFinds, saveArbitrageSettings } from "../lib/arbitrage/storage";
import type { ArbitrageDecision, ArbitrageFind, ArbitrageImportPayload, ArbitrageScoredFind, ArbitrageSettings } from "../lib/arbitrage/types";
import { readJsonResponse } from "../lib/http/jsonResponse";
import {
  getActiveRetailSources,
  getSourceGroupLabel,
  retailArbitrageSourceCatalog,
  sourceGroups,
} from "../lib/arbitrage/vinylShopSources";

type DecisionFilter = "ACTIVE" | "ALL" | "DISMISSED" | "NEEDS_RESEARCH" | ArbitrageDecision;
type SortDirection = "asc" | "desc";
type SortKey = "capturedAt" | "decision" | "lowest" | "margin" | "price" | "research" | "sold" | "source" | "title";
type LatestFindsResponse =
  | {
      fileName: string;
      payload: ArbitrageImportPayload;
      status: "available";
    }
  | {
      message: string;
      status: "empty";
    };
type LatestFindsErrorResponse = { error: string };

const decisionOptions: Array<{ label: string; value: DecisionFilter }> = [
  { label: "Active finds", value: "ACTIVE" },
  { label: "Buy", value: "BUY" },
  { label: "Watch", value: "WATCH" },
  { label: "Review", value: "REVIEW" },
  { label: "Reject", value: "REJECT" },
  { label: "Needs active search", value: "NEEDS_RESEARCH" },
  { label: "Dismissed", value: "DISMISSED" },
  { label: "All", value: "ALL" },
];

const sortableColumns: Array<{ key: SortKey; label: string }> = [
  { key: "decision", label: "Status" },
  { key: "title", label: "Title" },
  { key: "price", label: "Purchase" },
  { key: "lowest", label: "eBay Low" },
  { key: "margin", label: "Spread" },
  { key: "sold", label: "Sold" },
  { key: "research", label: "Research" },
  { key: "source", label: "Source" },
];

export function RetailArbitrage() {
  const [finds, setFinds] = useState<ArbitrageFind[]>(() => loadArbitrageFinds());
  const [settings, setSettings] = useState<ArbitrageSettings>(() => loadArbitrageSettings());
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("ACTIVE");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("margin");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [latestMessage, setLatestMessage] = useState<string | null>(null);
  const [isLoadingLatest, setIsLoadingLatest] = useState(false);
  const scoredFinds = useMemo(() => finds.map((find) => scoreArbitrageFind(find, settings)), [finds, settings]);
  const visibleFinds = useMemo(
    () => filterAndSortFinds(scoredFinds, decisionFilter, sourceFilter, sortKey, sortDirection),
    [decisionFilter, scoredFinds, sortDirection, sortKey, sourceFilter],
  );
  const selectedFind = scoredFinds.find((find) => find.id === selectedId) ?? visibleFinds[0] ?? null;
  const stats = summarizeFinds(scoredFinds);
  const activeSources = useMemo(() => getActiveRetailSources(), []);
  const groupedSources = useMemo(() => groupSourcesForUi(activeSources), [activeSources]);
  const groupedCatalogSources = useMemo(() => groupSourcesForUi(retailArbitrageSourceCatalog), []);

  useEffect(() => {
    saveArbitrageFinds(finds);
  }, [finds]);

  useEffect(() => {
    saveArbitrageSettings(settings);
  }, [settings]);

  useEffect(() => {
    void loadLatestFinds();
  }, []);

  function updateSetting<K extends keyof ArbitrageSettings>(key: K, value: ArbitrageSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function dismissFind(findId: string) {
    setFinds((current) =>
      current.map((find) => (find.id === findId ? { ...find, dismissedAt: new Date().toISOString() } : find)),
    );
  }

  function restoreFind(findId: string) {
    setFinds((current) => current.map((find) => (find.id === findId ? { ...find, dismissedAt: undefined } : find)));
  }

  function removeDismissed() {
    setFinds((current) => current.filter((find) => !find.dismissedAt));
    setSelectedId(null);
  }

  function toggleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(defaultSortDirection(nextSortKey));
  }

  async function loadLatestFinds() {
    setIsLoadingLatest(true);

    try {
      const response = await fetch(`/api/arbitrage/latest?ts=${Date.now()}`, { cache: "no-store" });
      const payload = await readJsonResponse<LatestFindsErrorResponse | LatestFindsResponse>(response, "Latest finds endpoint");
      if ("error" in payload) throw new Error(payload.error);
      if (!response.ok) throw new Error("Latest finds load failed.");

      if (payload.status === "empty") {
        setLatestMessage(payload.message);
        return;
      }

      const productFinds = payload.payload.finds.filter(isIndividualRecordFind);
      setFinds((current) => replaceWithLatestFinds(current, productFinds));
      setLatestMessage(`Loaded ${productFinds.length} individual records from ${payload.fileName}.`);
    } catch (caught) {
      setLatestMessage(caught instanceof Error ? caught.message : "Latest finds load failed.");
    } finally {
      setIsLoadingLatest(false);
    }
  }

  return (
    <section className="arbitrage-page">
      <div className="seller-hero panel compact-seller-hero arbitrage-hero">
        <div>
          <h2>Retail Arbitrage</h2>
          <p>Daily buy candidates from the vinyl shop source list. Filter the queue, dismiss noise, and tune what counts as enough margin.</p>
        </div>
        <div className="seller-actions">
          <button type="button" onClick={loadLatestFinds} disabled={isLoadingLatest}>
            {isLoadingLatest ? "Loading..." : "Refresh Latest"}
          </button>
          <button type="button" onClick={() => downloadFindsJson(visibleFinds)} disabled={visibleFinds.length === 0}>
            Export Visible
          </button>
          <button type="button" className="secondary-button" onClick={removeDismissed} disabled={!stats.dismissed}>
            Clear Dismissed
          </button>
        </div>
      </div>

      {latestMessage ? <div className="warning-box">{latestMessage}</div> : null}

      <div className="seller-stats compact-seller-stats">
        <Stat label="Buy" value={stats.BUY} />
        <Stat label="Watch" value={stats.WATCH} />
        <Stat label="Review" value={stats.REVIEW} />
        <Stat label="Reject" value={stats.REJECT} />
        <Stat label="Active Priced" value={stats.activePriced} />
        <Stat label="Needs Active" value={stats.needsResearch} />
        <Stat label="Dismissed" value={stats.dismissed} />
        <Stat label="Sources" value={activeSources.length} />
      </div>

      <section className="arbitrage-layout">
        <aside className="panel arbitrage-settings">
          <div className="section-heading">
            <h2>Parameters</h2>
            <span>Saved locally</span>
          </div>
          <NumberSetting label="Minimum spread $" value={settings.minMarginDollars} step={0.5} onChange={(value) => updateSetting("minMarginDollars", value)} />
          <NumberSetting label="Minimum spread ratio" value={settings.minMarginRatio} step={0.05} onChange={(value) => updateSetting("minMarginRatio", value)} />
          <NumberSetting label="Repeat-seller sold count" value={settings.minOneSellerSoldCount} step={1} onChange={(value) => updateSetting("minOneSellerSoldCount", value)} />
          <NumberSetting label="Total sold count" value={settings.minTotalSoldCount} step={1} onChange={(value) => updateSetting("minTotalSoldCount", value)} />
          <NumberSetting label="Minimum avg sold $" value={settings.minAverageSoldPrice} step={0.5} onChange={(value) => updateSetting("minAverageSoldPrice", value)} />
          <NumberSetting label="Scarce active max" value={settings.maxActiveListingsForScarceSingle} step={1} onChange={(value) => updateSetting("maxActiveListingsForScarceSingle", value)} />
          <NumberSetting label="Source tax %" value={settings.sourceTaxRatePercent} step={0.1} onChange={(value) => updateSetting("sourceTaxRatePercent", value)} />

          <div className="arbitrage-source-list">
            <h3>Sources</h3>
            {sourceGroups.map((group) => {
              const sources = groupedCatalogSources.get(group) ?? [];
              if (!sources.length) return null;
              return (
                <div className="arbitrage-source-group" key={group}>
                  <h4>{group}</h4>
                  {sources.map((source) => (
                    <a className={source.isDiscoveryOnly ? "discovery-source" : ""} href={source.baseUrl} key={source.id} rel="noreferrer" target="_blank">
                      <span>{source.displayName}</span>
                      <small>{source.country} · P{source.priority} · {source.noiseLevel}</small>
                    </a>
                  ))}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="panel arbitrage-table-panel">
          <div className="section-heading seller-table-heading">
            <div>
              <h2>Finds</h2>
              <span>{visibleFinds.length} visible of {finds.length}</span>
            </div>
            <div className="seller-controls">
              <label>
                Status
                <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value as DecisionFilter)}>
                  {decisionOptions.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Source
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                  <option value="ALL">All sources</option>
                  {sourceGroups.map((group) => {
                    const sources = groupedSources.get(group) ?? [];
                    if (!sources.length) return null;
                    return (
                      <optgroup label={group} key={group}>
                        {sources.map((source) => (
                          <option value={source.id} key={source.id}>{source.displayName}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </label>
            </div>
          </div>

          {visibleFinds.length === 0 ? (
            <div className="empty-state arbitrage-empty">
              <h2>No finds in this view</h2>
              <p>Import the daily JSON from the automation, or loosen the filters.</p>
            </div>
          ) : (
            <div className="arbitrage-find-list">
              <div className="arbitrage-find-header" role="row">
                {sortableColumns.map((column) => (
                  <button
                    className={`arbitrage-sort ${sortKey === column.key ? "active" : ""}`}
                    type="button"
                    key={column.key}
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.label} {sortKey === column.key ? (sortDirection === "asc" ? "Asc" : "Desc") : ""}
                  </button>
                ))}
              </div>
              {visibleFinds.map((find) => (
                <button
                  className={`arbitrage-find-row ${find.decision.toLowerCase()} ${find.id === selectedFind?.id ? "selected" : ""}`}
                  type="button"
                  key={find.id}
                  onClick={() => setSelectedId(find.id)}
                >
                  <span className="seller-status-pill">{find.dismissedAt ? "Dismissed" : find.decision}</span>
                  <span className="arbitrage-title">{find.artist} - {find.title}</span>
                  <strong>{money(find.purchasePrice)}</strong>
                  <span>{lowestActiveLabel(find)}</span>
                  <span>{find.estimatedMargin === null ? "n/a" : money(find.estimatedMargin)}</span>
                  <span>{soldEvidenceLabel(find)}</span>
                  <span>{researchStatusLabel(find)}</span>
                  <span>{find.sourceName}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="panel arbitrage-detail">
          {selectedFind ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>{selectedFind.title}</h2>
                  <span>{selectedFind.artist}</span>
                </div>
                <strong className={`arbitrage-decision ${selectedFind.decision.toLowerCase()}`}>{selectedFind.decision}</strong>
              </div>
              <dl className="arbitrage-metrics">
                <Metric label="Purchase" value={money(selectedFind.purchasePrice)} />
                <Metric label="All-in cost" value={money(selectedFind.allInCost)} />
                <Metric label="eBay active low" value={lowestActiveLabel(selectedFind)} />
                <Metric label="Avg sold total" value={soldTotalLabel(selectedFind)} />
                <Metric label="Spread" value={selectedFind.estimatedMargin === null ? "n/a" : money(selectedFind.estimatedMargin)} />
                <Metric label="Ratio" value={selectedFind.marginRatio === null ? "n/a" : `${Math.round(selectedFind.marginRatio * 100)}%`} />
                <Metric label="Active" value={selectedFind.activeListingCount ?? "n/a"} />
                <Metric label="Research" value={researchStatusLabel(selectedFind)} />
              </dl>
              <div className="seller-detail-actions arbitrage-links">
                <a href={selectedFind.sourceUrl} target="_blank" rel="noreferrer">Open source</a>
                <a href={cleanEbayResearchUrl(selectedFind)} target="_blank" rel="noreferrer">Open eBay research</a>
                {selectedFind.dismissedAt ? (
                  <button type="button" onClick={() => restoreFind(selectedFind.id)}>Restore</button>
                ) : (
                  <button type="button" className="secondary-button" onClick={() => dismissFind(selectedFind.id)}>Dismiss</button>
                )}
              </div>
              <div className="seller-detail-reasons">
                <h3>Research query</h3>
                <p className="muted">{researchKeywordsForFind(selectedFind)}</p>
                {selectedFind.ebayActiveSearchKeyword ? (
                  <p className="muted">Active eBay query: {selectedFind.ebayActiveSearchKeyword}</p>
                ) : null}
                {selectedFind.ebayResearchKeywordVariants?.length ? (
                  <p className="muted">Variants: {selectedFind.ebayResearchKeywordVariants.join(" | ")}</p>
                ) : null}
              </div>
              {selectedFind.lowestActiveTitle ? (
                <div className="seller-detail-reasons">
                  <h3>Lowest active new vinyl</h3>
                  <p>{selectedFind.lowestActiveTitle}</p>
                  {selectedFind.lowestActiveUrl ? <a href={selectedFind.lowestActiveUrl} target="_blank" rel="noreferrer">Open active listing</a> : null}
                </div>
              ) : null}
              <div className="seller-detail-reasons">
                <h3>Why</h3>
                <ul>{selectedFind.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </div>
              {selectedFind.notes?.length ? (
                <div className="seller-detail-reasons">
                  <h3>Notes</h3>
                  <ul>{selectedFind.notes.map((note) => <li key={note}>{note}</li>)}</ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">Select a find to review its margin and sales evidence.</p>
          )}
        </aside>
      </section>
    </section>
  );
}

function NumberSetting({
  label,
  onChange,
  step,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="arbitrage-setting-row">
      <span>{label}</span>
      <input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
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
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function groupSourcesForUi<T extends { group: string }>(sources: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const source of sources) {
    const group = getSourceGroupLabel(source as never);
    grouped.set(group, [...(grouped.get(group) ?? []), source]);
  }
  return grouped;
}

function filterAndSortFinds(
  finds: ArbitrageScoredFind[],
  decisionFilter: DecisionFilter,
  sourceFilter: string,
  sortKey: SortKey,
  sortDirection: SortDirection,
): ArbitrageScoredFind[] {
  return finds
    .filter((find) => {
      if (!isIndividualRecordFind(find)) return false;
      const sourceMatch = sourceFilter === "ALL" || find.sourceId === sourceFilter;
      if (!sourceMatch) return false;
      if (decisionFilter === "ALL") return true;
      if (decisionFilter === "ACTIVE") return !find.dismissedAt;
      if (decisionFilter === "DISMISSED") return Boolean(find.dismissedAt);
      if (decisionFilter === "NEEDS_RESEARCH") return !find.dismissedAt && needsActiveSearch(find);
      return !find.dismissedAt && find.decision === decisionFilter;
    })
    .sort((left, right) => compareFinds(left, right, sortKey, sortDirection));
}

function compareFinds(left: ArbitrageScoredFind, right: ArbitrageScoredFind, sortKey: SortKey, sortDirection: SortDirection): number {
  const leftValue = sortValue(left, sortKey);
  const rightValue = sortValue(right, sortKey);
  const directionMultiplier = sortDirection === "asc" ? 1 : -1;
  const compared =
    typeof leftValue === "string" || typeof rightValue === "string"
      ? String(leftValue).localeCompare(String(rightValue))
      : leftValue - rightValue;

  return compared * directionMultiplier || left.title.localeCompare(right.title);
}

function sortValue(find: ArbitrageScoredFind, sortKey: SortKey): number | string {
  if (sortKey === "capturedAt") return new Date(find.capturedAt).getTime();
  if (sortKey === "decision") return decisionRank(find.decision);
  if (sortKey === "lowest") return find.lowestActivePrice ?? Number.POSITIVE_INFINITY;
  if (sortKey === "price") return find.purchasePrice;
  if (sortKey === "research") return researchRank(find);
  if (sortKey === "sold") return find.oneSellerSoldCount ?? find.totalSoldCount ?? 0;
  if (sortKey === "source") return find.sourceName.toLowerCase();
  if (sortKey === "title") return `${find.artist} ${find.title}`.toLowerCase();
  return find.estimatedMargin ?? Number.NEGATIVE_INFINITY;
}

function defaultSortDirection(sortKey: SortKey): SortDirection {
  return sortKey === "lowest" || sortKey === "source" || sortKey === "title" ? "asc" : "desc";
}

function decisionRank(decision: ArbitrageDecision): number {
  if (decision === "BUY") return 4;
  if (decision === "WATCH") return 3;
  if (decision === "REVIEW") return 2;
  return 1;
}

function summarizeFinds(finds: ArbitrageScoredFind[]) {
  return finds.filter(isIndividualRecordFind).reduce(
    (accumulator, find) => {
      accumulator[find.decision] += find.dismissedAt ? 0 : 1;
      accumulator.activePriced += !find.dismissedAt && find.ebayActiveSearchStatus === "available" ? 1 : 0;
      accumulator.needsResearch += !find.dismissedAt && needsActiveSearch(find) ? 1 : 0;
      accumulator.dismissed += find.dismissedAt ? 1 : 0;
      return accumulator;
    },
    { BUY: 0, REVIEW: 0, REJECT: 0, WATCH: 0, activePriced: 0, dismissed: 0, needsResearch: 0 },
  );
}

function replaceWithLatestFinds(current: ArbitrageFind[], incoming: ArbitrageFind[]): ArbitrageFind[] {
  const byId = new Map(current.map((find) => [find.id, find]));
  return incoming.map((find) => {
    const existing = byId.get(find.id);
    return existing?.dismissedAt ? { ...find, dismissedAt: existing.dismissedAt } : find;
  }).sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime());
}

function isIndividualRecordFind(find: ArbitrageFind): boolean {
  if (find.opportunityType === "sitewide_sale" || find.purchasePrice <= 0) return false;
  if (!find.artist.trim() || !find.title.trim() || /^unknown artist$/i.test(find.artist.trim())) return false;
  return !isSourceCopyTitle(find.title);
}

function isSourceCopyTitle(title: string): boolean {
  return /^(?:cheap|deals?|home|facebook page|filter amazon|click here|continue shopping|sign up|sign in|order history|premium membership|time|under|\d+% off)$/i.test(
    title.replace(/&nbsp;/g, " ").trim(),
  );
}

function soldTotalLabel(find: ArbitrageScoredFind): string {
  if (find.averageSoldPrice === null || find.averageSoldPrice === undefined) return "n/a";
  return money(find.averageSoldPrice + (find.averageSoldShipping ?? 0));
}

function cleanEbayResearchUrl(find: ArbitrageScoredFind): string {
  const parts = researchPartsForFind(find);
  return buildNewVinylResearchUrl(parts.artist, parts.title);
}

function researchKeywordsForFind(find: ArbitrageScoredFind): string {
  const parts = researchPartsForFind(find);
  return buildResearchKeywords(parts.artist, parts.title);
}

function researchPartsForFind(find: ArbitrageFind): { artist: string; title: string } {
  const sourceTitle = find.sourceListingTitle ?? "";
  const match = sourceTitle.match(/^(.{2,80}?)(?:\s+-\s+|\s*:\s+)(.{2,})$/);
  if (match) return { artist: match[1], title: match[2] };
  return { artist: find.artist, title: find.title };
}

function needsActiveSearch(find: ArbitrageFind): boolean {
  return find.opportunityType !== "sitewide_sale" && find.ebayActiveSearchStatus !== "available" && find.ebayActiveSearchStatus !== "no_results";
}

function researchRank(find: ArbitrageFind): number {
  if (find.ebayResearchStatus === "validated") return 3;
  if (find.ebayResearchStatus === "no_rows") return 2;
  if (find.ebayResearchStatus === "failed") return 1;
  return 0;
}

function researchStatusLabel(find: ArbitrageFind): string {
  if (find.ebayResearchStatus === "validated") return "eBay validated";
  if (find.ebayResearchStatus === "no_rows") return "No eBay rows";
  if (find.ebayResearchStatus === "failed") return "Research failed";
  return "Research pending";
}

function soldEvidenceLabel(find: ArbitrageFind): string {
  if (find.oneSellerSoldCount !== null && find.oneSellerSoldCount !== undefined && find.totalSoldCount !== null && find.totalSoldCount !== undefined) {
    return `${find.oneSellerSoldCount} / ${find.totalSoldCount} sold`;
  }
  if (find.ebayResearchStatus === "no_rows") return "0 sold rows";
  return "Pending";
}

function lowestActiveLabel(find: ArbitrageFind): string {
  if (find.lowestActivePrice !== null && find.lowestActivePrice !== undefined) return money(find.lowestActivePrice);
  if (find.ebayActiveSearchStatus === "no_results") return "No active";
  if (find.ebayActiveSearchStatus === "failed") return "Failed";
  return "Pending";
}

function downloadFindsJson(finds: ArbitrageScoredFind[]) {
  const payload: ArbitrageImportPayload = {
    createdAt: new Date().toISOString(),
    finds,
    source: "record-scanner-retail-arbitrage",
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `retail-arbitrage-finds-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}
