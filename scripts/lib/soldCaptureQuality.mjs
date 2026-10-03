import { parseProductResearchRow } from "./productResearchCuration.mjs";
import { verifiedResearchWindow, verifiedResearchFilters } from "./soldResearchWindow.mjs";
import { observedSoldRowIdentities } from "./observedSoldRowIdentity.mjs";

export const researchQueryKey = (value) => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
export const CAPTURE_REPAIRS = {
  capture_failed: "Retry the search and save the displayed result or explicit no-results state.",
  capture_stale: "Refresh this search; the saved capture is more than seven days old.",
  capture_time_invalid: "Save the actual capture timestamp.",
  research_url_invalid: "Save the visible Seller Hub Product Research URL.",
  query_mismatch: "Save the artist-and-album query shown in the search field and URL.",
  filters_unverified: "Select and confirm Sold, New, and Vinyl Records.",
  pagination_incomplete: "Finish every result page, then mark pagination complete.",
  rows_invalid: "Capture the complete sold table with prices, quantities, dates, and listing links.",
  window_unverified: "Save the actual displayed start/end dates and research timezone.",
  listing_identity_missing: "Capture each listing link. For older annual rows with no visible link, explicitly record that absence and all eight displayed cells.",
  duplicate_listings: "Remove pagination overlap; each listing must appear once.",
  row_date_outside_window: "Check that the saved table belongs to the displayed date window.",
};

/** Report collection defects separately from edition matching and profitability. */
export function assessSoldCapture(page = {}, now = new Date()) {
  const issues = [];
  const add = (code) => { if (!issues.includes(code)) issues.push(code); };
  const captured = Date.parse(page.capturedAt), age = Number(now) - captured;
  if (!Number.isFinite(captured) || age < -300000) add("capture_time_invalid");
  else if (age > 7 * 86400000) add("capture_stale");
  if (page.error || page.failureReason || ["failed", "blocked", "unavailable"].includes(page.status)) add("capture_failed");
  let url;
  try {
    url = new URL(page.url);
    if (url.protocol !== "https:" || url.hostname !== "www.ebay.com" || url.pathname !== "/sh/research" || url.username || url.password || url.port) add("research_url_invalid");
    if (!researchQueryKey(page.query) || researchQueryKey(url.searchParams.get("keywords")) !== researchQueryKey(page.query)) add("query_mismatch");
    if (!verifiedResearchFilters(page, url)) add("filters_unverified");
  } catch { add("research_url_invalid"); }
  if (page.condition !== "New" || page.category !== "Vinyl Records") add("filters_unverified");
  if (page.complete !== true || page.completePagination === false) add("pagination_incomplete");
  if (!Array.isArray(page.rows) || page.rows.length > 10000) add("rows_invalid");
  const importable = issues.length === 0;
  const window = verifiedResearchWindow(page, now, [30, 90, 365, 1095]);
  if (!window) add("window_unverified");
  const rows = Array.isArray(page.rows) ? page.rows.map(parseProductResearchRow) : [];
  const invalidRows = rows.filter(row => !row.title || !(row.avgSoldPrice > 0) || !Number.isInteger(row.totalSold) || row.totalSold <= 0 || !Number.isFinite(Date.parse(row.dateLastSold)));
  const malformedVisibleRows = invalidRows.filter(row => !/listing has been removed for a policy violation/i.test(row.title ?? ''));
  const identities = observedSoldRowIdentities(page, window);
  if (identities.missing) add("listing_identity_missing");
  if (identities.duplicate) add("duplicate_listings");
  if (invalidRows.length) add("rows_invalid");
  if (window && rows.some(row => Date.parse(row.dateLastSold) < window.start || Date.parse(row.dateLastSold) > window.end)) add("row_date_outside_window");
  return {
    version: 1, importable, status: issues.length ? "repair" : "complete",
    // The search can be fully observed even when eBay redacts a listing.
    // This is completion of collection, never validation of the redacted sale.
    searchComplete: importable && Boolean(window) && !identities.duplicate && !malformedVisibleRows.length && !issues.includes('row_date_outside_window'),
    periodDays: window?.duration ?? (Number(page.periodDays ?? url?.searchParams.get("dayRange")) || null),
    windowVerified: issues.length === 0, rowCount: rows.length,
    reasonCodes: issues, repairs: issues.map(code => CAPTURE_REPAIRS[code]),
  };
}

/** A failed attempt must not erase a still-usable capture of the same search. */
export function mergeSoldCaptures(previous = [], incoming = [], now = new Date()) {
  const pages = new Map();
  for (const page of [...previous, ...incoming]) {
    const quality = assessSoldCapture(page, now);
    const collectionState = quality.searchComplete ? "collected" : "unfinished";
    const key = `${researchQueryKey(page.query)}:${page.url}:${collectionState}`;
    const old = pages.get(key);
    if (!old || Date.parse(page.capturedAt) >= Date.parse(old.capturedAt)) pages.set(key, { ...page, captureAssessment: quality });
  }
  return [...pages.values()];
}
