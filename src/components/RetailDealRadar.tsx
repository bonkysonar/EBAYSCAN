import { useRefreshingFeed } from "../lib/arbitrage/useRefreshingFeed";
import type { RetailCampaignRadarPayload, RetailDealRadarPayload, RetailMarkdownPayload } from "../lib/arbitrage/dealRadar";
import { publicDiscoveryUrl } from "../../scripts/lib/webSaleDiscovery.mjs";

function parseRadar<T extends RetailDealRadarPayload | RetailCampaignRadarPayload | RetailMarkdownPayload>(value: unknown): T {
  const result = value as T;
  if (result?.version !== 1 || !["available", "partial", "unavailable"].includes(result.status) ||
    !Array.isArray(result.items) || !Array.isArray(result.sources) || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error("Invalid feed response");
  return result;
}

export function useRetailRadar<T extends RetailDealRadarPayload | RetailCampaignRadarPayload | RetailMarkdownPayload>(url: string) {
  return useRefreshingFeed<T>(url, parseRadar);
}

export function RetailDealRadar() {
  return <RetailDealRadarView {...useRetailRadar<RetailDealRadarPayload>("/api/arbitrage/deal-radar")} />;
}

export function RetailCampaignRadar() {
  const { payload, error, now } = useRetailRadar<RetailCampaignRadarPayload>("/api/arbitrage/deal-radar?scope=campaigns");
  const unavailable = error || (payload && (payload.evidenceScope !== "retailer_advertisements" ||
    payload.status === "unavailable" || Date.parse(payload.expiresAt) <= now));
  return <section className="panel" aria-label="Live retailer sales">
    <h2>Live retailer sales</h2>
    {unavailable ? <p role="status">Current retailer announcements are unavailable.</p> :
      !payload ? <p role="status">Checking retailer announcements…</p> : <>
        <p>Checked {payload.sources.filter(source => source.status === "available").length} of {payload.sources.length} retailer homepages at {new Date(payload.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Individual pressing, stock and checkout terms still need verification.</p>
        {payload.items.length ? <ul>{payload.items.filter(item => publicDiscoveryUrl(item.url)).map(item =>
          <li key={item.url}><strong>{item.retailer}</strong> · <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a></li>
        )}</ul> : <p>No linked percentage offers appeared on the checked homepages.</p>}
      </>}
  </section>;
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
