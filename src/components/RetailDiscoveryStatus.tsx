import type { ArbitrageImportPayload } from "../lib/arbitrage/types";
import { publicDiscoveryUrl } from "../../scripts/lib/webSaleDiscovery.mjs";

export function RetailDiscoveryStatus({ payload }: { payload: ArbitrageImportPayload | null }) {
  const audit = payload?.discoveryAudit;
  const report = payload?.sourceReports?.find(row => row.id === "vinyl-price-drop");
  const stats = report?.adapterStats as Record<string, unknown> | undefined;
  const searches = audit?.searches ?? [];
  return <details className="panel">
    <summary>Discovery beyond the retailer list</summary>
    <p>Coverage percentages describe configured retailers, not the whole market. Search results are leads, not confirmed sales.</p>
    <p>{stats?.homepageCardCount !== undefined
      ? `VinylPriceDrop homepage: ${stats.homepageCheckedCount}/${stats.homepageCardCount} cards checked; ${stats.homepageFailedCount} inaccessible. Retailer price, stock and resale evidence still require verification.`
      : "VinylPriceDrop homepage coverage has not been measured in this publication."}</p>
    <p>Open-web discovery: {searches.length ? `${searches.length} captured searches; ${audit?.newRetailerLeads?.length ?? 0} leads outside the configured retailer list.` : "not captured for this publication."}</p>
    {searches.map((search, i) => <p key={`${search.url}-${i}`}>{search.query} · {new Date(search.capturedAt).toLocaleString()} · {search.status === "access_failed" ? "Access failed" : `${search.resultCount} observed links`}</p>)}
    {audit?.newRetailerLeads?.length ? <><h3>New-source leads — verification pending</h3><ul>{audit.newRetailerLeads.slice(0, 10).filter(lead => publicDiscoveryUrl(lead.url)).map(lead => <li key={lead.url}><a href={lead.url} target="_blank" rel="noreferrer">{lead.title}</a> · Not a buy recommendation</li>)}</ul></> : null}
  </details>;
}
