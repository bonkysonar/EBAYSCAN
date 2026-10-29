import { useEffect, useState } from "react";
import type { RetailDealRadarPayload } from "../lib/arbitrage/dealRadar";
import { publicDiscoveryUrl } from "../../scripts/lib/webSaleDiscovery.mjs";

const REFRESH_MS = 5 * 60_000;

export function RetailDealRadar() {
  const [payload, setPayload] = useState<RetailDealRadarPayload | null>(null);
  const [error, setError] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      const activeController = controller;
      const timeout = setTimeout(() => activeController.abort(), 12_000);
      try {
        const response = await fetch("/api/arbitrage/deal-radar", { cache: "no-store", signal: activeController.signal });
        if (!response.ok) throw new Error("Unavailable");
        const result = await response.json() as RetailDealRadarPayload;
        if (result.version !== 1 || !["available", "partial", "unavailable"].includes(result.status) || !Array.isArray(result.items) || !Array.isArray(result.sources) || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error("Invalid feed response");
        if (!disposed && controller === activeController) { setPayload(result); setError(false); setClock(Date.now()); }
      } catch {
        if (!disposed && controller === activeController) { setError(true); setPayload(null); }
      } finally { clearTimeout(timeout); }
    };
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const tick = setInterval(() => setClock(Date.now()), 60_000);
    const focus = () => void load();
    const visibility = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; controller?.abort(); clearInterval(refresh); clearInterval(tick); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return <RetailDealRadarView payload={payload} error={error} now={clock} />;
}

export function RetailDealRadarView({ payload, error = false, now = Date.now() }: { payload: RetailDealRadarPayload | null; error?: boolean; now?: number }) {
  const stale = payload !== null && Date.parse(payload.expiresAt) <= now;
  const unavailable = error || stale || payload?.status === "unavailable";
  const items = unavailable ? [] : (payload?.items ?? []).filter(item => publicDiscoveryUrl(item.discussionUrl) && Number.isFinite(item.advertisedPrice) && item.advertisedPrice > 0 && Number.isFinite(Date.parse(item.publishedAt)) && now - Date.parse(item.publishedAt) <= 48 * 3600000 && Date.parse(item.publishedAt) <= now + 300000);
  return <section className="panel" aria-label="Fresh deal leads">
    <h2>Fresh deal leads</h2>
    <p>Recent vinyl offers, newest first. Advertised deal · needs retailer and resale checks.</p>
    {unavailable ? <p role="status">{stale ? "Deal feed refresh is overdue. Older leads are hidden until it reconnects." : "Live deal feeds are unavailable. Current deal coverage is unknown."}</p> :
      !payload ? <p role="status">Checking live deal feeds…</p> : <>
        <p>{payload.status === "partial" ? "Some feeds could not be read. " : ""}Checked {new Date(payload.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · Refreshes every five minutes.</p>
        {items.length ? <ul>{items.slice(0, 12).map(item => <li key={item.id}>
          <a href={item.discussionUrl} target="_blank" rel="noreferrer">{item.artist === "Unknown Artist" ? item.title : `${item.artist} — ${item.title}`}</a>
          {" · "}<strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.advertisedPrice)} advertised</strong>
          {" · "}{item.publisher} · Posted {new Date(item.publishedAt).toLocaleDateString()}
          {item.retailerUrl && publicDiscoveryUrl(item.retailerUrl) ? <> · <a href={item.retailerUrl} target="_blank" rel="noreferrer">Check retailer</a></> : null}
        </li>)}</ul> : <p>No qualifying recent vinyl leads in the checked feeds. This does not establish that no deals are available.</p>}
      </>}
    <p>Confirm the current price, edition, stock, shipping and resale evidence before buying. These leads update independently of the researched recommendations below.</p>
  </section>;
}
