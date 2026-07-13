import { useEffect, useMemo, useState } from "react";
import type { ArbitrageFind, ArbitrageImportPayload } from "../lib/arbitrage/types";
import { readJsonResponse } from "../lib/http/jsonResponse";

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
type SourceReport = {
  candidateCount: number;
  error?: string;
  id: string;
  name: string;
  pageErrors?: Array<{ failureKind?: string; requestedUrl: string }>;
  resolvedUrls?: string[];
  saleEventCount: number;
  status: "candidates" | "empty" | "error" | "sale_signals" | string;
  url: string;
};
type PayloadWithReports = ArbitrageImportPayload & { sourceReports?: SourceReport[] };

export function SiteWideSales() {
  const [sales, setSales] = useState<ArbitrageFind[]>([]);
  const [sourceReports, setSourceReports] = useState<SourceReport[]>([]);
  const [latestMessage, setLatestMessage] = useState<string | null>(null);
  const [isLoadingLatest, setIsLoadingLatest] = useState(false);
  const visibleSales = useMemo(() => activeSiteSales(sales), [sales]);
  const stats = summarizeSales(visibleSales);

  useEffect(() => {
    void loadLatestSales();
  }, []);

  async function loadLatestSales() {
    setIsLoadingLatest(true);

    try {
      const response = await fetch(`/api/arbitrage/latest?ts=${Date.now()}`, { cache: "no-store" });
      const payload = await readJsonResponse<LatestFindsErrorResponse | LatestFindsResponse>(response, "Latest sales endpoint");
      if ("error" in payload) throw new Error(payload.error);
      if (!response.ok) throw new Error("Latest sale load failed.");

      if (payload.status === "empty") {
        setLatestMessage(payload.message);
        return;
      }

      const latestPayload = payload.payload as PayloadWithReports;
      const latestSales = mergeSales([], latestPayload.saleEvents?.length ? latestPayload.saleEvents : latestPayload.finds);
      setSales(latestSales);
      setSourceReports(latestPayload.sourceReports ?? []);
      setLatestMessage(`Loaded ${latestSales.length} active site-wide sales from ${payload.fileName}.`);
    } catch (caught) {
      setLatestMessage(caught instanceof Error ? caught.message : "Latest sale load failed.");
    } finally {
      setIsLoadingLatest(false);
    }
  }

  return (
    <section className="site-sales-page">
      <div className="seller-hero panel compact-seller-hero">
        <div>
          <h2>Site-wide Sales</h2>
          <p>Retailer-wide vinyl sales plus clearly labeled discovery leads. No individual albums or per-record eBay checks.</p>
        </div>
        <div className="seller-actions">
          <button type="button" onClick={loadLatestSales} disabled={isLoadingLatest}>
            {isLoadingLatest ? "Loading..." : "Refresh Latest"}
          </button>
        </div>
      </div>

      {latestMessage ? <div className="warning-box">{latestMessage}</div> : null}

      <div className="seller-stats compact-seller-stats">
        <Stat label="Retailer Sales" value={stats.retailerSales} />
        <Stat label="Discovery Leads" value={stats.discoveryLeads} />
        <Stat label="30%+ Off" value={stats.percentSales} />
        <Stat label="BOGO / Volume" value={stats.volumeSales} />
        <Stat label="New / Changed" value={stats.freshSales} />
        <Stat label="Sale Sources" value={stats.sources} />
        <Stat label="Checked" value={sourceReports.length} />
        <Stat label="Blocked" value={sourceReports.filter((report) => report.status === "error").length} />
      </div>

      {visibleSales.length === 0 ? (
        <section className="empty-state">
          <h2>No active site-wide sales</h2>
          <p>Run the sale-radar scan or refresh once a latest sale JSON is available.</p>
        </section>
      ) : (
        <section className="site-sale-grid">
          {visibleSales.map((sale) => (
            <article className="panel site-sale-card" key={sale.id}>
              <div className="site-sale-card-header">
                <div>
                  <h3>{sale.sourceName}</h3>
                  <span>
                    {sale.saleVerification === "discovery-lead" ? "unverified lead" : sale.saleScope ?? "sale"}
                    {sale.saleStatus ? ` · ${sale.saleStatus}` : ""}
                  </span>
                </div>
                <strong>{sale.saleDiscountPercent ? `${sale.saleDiscountPercent}%+` : saleSignalLabel(sale)}</strong>
              </div>
              <p>{sale.saleSignal ?? sale.sourceListingTitle ?? sale.title}</p>
              <div className="site-sale-card-actions">
                <a href={sale.sourceUrl} target="_blank" rel="noreferrer">
                  {sale.saleVerification === "discovery-lead" ? "Open lead" : "Open sale"}
                </a>
                <small>{sale.firstSeenAt ? `Since ${formatDate(sale.firstSeenAt)}` : formatDate(sale.capturedAt)}</small>
              </div>
            </article>
          ))}
        </section>
      )}
      {sourceReports.length ? (
        <section className="panel site-sale-coverage">
          <div className="section-heading">
            <h2>Source Coverage</h2>
            <span>
              {sourceReports.filter((report) => report.status !== "error").length} checked, {sourceReports.filter((report) => report.status === "partial").length} recovered, {sourceReports.filter((report) => report.status === "error").length} blocked
            </span>
          </div>
          <div className="site-sale-coverage-list">
            {sourceReports.map((report) => (
              <a
                className={report.status === "error" ? "coverage-error" : report.status === "partial" ? "coverage-partial" : ""}
                href={report.resolvedUrls?.[0] ?? report.url}
                key={report.id}
                rel="noreferrer"
                target="_blank"
              >
                <span>{report.name}</span>
                <small>{coverageLabel(report)}</small>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function activeSiteSales(finds: ArbitrageFind[]): ArbitrageFind[] {
  return dedupeSalesBySource(finds.filter((find) => find.opportunityType === "sitewide_sale" && !find.dismissedAt))
    .sort((left, right) => saleFreshnessPriority(right) - saleFreshnessPriority(left) || new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime());
}

function dedupeSalesBySource(sales: ArbitrageFind[]): ArbitrageFind[] {
  const bySource = new Map<string, ArbitrageFind>();
  for (const sale of sales) {
    const current = bySource.get(sale.sourceId);
    if (!current || salePriority(sale) > salePriority(current)) {
      bySource.set(sale.sourceId, sale);
    }
  }
  return [...bySource.values()];
}

function salePriority(sale: ArbitrageFind): number {
  const scopeScore = sale.saleScope === "sitewide" ? 5 : sale.saleScope === "vinyl-wide" ? 4 : sale.saleScope === "clearance" ? 3 : 2;
  const discountScore = sale.saleDiscountPercent ?? (/\b(?:bogo|buy\s+one|buy\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(sale.saleSignal ?? "") ? 45 : 0);
  return discountScore * 10 + scopeScore;
}

function mergeSales(current: ArbitrageFind[], incoming: ArbitrageFind[]): ArbitrageFind[] {
  const byId = new Map(current.map((sale) => [sale.id, sale]));
  for (const sale of incoming) {
    byId.set(sale.id, { ...byId.get(sale.id), ...sale });
  }
  return activeSiteSales([...byId.values()]);
}

function summarizeSales(sales: ArbitrageFind[]) {
  return {
    discoveryLeads: sales.filter((sale) => sale.saleVerification === "discovery-lead").length,
    freshSales: sales.filter((sale) => sale.saleStatus === "new" || sale.saleStatus === "changed").length,
    percentSales: sales.filter((sale) => (sale.saleDiscountPercent ?? 0) >= 30).length,
    retailerSales: sales.filter((sale) => sale.saleVerification !== "discovery-lead").length,
    sources: new Set(sales.map((sale) => sale.sourceId)).size,
    volumeSales: sales.filter((sale) => /\b(?:bogo|buy\s+one|buy\s+1|buy\s+more|2\s+for\s+1|two\s+for\s+one)\b/i.test(sale.saleSignal ?? "")).length,
  };
}

function coverageLabel(report: SourceReport): string {
  if (report.status === "error") return report.error ?? "blocked";
  const recovery = report.pageErrors?.some((error) => error.failureKind === "not_found") ? " · stale URL bypassed" : "";
  if (report.saleEventCount > 0) return `${report.saleEventCount} sale signal${report.saleEventCount === 1 ? "" : "s"}${recovery}`;
  if (report.candidateCount > 0) return `${report.candidateCount} products${recovery}`;
  return `checked${recovery}`;
}

function saleFreshnessPriority(sale: ArbitrageFind): number {
  if (sale.saleStatus === "new") return 3;
  if (sale.saleStatus === "changed") return 2;
  return 1;
}

function saleSignalLabel(sale: ArbitrageFind): string {
  if (/\b(?:bogo|buy\s+one|buy\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(sale.saleSignal ?? "")) return "BOGO";
  if (/\b(?:code|coupon|promo)\b/i.test(sale.saleSignal ?? "")) return "Code";
  return "Sale";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="seller-stat panel">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
