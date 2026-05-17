import type { PriceSummary } from "../lib/scoring/types";

type Props = {
  sourceSummary?: string;
  summary: PriceSummary;
};

export function PriceClusterSummary({ sourceSummary, summary }: Props) {
  return (
    <section className="panel summary-panel">
      <h2>Price Cluster</h2>
      <dl className="summary-grid">
        <div><dt>Lowest</dt><dd>{money(summary.lowestTotalPrice)}</dd></div>
        <div><dt>Median</dt><dd>{money(summary.medianTotalPrice)}</dd></div>
        <div><dt>Trimmed median</dt><dd>{money(summary.trimmedMedianTotalPrice)}</dd></div>
        <div><dt>Results</dt><dd>{summary.resultCount}</dd></div>
        <div><dt>Same cluster</dt><dd>{summary.sameTitleClusterCount}</dd></div>
        <div><dt>High outliers</dt><dd>{summary.highOutlierCount}</dd></div>
        <div><dt>Spread</dt><dd>{money(summary.priceSpread)}</dd></div>
      </dl>
      {sourceSummary ? <p className="source-summary">{sourceSummary}</p> : null}
    </section>
  );
}

function money(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}
