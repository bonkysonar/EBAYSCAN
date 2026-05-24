import { useEffect, useMemo, useState } from "react";
import { BulkBuyLedger } from "./components/BulkBuyLedger";
import { CandidateListingList } from "./components/CandidateListingList";
import { DecisionBanner } from "./components/DecisionBanner";
import { PriceClusterSummary } from "./components/PriceClusterSummary";
import { ReasonCodesPanel } from "./components/ReasonCodesPanel";
import { SearchInputPanel } from "./components/SearchInputPanel";
import { SellerPriceAnalyzer } from "./components/SellerPriceAnalyzer";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  createBulkBuyBatch,
  loadBulkBuyBatches,
  saveBulkBuyBatches,
  type BulkBuyBatch,
} from "./lib/bulkBuy/batches";
import {
  bulkBuyRowMatchesDiscogs,
  createBulkBuyRow,
  updateBulkBuyRowFromDiscogs,
  type BulkBuyRow,
} from "./lib/bulkBuy/calculateBulkBuy";
import { EbayClient } from "./lib/ebay/client";
import { MockEbayClient } from "./lib/ebay/mockClient";
import type { DiscogsMarketSnapshot, DiscogsSalesStats, SearchInput, SearchResult } from "./lib/ebay/types";
import { scoreRecord } from "./lib/scoring/scoreRecord";
import type { ScoringSettings, TriageDecision } from "./lib/scoring/types";
import { loadSettings, saveSettings } from "./lib/storage/localSettings";

export function App() {
  const [route, setRoute] = useState<"scanner" | "seller">(() => routeFromHash());
  const [settings, setSettings] = useState<ScoringSettings>(() => loadSettings());
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [decision, setDecision] = useState<TriageDecision | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TriageDecision[]>([]);
  const [bulkBuyRows, setBulkBuyRows] = useState<BulkBuyRow[]>([]);
  const [savedBulkBuyBatches, setSavedBulkBuyBatches] = useState<BulkBuyBatch[]>(() => loadBulkBuyBatches());
  const ebayClient = useMemo(() => new EbayClient(), []);
  const mockClient = useMemo(() => new MockEbayClient(), []);

  useEffect(() => {
    function syncRoute() {
      setRoute(routeFromHash());
    }

    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  async function runSearch(input: SearchInput) {
    setIsSearching(true);
    setError(null);

    try {
      const result = await searchWithFallback(input);
      const nextDecision = scoreRecord(result, settings);
      setSearchResult(result);
      setDecision(nextDecision);
      setHistory((current) => [nextDecision, ...current].slice(0, 6));
      setBulkBuyRows((current) => {
        const nextOrder = nextBulkBuyOrder(current);
        return [
          createBulkBuyRow({
            discogs: result.marketSnapshot?.discogs,
            input: result.input,
            order: nextOrder,
            priceSummary: nextDecision.priceSummary,
            searchResult: result,
          }),
          ...current,
        ];
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  }

  async function searchWithFallback(input: SearchInput): Promise<SearchResult> {
    if (input.type === "image") {
      return mockClient.search(input);
    }

    try {
      return await ebayClient.search(input);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown eBay error";

      if (shouldUseMockFallback(input)) {
        const fallback = await mockClient.search(input);
        return {
          ...fallback,
          warnings: [`Real eBay lookup failed, showing demo mock fallback: ${message}`, ...fallback.warnings],
        };
      }

      return {
        input,
        listings: [],
        source: "ebay",
        timestamp: new Date().toISOString(),
        warnings: [`Real eBay lookup failed: ${message}. Generate a fresh eBay application token or try again.`],
        rawSummary: "No live eBay results were shown because the real lookup failed.",
      };
    }
  }

  function shouldUseMockFallback(input: SearchInput): boolean {
    if (input.type === "barcode") {
      return ["012345LOW", "999999RARE"].includes(input.barcode.toUpperCase());
    }

    if (input.type === "manual") {
      const query = input.query.toLowerCase();
      return query.includes("mixed ambiguous") || query.includes("promo white label");
    }

    return false;
  }

  function updateSettings(nextSettings: ScoringSettings) {
    setSettings(nextSettings);
    saveSettings(nextSettings);
    if (searchResult) {
      setDecision(scoreRecord(searchResult, nextSettings));
    }
  }

  function resetForNextRecord() {
    setSearchResult(null);
    setDecision(null);
    setError(null);
  }

  function deleteBulkBuyRow(rowId: string) {
    setBulkBuyRows((current) => current.filter((row) => row.id !== rowId));
  }

  function openBulkBuyRow(row: BulkBuyRow) {
    if (!row.searchResult) return;
    setSearchResult(row.searchResult);
    setDecision(scoreRecord(row.searchResult, settings));
    setError(null);
  }

  function resetBulkBuyBatch() {
    setBulkBuyRows([]);
  }

  function saveCurrentBulkBuyBatch(name: string) {
    if (bulkBuyRows.length === 0) return;
    const nextBatches = [createBulkBuyBatch(bulkBuyRows, name), ...savedBulkBuyBatches].slice(0, 20);
    setSavedBulkBuyBatches(nextBatches);
    saveBulkBuyBatches(nextBatches);
  }

  function loadSavedBulkBuyBatch(batchId: string) {
    const batch = savedBulkBuyBatches.find((candidate) => candidate.id === batchId);
    if (!batch) return;
    setBulkBuyRows(batch.rows);
  }

  function importDiscogsSalesStats(stats: DiscogsSalesStats) {
    if (!searchResult?.marketSnapshot?.discogs) return;
    applyDiscogsSalesStats(stats);
  }

  async function pullDiscogsSalesStats(discogs: DiscogsMarketSnapshot): Promise<DiscogsSalesStats> {
    const response = await fetch("/api/discogs/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        releaseId: discogs.releaseId,
        releaseUrl: discogs.releaseUrl,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Discogs stats pull failed.");
    }

    const stats = payload as DiscogsSalesStats;
    applyDiscogsSalesStats(stats);
    return stats;
  }

  function applyDiscogsSalesStats(stats: DiscogsSalesStats) {
    if (!searchResult?.marketSnapshot?.discogs) return;

    const discogs = {
      ...searchResult.marketSnapshot.discogs,
      salesStats: stats,
    };
    const nextResult: SearchResult = {
      ...searchResult,
      marketSnapshot: {
        ...searchResult.marketSnapshot,
        discogs,
      },
    };
    const nextDecision = scoreRecord(nextResult, settings);
    setSearchResult(nextResult);
    setDecision(nextDecision);
    setBulkBuyRows((current) =>
      current.map((row, index) =>
        index === 0 || bulkBuyRowMatchesDiscogs(row, discogs)
          ? { ...updateBulkBuyRowFromDiscogs(row, discogs, nextDecision.priceSummary), searchResult: nextResult }
          : row,
      ),
    );
  }

  function acceptDiscogsPressing(pressing: {
    matchedTitle?: string;
    releaseId?: number;
    releaseUrl: string;
    salesStats?: DiscogsSalesStats;
  }) {
    if (!searchResult?.marketSnapshot?.discogs) return;

    const previousDiscogs = searchResult.marketSnapshot.discogs;
    const isSamePressing =
      Boolean(pressing.releaseId && previousDiscogs.releaseId && pressing.releaseId === previousDiscogs.releaseId) ||
      Boolean(pressing.releaseUrl && previousDiscogs.releaseUrl && pressing.releaseUrl === previousDiscogs.releaseUrl);
    const discogs: DiscogsMarketSnapshot = {
      ...previousDiscogs,
      matchedTitle: pressing.matchedTitle ?? previousDiscogs.matchedTitle,
      releaseId: pressing.releaseId ?? previousDiscogs.releaseId,
      releaseUrl: pressing.releaseUrl,
      salesStats: pressing.salesStats
        ? {
            ...pressing.salesStats,
            importedAt: new Date().toISOString(),
            source: "browser_extension",
          }
        : isSamePressing
          ? previousDiscogs.salesStats
          : undefined,
      status: "available",
      warnings: [],
    };
    const nextResult: SearchResult = {
      ...searchResult,
      marketSnapshot: {
        ...searchResult.marketSnapshot,
        discogs,
      },
    };
    const nextDecision = scoreRecord(nextResult, settings);

    setSearchResult(nextResult);
    setDecision(nextDecision);
    setBulkBuyRows((current) =>
      current.map((row, index) =>
        index === 0 || bulkBuyRowMatchesDiscogs(row, previousDiscogs)
          ? { ...updateBulkBuyRowFromDiscogs(row, discogs, nextDecision.priceSummary), searchResult: nextResult }
          : row,
      ),
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Bulk Buy Scanner</h1>
          <p>Scan records, estimate offer prices, and tally the buy.</p>
        </div>
        <nav className="app-nav" aria-label="App pages">
          <a className={route === "scanner" ? "active" : ""} href="#/scanner">Scanner</a>
          <a className={route === "seller" ? "active" : ""} href="#/seller-prices">Seller Price Analyzer</a>
        </nav>
        {route === "scanner" ? (
          <button className="next-button" type="button" onClick={resetForNextRecord}>
            Next Record
          </button>
        ) : null}
      </header>

      {route === "seller" ? <SellerPriceAnalyzer /> : <section className="workbench-grid">
        <div className="panel stack">
          <SearchInputPanel isSearching={isSearching} onSearch={runSearch} />
          <SettingsPanel settings={settings} onChange={updateSettings} />
        </div>

        <div className="stack result-column">
          {error ? <div className="error-box">{error}</div> : null}
          {decision ? (
            <>
              <DecisionBanner decision={decision} input={searchResult?.input ?? null} />
              <PriceClusterSummary
                discogs={searchResult?.marketSnapshot?.discogs}
                ebayResearchKeywords={searchResult?.marketSnapshot?.ebayResearchKeywords}
                ebayResearchUrl={searchResult?.marketSnapshot?.ebayResearchUrl}
                onDiscogsSalesStatsImport={importDiscogsSalesStats}
                onDiscogsPressingAccept={acceptDiscogsPressing}
                onDiscogsSalesStatsPull={pullDiscogsSalesStats}
                summary={decision.priceSummary}
              />
              <CandidateListingList listings={decision.topListings} />
              <ReasonCodesPanel reasons={decision.reasons} warnings={decision.warnings} />
            </>
          ) : (
            <section className="empty-state">
              <h2>Ready for the next record</h2>
              <p>Scan a barcode, search a catalog number, type a manual search, or try the image placeholder. Enter submits text inputs.</p>
              <div className="demo-list">
                <span>Try: 012345LOW</span>
                <span>Try: 999999RARE</span>
                <span>Try catalog: 60296-1</span>
                <span>Try real search: fleetwood mac rumours</span>
              </div>
            </section>
          )}
        </div>

        <aside className="stack">
          <BulkBuyLedger
            rows={bulkBuyRows}
            savedBatches={savedBulkBuyBatches}
            onDelete={deleteBulkBuyRow}
            onLoadBatch={loadSavedBulkBuyBatch}
            onOpenRow={openBulkBuyRow}
            onResetBatch={resetBulkBuyBatch}
            onSaveBatch={saveCurrentBulkBuyBatch}
          />
          <section className="panel history-panel">
            <h2>Recent Decisions</h2>
            {history.length === 0 ? <p className="muted">No records triaged yet.</p> : null}
            {history.map((item, index) => (
              <div className={`history-item ${item.decision.toLowerCase()}`} key={`${item.decision}-${index}`}>
                <strong>{item.decision}</strong>
                <span>{Math.round(item.confidence * 100)}% confidence</span>
                <small>{item.suggestedAction}</small>
              </div>
            ))}
          </section>
        </aside>
      </section>}
    </main>
  );
}

function routeFromHash(): "scanner" | "seller" {
  return window.location.hash === "#/seller-prices" ? "seller" : "scanner";
}

function nextBulkBuyOrder(rows: BulkBuyRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.order), 0) + 1;
}

