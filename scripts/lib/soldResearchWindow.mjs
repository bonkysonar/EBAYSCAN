const DAY = 86_400_000;

// A displayed 90-day total is evidence for that window. A three-year total plus
// a latest-sale date is not. Require the observed results header and filters,
// complete pagination, and distinct listing identities before using quantities.
export function verifiedWindowSales(rows, run, now = new Date()) {
  const window = run?.observedWindow;
  if (!window || run.complete !== true || run.condition !== "New" ||
      run.category !== "Vinyl Records" || !rows.length) return null;
  const start = Date.parse(window.startDate);
  const end = Date.parse(window.endDate);
  const captured = Date.parse(run.capturedAt);
  const duration = (end - start) / DAY;
  if (![30, 90, 365].includes(duration) || !Number.isFinite(captured) ||
      captured < end || captured - end > 1.5 * DAY ||
      Number(now) < captured - 300000 || Number(now) - captured > 7 * DAY) return null;
  try {
    const url = new URL(run.url);
    if (url.hostname !== "www.ebay.com" || url.pathname !== "/sh/research" ||
        url.searchParams.get("categoryId") !== "176985" ||
        url.searchParams.get("conditionId") !== "1000" ||
        url.searchParams.get("tabName") !== "SOLD") return null;
  } catch { return null; }
  const allRows = run.rows ?? [];
  const ids = allRows.map((row) => String(row.itemUrl ?? row.href ?? row.url ?? "")
    .match(/^https:\/\/(?:www\.)?ebay\.com\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?#]|$)/)?.[1]);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
  if (rows.some((row) => !Number.isInteger(row.totalSold) || row.totalSold <= 0 ||
      !row.dateLastSold || !Number.isFinite(Date.parse(row.dateLastSold)) || Date.parse(row.dateLastSold) < start || Date.parse(row.dateLastSold) > end)) return null;
  const units = rows.reduce((sum, row) => sum + row.totalSold, 0);
  return {
    sales30Days: duration === 30 ? units : null,
    sales90Days: duration === 90 ? units : null,
    sales365Days: duration === 365 ? units : null,
    observedWindow: {startDate: window.startDate, endDate: window.endDate},
  };
}

export function mergeResearchSoldEvidence(existing, research, capturedAt) {
  const recent = research.velocityStatus === "dated_single_unit_rows" ||
    research.velocityStatus === "verified_window_totals";
  const oldDated = existing?.velocityEvidence === "dated_transactions" ||
    existing?.velocityEvidence === "verified_window_totals" ||
    existing?.source === "local-own-sales-history";
  if (oldDated && !recent) return {
    ...existing,
    unitsSold1095Days: research.aggregatePeriodDays >= 1095
      ? research.aggregateUnitsSold : existing.unitsSold1095Days ?? null,
  };
  return {
    capturedAt: research.capturedAt || capturedAt,
    condition: "new_sealed",
    conservativeResalePrice: null,
    latestSaleDate: research.latestSoldDate ?? null,
    matchConfidence: research.matchConfidence ?? "unknown",
    source: "ebay-product-research",
    status: "validated",
    supportsMarketplaceSellerRepeatProof: false,
    transactionCount: research.velocityStatus === "dated_single_unit_rows" ? research.rows.length : null,
    unitsSold30Days: recent ? research.sales30Days : null,
    unitsSold90Days: recent ? research.sales90Days : null,
    unitsSold365Days: recent ? research.sales365Days : null,
    unitsSold1095Days: research.aggregatePeriodDays >= 1095 ? research.aggregateUnitsSold : null,
    observedWindow: research.observedWindow ?? null,
    velocityEvidence: research.velocityStatus === "verified_window_totals"
      ? "verified_window_totals" : recent ? "dated_transactions" : "aggregate_last_sale_only",
  };
}
