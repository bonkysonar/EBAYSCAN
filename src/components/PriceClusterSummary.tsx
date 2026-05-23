import { useEffect, useRef, useState } from "react";
import type { DiscogsMarketSnapshot, DiscogsSalesStats } from "../lib/ebay/types";
import type { PriceSummary } from "../lib/scoring/types";

type Props = {
  discogs?: DiscogsMarketSnapshot;
  ebayResearchKeywords?: string;
  ebayResearchUrl?: string;
  onDiscogsSalesStatsImport?: (stats: DiscogsSalesStats) => void;
  onDiscogsSalesStatsPull?: (discogs: DiscogsMarketSnapshot) => Promise<DiscogsSalesStats>;
  summary: PriceSummary;
};

export function PriceClusterSummary({
  discogs,
  ebayResearchKeywords,
  ebayResearchUrl,
  onDiscogsSalesStatsImport,
  onDiscogsSalesStatsPull,
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
      </dl>
      {ebayResearchUrl ? (
        <a className="research-link" href={ebayResearchUrl} rel="noreferrer" target="_blank">
          Open eBay sold research
        </a>
      ) : null}
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
  const [pullMessage, setPullMessage] = useState<string | null>(null);
  const [extensionMessage, setExtensionMessage] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const autoVisibleHelperKey = useRef<string | null>(null);
  const extensionToken = useRef<string | null>(null);
  const extensionTimeout = useRef<number | null>(null);
  const bridgeFallbackTimeout = useRef<number | null>(null);
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

      if (payload?.type === "record-scanner-discogs-helper-status") {
        if (!extensionToken.current || payload.token !== extensionToken.current) return;
        clearBridgeFallbackTimeout();
        setExtensionMessage(payload.message ?? "Discogs helper bridge connected.");
        requestScannerInputRefocus();
        return;
      }

      if (payload?.type !== "record-scanner-discogs-helper-result") return;
      if (!extensionToken.current || payload.token !== extensionToken.current) return;
      clearExtensionTimeout();
      clearBridgeFallbackTimeout();

      if (payload.error) {
        setExtensionMessage(payload.error);
        requestScannerInputRefocus();
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
      requestScannerInputRefocus();
    }

    window.addEventListener("message", receiveDiscogsStats);
    return () => {
      window.removeEventListener("message", receiveDiscogsStats);
      clearExtensionTimeout();
      clearBridgeFallbackTimeout();
    };
  }, [onSalesStatsImport]);

  useEffect(() => {
    if (discogs.status !== "available" || discogs.salesStats || !pullKey) return;
    if (autoVisibleHelperKey.current === pullKey) return;

    autoVisibleHelperKey.current = pullKey;
    const timer = window.setTimeout(() => {
      openDiscogsHelper("auto");
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
        <button disabled={!discogs.releaseUrl} type="button" onClick={() => openDiscogsHelper("manual")}>
          Run Discogs Helper
        </button>
        {extensionMessage ? <p className="source-summary">{extensionMessage}</p> : null}
      </div>
      {discogs.warnings.length ? <p className="source-summary">{discogs.warnings[0]}</p> : null}
    </div>
  );

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

  function openDiscogsHelper(mode: "auto" | "manual") {
    if (!discogs.releaseUrl) return;

    const token = crypto.randomUUID();
    extensionToken.current = token;
    setExtensionMessage(
      mode === "auto"
        ? "Asking Discogs helper to run in the background..."
        : "Opening Discogs helper...",
    );
    clearExtensionTimeout();
    clearBridgeFallbackTimeout();
    requestScannerInputRefocus();

    window.postMessage(
      {
        releaseUrl: discogs.releaseUrl,
        token,
        type: "record-scanner-discogs-helper-request",
      },
      window.location.origin,
    );

    bridgeFallbackTimeout.current = window.setTimeout(() => {
      if (extensionToken.current !== token) return;
      if (mode === "auto") {
        setExtensionMessage("Discogs helper bridge did not answer automatically. Scanner input kept focused; click Run Discogs Helper if you need this one.");
        requestScannerInputRefocus();
        return;
      }

      openVisibleDiscogsHelper(token, "manual");
    }, 900);
  }

  function openVisibleDiscogsHelper(token: string, mode: "manual") {
    if (!discogs.releaseUrl) return;

    const url = new URL(discogs.releaseUrl);
    url.hash = new URLSearchParams({
      recordScanner: "1",
      recordScannerOrigin: window.location.origin,
      recordScannerToken: token,
    }).toString();
    visibleHelperWindow.current = window.open(url.toString(), "record-scanner-discogs-helper", "popup,width=960,height=760");

    if (!visibleHelperWindow.current) {
      setExtensionMessage("Chrome blocked the Discogs helper popup. Click Run Discogs Helper to allow it.");
      return;
    }

    clearExtensionTimeout();
    reclaimScannerFocus();
    window.setTimeout(reclaimScannerFocus, 100);
    window.setTimeout(reclaimScannerFocus, 350);
    window.setTimeout(reclaimScannerFocus, 1_200);
    window.setTimeout(reclaimScannerFocus, 2_500);
    extensionTimeout.current = window.setTimeout(() => {
      if (extensionToken.current !== token) return;
      setExtensionMessage("Discogs helper window opened, but no stats came back yet. Check whether Discogs finished loading.");
      reclaimScannerFocus();
    }, 15_000);
  }

  function clearExtensionTimeout() {
    if (extensionTimeout.current === null) return;
    window.clearTimeout(extensionTimeout.current);
    extensionTimeout.current = null;
  }

  function clearBridgeFallbackTimeout() {
    if (bridgeFallbackTimeout.current === null) return;
    window.clearTimeout(bridgeFallbackTimeout.current);
    bridgeFallbackTimeout.current = null;
  }

  function reclaimScannerFocus() {
    visibleHelperWindow.current?.blur();
    requestScannerInputRefocus();
  }
}

function requestScannerInputRefocus() {
  window.dispatchEvent(new CustomEvent("record-scanner-refocus-last-input"));
}

function money(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}

function statsSourceLabel(source: DiscogsSalesStats["source"]): string {
  if (source === "browser_extension") return "browser helper";
  if (source === "page_fetch") return "Discogs page";
  return "manual import";
}
