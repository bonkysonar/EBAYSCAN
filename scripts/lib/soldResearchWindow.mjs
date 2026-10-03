import { observedSoldRowIdentities } from "./observedSoldRowIdentity.mjs";
const DAY = 86_400_000;

// Seller Hub can display an applied filter without retaining its URL parameter.
// Explicit visible-control observations may fill missing parameters, never
// override a conflicting URL filter (or an Active result tab).
export function verifiedResearchFilters(run, url) {
  return [["categoryId", "176985"], ["conditionId", "1000"], ["tabName", "SOLD"]]
    .every(([key, expected]) => (url.searchParams.get(key) ?? run.observedFilters?.[key]) === expected);
}

// A displayed 90-day total is evidence for that window. A three-year total plus
// a latest-sale date is not. Require the observed results header and filters,
// complete pagination, and distinct listing identities before using quantities.
export function verifiedWindowSales(rows, run, now = new Date()) {
  const verified = verifiedResearchWindow(run, now);
  if (!verified || !rows.length) return null;
  const { start, end, duration, observedWindow } = verified;
  const captureIdentities = observedSoldRowIdentities(run, verified);
  const identities = observedSoldRowIdentities({ ...run, rows }, verified);
  // An unrelated edition with a missing link cannot invalidate linked exact
  // matches. Every row actually counted still needs its own observed identity.
  // Keep a lower-bound label whenever the complete table includes unknown rows.
  if (identities.missing || identities.duplicate || captureIdentities.duplicate) return null;
  if (rows.some((row) => !Number.isInteger(row.totalSold) || row.totalSold <= 0 ||
      !row.dateLastSold || !Number.isFinite(Date.parse(row.dateLastSold)) || Date.parse(row.dateLastSold) < start || Date.parse(row.dateLastSold) > end)) return null;
  const units = rows.reduce((sum, row) => sum + row.totalSold, 0);
  return {
    sales30Days: duration === 30 ? units : null,
    sales90Days: duration === 90 ? units : null,
    sales365Days: duration === 365 ? units : null,
    observedWindow,
    windowCountIsLowerBound: captureIdentities.missing,
  };
}

/** Shared metadata validation also works for an explicitly completed empty search. */
export function verifiedResearchWindow(run, now = new Date(), allowedPeriods = [30, 90, 365]) {
  const window = run?.observedWindow;
  if (!window || run.complete !== true || run.completePagination === false || run.condition !== "New" ||
      run.category !== "Vinyl Records") return null;
  const start = calendarDay(window.startDate);
  const end = calendarDay(window.endDate);
  const captured = Date.parse(run.capturedAt);
  const duration = (end - start) / DAY;
  if (!allowedPeriods.includes(duration) || !Number.isFinite(captured) ||
      Number(now) < captured - 300000 || Number(now) - captured > 7 * DAY) return null;
  try {
    const url = new URL(run.url);
    if (url.protocol !== "https:" || url.hostname !== "www.ebay.com" || url.pathname !== "/sh/research" ||
        !verifiedResearchFilters(run, url)) return null;
    // Seller Hub reports calendar dates, not instants at midnight UTC. A morning
    // Pacific capture of yesterday's results can be >36 hours after that UTC
    // midnight. Compare dates in the research timezone, including DST changes.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: url.searchParams.get("tz") || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(captured));
    const date = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const capturedDay = calendarDay(`${date.year}-${date.month}-${date.day}`);
    const endAgeDays = (capturedDay - end) / DAY;
    if (endAgeDays < 0 || endAgeDays > 1) return null;
  } catch { return null; }
  return {
    start, end, duration,
    observedWindow: {startDate: window.startDate, endDate: window.endDate},
  };
}

function calendarDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed : NaN;
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
    observedWindows: research.observedWindows ?? null,
    windowCountIsLowerBound: research.windowCountIsLowerBound === true,
    velocityEvidence: research.velocityStatus === "verified_window_totals"
      ? "verified_window_totals" : recent ? "dated_transactions" : "aggregate_last_sale_only",
  };
}
