import type { DiscogsMarketSnapshot } from "../lib/ebay/types";
import type { PriceSummary } from "../lib/scoring/types";

type Props = {
  discogs?: DiscogsMarketSnapshot;
  ebayResearchKeywords?: string;
  ebayResearchUrl?: string;
  sourceSummary?: string;
  summary: PriceSummary;
};

export function PriceClusterSummary({ discogs, ebayResearchKeywords, ebayResearchUrl, sourceSummary, summary }: Props) {
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
      {discogs ? <DiscogsSummary discogs={discogs} /> : null}
    </section>
  );
}

function DiscogsSummary({ discogs }: { discogs: DiscogsMarketSnapshot }) {
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
        <div><dt>Lowest</dt><dd>{discogs.lowestPrice ? `${money(discogs.lowestPrice.value)} ${discogs.lowestPrice.currency}` : "n/a"}</dd></div>
        <div><dt>Median</dt><dd>{discogs.medianPrice ? `${money(discogs.medianPrice.value)} ${discogs.medianPrice.currency}` : "Unavailable"}</dd></div>
        <div><dt>For sale</dt><dd>{discogs.numForSale ?? "n/a"}</dd></div>
        <div><dt>Have / Want</dt><dd>{discogs.have ?? "n/a"} / {discogs.want ?? "n/a"}</dd></div>
        <div><dt>Cat #</dt><dd>{discogs.catno ?? "n/a"}</dd></div>
        <div><dt>Match</dt><dd>{discogs.confidence}</dd></div>
      </dl>
      {discogs.warnings.length ? <p className="source-summary">{discogs.warnings[0]}</p> : null}
    </div>
  );
}

function money(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}
