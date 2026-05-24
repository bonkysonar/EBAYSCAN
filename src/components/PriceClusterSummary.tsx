import { useEffect, useRef, useState } from "react";
import type { DiscogsMarketSnapshot, DiscogsSalesStats } from "../lib/ebay/types";
import type { PriceSummary } from "../lib/scoring/types";
import { parseDiscogsReleaseReference } from "../lib/discogs/releaseUrl";

type Props = {
  discogs?: DiscogsMarketSnapshot;
  ebayResearchKeywords?: string;
  ebayResearchUrl?: string;
  onDiscogsPressingAccept?: (pressing: {
    matchedTitle?: string;
    releaseId?: number;
    releaseUrl: string;
    salesStats?: DiscogsSalesStats;
  }) => void;
  onDiscogsSalesStatsImport?: (stats: DiscogsSalesStats) => void;
  onDiscogsSalesStatsPull?: (discogs: DiscogsMarketSnapshot) => Promise<DiscogsSalesStats>;
  summary: PriceSummary;
};

export function PriceClusterSummary({
  discogs,
  ebayResearchKeywords,
  ebayResearchUrl,
  onDiscogsPressingAccept,
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
          onPressingAccept={onDiscogsPressingAccept}
          onSalesStatsImport={onDiscogsSalesStatsImport}
          onSalesStatsPull={onDiscogsSalesStatsPull}
        />
      ) : null}
    </section>
  );
}

function DiscogsSummary({
  discogs,
  onPressingAccept,
  onSalesStatsImport,
  onSalesStatsPull,
}: {
  discogs: DiscogsMarketSnapshot;
  onPressingAccept?: (pressing: {
    matchedTitle?: string;
    releaseId?: number;
    releaseUrl: string;
    salesStats?: DiscogsSalesStats;
  }) => void;
  onSalesStatsImport?: (stats: DiscogsSalesStats) => void;
  onSalesStatsPull?: (discogs: DiscogsMarketSnapshot) => Promise<DiscogsSalesStats>;
}) {
  const [pullMessage, setPullMessage] = useState<string | null>(null);
  const [extensionMessage, setExtensionMessage] = useState<string | null>(null);
  const [isChoosingPressing, setIsChoosingPressing] = useState(false);
  const [isApplyingPressingUrl, setIsApplyingPressingUrl] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [pressingUrl, setPressingUrl] = useState("");
  const autoVisibleHelperKey = useRef<string | null>(null);
  const extensionToken = useRef<string | null>(null);
  const extensionMode = useRef<"helper" | "pressing-choice">("helper");
  const extensionTimeout = useRef<number | null>(null);
  const bridgeFallbackTimeout = useRef<number | null>(null);

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
        matchedTitle?: string;
        releaseId?: number;
        releaseUrl?: string;
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

      if (extensionMode.current === "pressing-choice" && payload.releaseUrl) {
        onPressingAccept?.({
          matchedTitle: payload.matchedTitle,
          releaseId: payload.releaseId,
          releaseUrl: payload.releaseUrl,
          salesStats: payload.stats,
        });
        setIsChoosingPressing(false);
        setExtensionMessage("Accepted the selected Discogs pressing.");
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
  }, [onPressingAccept, onSalesStatsImport]);

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
        <button disabled={!discogs.releaseUrl || !onPressingAccept} type="button" onClick={openPressingChooser}>
          Manually Choose Pressing
        </button>
        {isChoosingPressing ? (
          <button type="button" onClick={acceptChosenPressing}>
            Accept New Pressing
          </button>
        ) : null}
        {extensionMessage ? <p className="source-summary">{extensionMessage}</p> : null}
      </div>
      <div className="discogs-manual-pressing">
        <label>
          Discogs pressing URL
          <input
            placeholder="Paste Discogs /release/ URL"
            value={pressingUrl}
            onChange={(event) => setPressingUrl(event.target.value)}
          />
        </label>
        <button disabled={!pressingUrl.trim() || isApplyingPressingUrl || !onPressingAccept} type="button" onClick={applyPressingUrl}>
          {isApplyingPressingUrl ? "Applying..." : "Apply Pressing URL"}
        </button>
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
    extensionMode.current = "helper";
    setIsChoosingPressing(false);
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
    }, 900);

    if (mode === "manual") {
      openVisibleDiscogsHelper(token);
    }
  }

  function openVisibleDiscogsHelper(token: string) {
    if (!discogs.releaseUrl) return;

    const url = new URL(discogs.releaseUrl);
    url.hash = new URLSearchParams({
      recordScanner: "1",
      recordScannerOrigin: window.location.origin,
      recordScannerToken: token,
    }).toString();
    const visibleHelperWindow = window.open(url.toString(), "record-scanner-discogs-helper", "popup,width=960,height=760");

    if (!visibleHelperWindow) {
      setExtensionMessage("Chrome blocked the Discogs helper popup. Click Run Discogs Helper to allow it.");
      return;
    }

    visibleHelperWindow.focus();
    clearExtensionTimeout();
    extensionTimeout.current = window.setTimeout(() => {
      if (extensionToken.current !== token) return;
      setExtensionMessage("Discogs helper window opened, but no stats came back yet. Check whether Discogs finished loading.");
    }, 15_000);
  }

  function openPressingChooser() {
    if (!discogs.releaseUrl) return;

    const token = crypto.randomUUID();
    extensionToken.current = token;
    extensionMode.current = "pressing-choice";
    setIsChoosingPressing(true);
    setExtensionMessage("Opening Discogs. Navigate to the right pressing, return here, then click Accept New Pressing.");
    clearExtensionTimeout();
    clearBridgeFallbackTimeout();

    window.postMessage(
      {
        releaseUrl: discogs.releaseUrl,
        token,
        type: "record-scanner-discogs-helper-choose-request",
      },
      window.location.origin,
    );
  }

  function acceptChosenPressing() {
    if (!extensionToken.current) {
      setExtensionMessage("Open the Discogs chooser first.");
      return;
    }

    setExtensionMessage("Asking Discogs helper to read the selected pressing...");
    window.postMessage(
      {
        token: extensionToken.current,
        type: "record-scanner-discogs-helper-accept-current",
      },
      window.location.origin,
    );
  }

  async function applyPressingUrl() {
    if (!onPressingAccept) return;

    setIsApplyingPressingUrl(true);
    setExtensionMessage(null);

    try {
      const reference = parseDiscogsReleaseReference(pressingUrl);
      onPressingAccept({
        ...reference,
      });
      setPressingUrl("");
      setIsChoosingPressing(false);
      setExtensionMessage("Pressing applied. Trying to pull stats...");
      requestScannerInputRefocus();

      const { message, stats } = await fetchDiscogsStatsBestEffort(reference);
      if (stats) {
        onPressingAccept({
          ...reference,
          salesStats: stats,
        });
      }
      setExtensionMessage(message);
    } catch (error) {
      setExtensionMessage(error instanceof Error ? error.message : "Could not apply Discogs pressing URL.");
    } finally {
      setIsApplyingPressingUrl(false);
    }
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
    requestScannerInputRefocus();
  }
}

function requestScannerInputRefocus() {
  window.dispatchEvent(new CustomEvent("record-scanner-refocus-last-input"));
}

async function fetchDiscogsStatsBestEffort(reference: { releaseId?: number; releaseUrl: string }): Promise<{
  message: string;
  stats?: DiscogsSalesStats;
}> {
  try {
    const response = await fetch("/api/discogs/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        releaseId: reference.releaseId,
        releaseUrl: reference.releaseUrl,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      return {
        message: `Pressing applied. Stats still need helper/import: ${payload.error ?? "Discogs stats pull failed."}`,
      };
    }

    return {
      message: "Pressing applied and stats pulled.",
      stats: payload as DiscogsSalesStats,
    };
  } catch (error) {
    return {
      message: `Pressing applied. Stats still need helper/import: ${error instanceof Error ? error.message : "Discogs stats pull failed."}`,
    };
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
