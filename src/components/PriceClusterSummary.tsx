import { useEffect, useRef, useState } from "react";
import type { DiscogsMarketSnapshot, DiscogsSalesStats } from "../lib/ebay/types";
import { parseDiscogsSalesStats } from "../lib/discogs/parseSalesStats";
import type { PriceSummary } from "../lib/scoring/types";

type Props = {
  discogs?: DiscogsMarketSnapshot;
  ebayResearchKeywords?: string;
  ebayResearchUrl?: string;
  onDiscogsSalesStatsImport?: (stats: DiscogsSalesStats) => void;
  onDiscogsSalesStatsPull?: (discogs: DiscogsMarketSnapshot) => Promise<DiscogsSalesStats>;
  sourceSummary?: string;
  summary: PriceSummary;
};

export function PriceClusterSummary({
  discogs,
  ebayResearchKeywords,
  ebayResearchUrl,
  onDiscogsSalesStatsImport,
  onDiscogsSalesStatsPull,
  sourceSummary,
  summary,
}: Props) {
  return (
    <section className="panel summary-panel">
      <h2>Price Cluster</h2>
      <dl className="summary-grid">
        <div><dt>Lowest</dt><dd>{money(summary.lowestTotalPrice)}</dd></div>
        <div><dt>Avg cheapest {summary.cheapestTenCount || 10}</dt><dd>{money(summary.averageCheapestTenTotalPrice)}</dd></div>
        <div><dt>Median</dt><dd>{money(summary.medianTotalPrice)}</dd></div>
        <div><dt>Title matches</dt><dd>{summary.relevantResultCount}</dd></div>
        <div><dt>Total results</dt><dd>{summary.resultCount}</dd></div>
        <div><dt>Same cluster</dt><dd>{summary.sameTitleClusterCount}</dd></div>
        <div><dt>High outliers</dt><dd>{summary.highOutlierCount}</dd></div>
      </dl>
      {ebayResearchUrl ? (
        <a className="research-link" href={ebayResearchUrl} rel="noreferrer" target="_blank">
          Open eBay sold research{ebayResearchKeywords ? `: ${ebayResearchKeywords}` : ""}
        </a>
      ) : null}
      {sourceSummary ? <p className="source-summary">{sourceSummary}</p> : null}
      {discogs ? (
        <DiscogsSummary
          discogs={discogs}
          onSalesStatsImport={onDiscogsSalesStatsImport}
          onSalesStatsPull={onDiscogsSalesStatsPull}
        />
      ) : null}
    </section>
  );
}

function DiscogsSummary({
  discogs,
  onSalesStatsImport,
  onSalesStatsPull,
}: {
  discogs: DiscogsMarketSnapshot;
  onSalesStatsImport?: (stats: DiscogsSalesStats) => void;
  onSalesStatsPull?: (discogs: DiscogsMarketSnapshot) => Promise<DiscogsSalesStats>;
}) {
  const [statsText, setStatsText] = useState("");
  const [parseMessage, setParseMessage] = useState<string | null>(null);
  const [pullMessage, setPullMessage] = useState<string | null>(null);
  const [extensionMessage, setExtensionMessage] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const autoVisibleHelperKey = useRef<string | null>(null);
  const extensionToken = useRef<string | null>(null);
  const extensionTimeout = useRef<number | null>(null);
  const visibleHelperWindow = useRef<Window | null>(null);

  const pullKey = discogs.releaseUrl ?? (discogs.releaseId ? String(discogs.releaseId) : "");

  useEffect(() => {
    function receiveDiscogsStats(event: MessageEvent) {
      const allowedOrigin =
        event.origin === window.location.origin ||
        event.origin === "https://www.discogs.com" ||
        event.origin === "https://discogs.com";
      if (!allowedOrigin) return;

      const payload = event.data as {
        error?: string;
        message?: string;
        stats?: DiscogsSalesStats;
        token?: string;
        type?: string;
      };

      if (payload?.type !== "record-scanner-discogs-helper-result") return;
      if (!extensionToken.current || payload.token !== extensionToken.current) return;
      clearExtensionTimeout();

      if (payload.error) {
        setExtensionMessage(payload.error);
        return;
      }

      if (!payload.stats) {
        setExtensionMessage("Discogs helper did not return stats.");
        return;
      }

      onSalesStatsImport?.({
        ...payload.stats,
        importedAt: new Date().toISOString(),
        source: "browser_extension",
      });
      setExtensionMessage("Imported Discogs stats from the browser helper.");
    }

    window.addEventListener("message", receiveDiscogsStats);
    window.addEventListener("storage", receiveStoredDiscogsStats);
    return () => {
      window.removeEventListener("message", receiveDiscogsStats);
      window.removeEventListener("storage", receiveStoredDiscogsStats);
      clearExtensionTimeout();
    };

    function receiveStoredDiscogsStats(event: StorageEvent) {
      if (event.key !== "record-scanner-discogs-helper-result" || !event.newValue) return;
      const stored = JSON.parse(event.newValue) as { payload?: string; token?: string };
      if (!extensionToken.current || stored.token !== extensionToken.current || !stored.payload) return;

      const payload = JSON.parse(decodeURIComponent(atob(stored.payload))) as {
        error?: string;
        stats?: DiscogsSalesStats;
        token?: string;
        type?: string;
      };
      window.dispatchEvent(new MessageEvent("message", { data: payload, origin: window.location.origin }));
    }
  }, [onSalesStatsImport]);

  useEffect(() => {
    if (discogs.status !== "available" || discogs.salesStats || !pullKey) return;
    if (autoVisibleHelperKey.current === pullKey) return;

    autoVisibleHelperKey.current = pullKey;
    const timer = window.setTimeout(() => {
      openVisibleDiscogsHelper("auto");
    }, 500);

    return () => window.clearTimeout(timer);
  }, [discogs.salesStats, discogs.status, pullKey]);

  if (discogs.status !== "available") {
    return (
      <div className="discogs-summary unavailable">
        <h3>Discogs</h3>
        <p>{discogs.warnings[0] ?? "Discogs data unavailable."}</p>
      </div>
    );
  }

  return (
    <div className="discogs-summary">
      <h3>Discogs</h3>
      <p className="discogs-title">
        {discogs.releaseUrl ? (
          <a href={discogs.releaseUrl} rel="noreferrer" target="_blank">{discogs.matchedTitle}</a>
        ) : (
          discogs.matchedTitle
        )}
      </p>
      <dl className="discogs-grid">
        <div><dt>Current Lowest</dt><dd>{discogs.lowestPrice ? `${money(discogs.lowestPrice.value)} ${discogs.lowestPrice.currency}` : "n/a"}</dd></div>
        <div><dt>Sales Median</dt><dd>{discogs.salesStats?.medianPrice ? `${money(discogs.salesStats.medianPrice.value)} ${discogs.salesStats.medianPrice.currency}` : isPulling ? "Pulling..." : "Needs pull/import"}</dd></div>
        <div><dt>Last Sold</dt><dd>{discogs.salesStats?.lastSold ?? "n/a"}</dd></div>
        <div><dt>Low / High</dt><dd>{discogs.salesStats?.lowPrice ? money(discogs.salesStats.lowPrice.value) : "n/a"} / {discogs.salesStats?.highPrice ? money(discogs.salesStats.highPrice.value) : "n/a"}</dd></div>
        <div><dt>For sale</dt><dd>{discogs.numForSale ?? "n/a"}</dd></div>
        <div><dt>Have / Want</dt><dd>{discogs.have ?? "n/a"} / {discogs.want ?? "n/a"}</dd></div>
        <div><dt>Cat #</dt><dd>{discogs.catno ?? "n/a"}</dd></div>
        <div><dt>Match</dt><dd>{discogs.confidence}</dd></div>
      </dl>
      <div className="discogs-pull">
        <button disabled={isPulling || !onSalesStatsPull} type="button" onClick={() => pullSalesStats("manual")}>
          {isPulling ? "Pulling Discogs Data..." : "Pull Discogs Data"}
        </button>
        {discogs.salesStats ? (
          <span>Stats source: {statsSourceLabel(discogs.salesStats.source)}</span>
        ) : null}
        {pullMessage ? <p className="source-summary">{pullMessage}</p> : null}
      </div>
      <div className="discogs-pull">
        <button disabled={!discogs.releaseUrl} type="button" onClick={() => openVisibleDiscogsHelper("manual")}>
          Run Discogs Helper
        </button>
        {extensionMessage ? <p className="source-summary">{extensionMessage}</p> : null}
      </div>
      <div className="discogs-import">
        <label htmlFor="discogs-stats-text">Discogs sales stats import</label>
        <textarea
          id="discogs-stats-text"
          placeholder="Paste Discogs Statistics text or saved HTML/XML here."
          value={statsText}
          onChange={(event) => setStatsText(event.target.value)}
        />
        <div className="discogs-import-actions">
          <input
            type="file"
            accept=".html,.htm,.xml,.txt,text/html,text/xml,text/plain"
            onChange={(event) => importStatsFile(event.target.files?.[0])}
          />
          <button type="button" onClick={() => importStatsText(statsText)}>
            Import Stats
          </button>
        </div>
        {parseMessage ? <p className="source-summary">{parseMessage}</p> : null}
      </div>
      {discogs.warnings.length ? <p className="source-summary">{discogs.warnings[0]}</p> : null}
    </div>
  );

  async function importStatsFile(file: File | undefined) {
    if (!file) return;
    importStatsText(await file.text());
  }

  async function pullSalesStats(mode: "auto" | "manual") {
    if (!onSalesStatsPull || isPulling) return;

    setIsPulling(true);
    setPullMessage(mode === "auto" ? "Trying to pull Discogs sales stats automatically..." : null);

    try {
      await onSalesStatsPull(discogs);
      setPullMessage("Pulled Discogs sales stats for this release.");
    } catch (error) {
      setPullMessage(error instanceof Error ? error.message : "Discogs stats pull failed.");
    } finally {
      setIsPulling(false);
    }
  }

  function openVisibleDiscogsHelper(mode: "auto" | "manual") {
    if (!discogs.releaseUrl) return;

    const token = crypto.randomUUID();
    extensionToken.current = token;
    setExtensionMessage(
      mode === "auto"
        ? "Opening Discogs helper automatically..."
        : "Opening Discogs helper...",
    );

    const url = new URL(discogs.releaseUrl);
    const helperParams = {
      recordScanner: "1",
      recordScannerOrigin: window.location.origin,
      recordScannerToken: token,
    };
    for (const [key, value] of Object.entries(helperParams)) {
      url.searchParams.set(key, value);
    }
    url.hash = new URLSearchParams(helperParams).toString();
    visibleHelperWindow.current = window.open(url.toString(), "_blank", "popup,width=960,height=760");

    if (!visibleHelperWindow.current) {
      setExtensionMessage("Chrome blocked the Discogs helper popup. Click Run Discogs Helper to allow it.");
      return;
    }

    clearExtensionTimeout();
    extensionTimeout.current = window.setTimeout(() => {
      if (extensionToken.current !== token) return;
      setExtensionMessage("Discogs helper window opened, but no stats came back yet. Check whether Discogs finished loading.");
    }, 15_000);
  }

  function importStatsText(text: string) {
    const stats = parseDiscogsSalesStats(text);
    if (!stats) {
      setParseMessage("Could not find Last Sold / Low / Median / High in that text.");
      return;
    }

    onSalesStatsImport?.(stats);
    setParseMessage("Imported Discogs sales stats for this result.");
  }

  function clearExtensionTimeout() {
    if (extensionTimeout.current === null) return;
    window.clearTimeout(extensionTimeout.current);
    extensionTimeout.current = null;
  }
}

function money(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}

function statsSourceLabel(source: DiscogsSalesStats["source"]): string {
  if (source === "browser_extension") return "browser helper";
  if (source === "page_fetch") return "Discogs page";
  return "manual import";
}
