import { useMemo, useState } from "react";
import { CandidateListingList } from "./components/CandidateListingList";
import { DecisionBanner } from "./components/DecisionBanner";
import { PriceClusterSummary } from "./components/PriceClusterSummary";
import { ReasonCodesPanel } from "./components/ReasonCodesPanel";
import { SearchInputPanel } from "./components/SearchInputPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { EbayClient } from "./lib/ebay/client";
import { MockEbayClient } from "./lib/ebay/mockClient";
import type { SearchInput, SearchResult } from "./lib/ebay/types";
import { scoreRecord } from "./lib/scoring/scoreRecord";
import type { ScoringSettings, TriageDecision } from "./lib/scoring/types";
import { loadSettings, saveSettings } from "./lib/storage/localSettings";

export function App() {
  const [settings, setSettings] = useState<ScoringSettings>(() => loadSettings());
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [decision, setDecision] = useState<TriageDecision | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TriageDecision[]>([]);
  const ebayClient = useMemo(() => new EbayClient(), []);
  const mockClient = useMemo(() => new MockEbayClient(), []);

  async function runSearch(input: SearchInput) {
    setIsSearching(true);
    setError(null);

    try {
      const result = await searchWithFallback(input);
      const nextDecision = scoreRecord(result, settings);
      setSearchResult(result);
      setDecision(nextDecision);
      setHistory((current) => [nextDecision, ...current].slice(0, 6));
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Record Scanner</h1>
          <p>Fast conservative triage for David's vinyl resale workflow.</p>
        </div>
        <button className="next-button" type="button" onClick={resetForNextRecord}>
          Next Record
        </button>
      </header>

      <section className="workbench-grid">
        <div className="panel stack">
          <SearchInputPanel isSearching={isSearching} onSearch={runSearch} />
          <SettingsPanel settings={settings} onChange={updateSettings} />
        </div>

        <div className="stack result-column">
          {error ? <div className="error-box">{error}</div> : null}
          {decision ? (
            <>
              <DecisionBanner decision={decision} input={searchResult?.input ?? null} />
              <div className="result-details">
                <PriceClusterSummary sourceSummary={searchResult?.rawSummary} summary={decision.priceSummary} />
                <ReasonCodesPanel reasons={decision.reasons} warnings={decision.warnings} />
              </div>
              <CandidateListingList listings={decision.topListings} />
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

        <aside className="panel history-panel">
          <h2>Recent Decisions</h2>
          {history.length === 0 ? <p className="muted">No records triaged yet.</p> : null}
          {history.map((item, index) => (
            <div className={`history-item ${item.decision.toLowerCase()}`} key={`${item.decision}-${index}`}>
              <strong>{item.decision}</strong>
              <span>{Math.round(item.confidence * 100)}% confidence</span>
              <small>{item.suggestedAction}</small>
            </div>
          ))}
        </aside>
      </section>
    </main>
  );
}

