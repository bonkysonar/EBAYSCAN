import { describe, expect, it } from "vitest";
import { buildPersistentResearchQueue } from "../../scripts/lib/persistentResearchQueue.mjs";
import { assessSoldCapture, mergeSoldCaptures } from "../../scripts/lib/soldCaptureQuality.mjs";
import { createCapturedSoldIndex } from "../../scripts/lib/capturedSoldIndex.mjs";
import { curateResearchForFind } from "../../scripts/lib/productResearchCuration.mjs";
import { mergeResearchSoldEvidence } from "../../scripts/lib/soldResearchWindow.mjs";
import { isHighSignalProductFind } from "../../scripts/lib/candidatePipeline.mjs";

const now = new Date("2026-10-01T14:00:00Z");
const find = { id: "record-one", artist: "Example Artist", title: "Actual Album", sourceListingTitle: "Example Artist Actual Album LP", purchasePrice: 10, sourceCurrency: "USD", condition: "new/sealed", sourceId: "retailer-one", sourceUrl: "https://retailer.example/products/album", physicalFormatConfirmed: true, identityStatus: "resolved", capturedAt: now.toISOString(), discoveryLane: "exploration" };
const row = { title: "Example Artist Actual Album New Vinyl LP", avgSoldPrice: 40, avgShipping: 0, totalSold: 9, dateLastSold: "2026-09-24", itemUrl: "https://www.ebay.com/itm/123456789012" };
const page = { query: "Example Artist Actual Album", url: "https://www.ebay.com/sh/research?keywords=Example+Artist+Actual+Album&conditionId=1000&categoryId=176985&tabName=SOLD&dayRange=90&tz=America%2FLos_Angeles", capturedAt: "2026-10-01T13:00:00Z", periodDays: 90, condition: "New", category: "Vinyl Records", complete: true, observedWindow: { startDate: "2026-07-02", endDate: "2026-09-30" }, rows: [row] };
const captures = { captureMethod: "visible_browser", pages: [page] };
const draft = { phase: "scan", runId: "scan-one", researchCandidates: [find] };

describe("persistent sold research", () => {
  it("reuses one capture across fresh run IDs and retailer offers without repeating the search", () => {
    const first = buildPersistentResearchQueue(draft, { captures, now });
    const second = buildPersistentResearchQueue({ ...draft, runId: "scan-two", researchCandidates: [{ ...find, id: "new-id" }, { ...find, id: "another-shop", sourceId: "retailer-two" }] }, { captures, state: first.state, now });
    expect(second.plan.summary).toMatchObject({ offers: 2, distinctQueries: 1, reused: 1, scheduled: 0 });
    expect(second.checkpoint.entries.map((entry: any) => entry.findId)).toEqual(["new-id", "another-shop"]);
    expect(second.plan.completed[0].targets.every((target: any) => target.evidence.units90Days === 9)).toBe(true);
    expect(Object.values(second.state.entries)[0]).toMatchObject({ attemptCount: 1 });
  });
  it("keeps unfinished identity across scans and groups duplicate query work", () => {
    const first = buildPersistentResearchQueue(draft, { now });
    const later = new Date("2026-10-02T14:00:00Z");
    const second = buildPersistentResearchQueue({ ...draft, runId: "scan-two", researchCandidates: [{ ...find, id: "changed" }, { ...find, id: "other", sourceId: "other" }] }, { state: first.state, now: later });
    expect(second.plan.entries).toHaveLength(1);
    expect(second.plan.entries[0]).toMatchObject({ findIds: ["changed", "other"], firstSeenAt: now.toISOString(), status: "pending" });
    const serialized = JSON.stringify(second.state);
    for (const privateValue of [find.title, find.artist, find.sourceUrl, row.itemUrl, "40", "query", "rows"]) expect(serialized).not.toContain(`"${privateValue}"`);
    expect(Object.keys(second.state.entries)[0]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("resumes a complete run checkpoint even without the shared capture file", () => {
    const checkpoint = { runId: draft.runId, entries: [{ findId: find.id, runs: [page] }] };
    const result = buildPersistentResearchQueue(draft, { checkpoint, now });
    expect(result.plan.summary).toMatchObject({ reused: 1, scheduled: 0 });
  });
  it("shows specific repair work, never counts failed/partial captures as completed evidence", () => {
    const broken = { ...page, complete: false, rows: [] };
    const result = buildPersistentResearchQueue(draft, { captures: { ...captures, pages: [broken] }, now });
    expect(result.plan.summary).toMatchObject({ reused: 0, repair: 1, scheduled: 1 });
    expect(result.plan.entries[0].reasonCodes).toContain("pagination_incomplete");
    expect(result.checkpoint.entries).toHaveLength(0);
  });
  it("paces repeated access failures while leaving them unresolved", () => {
    const failed = { ...page, capturedAt: now.toISOString(), error: "access denied", complete: false, rows: [] };
    const result = buildPersistentResearchQueue(draft, { captures: { ...captures, pages: [failed] }, now });
    expect(result.plan.summary).toMatchObject({ reused: 0, repair: 1, retryLater: 1, scheduled: 0 });
    expect(result.plan.retryLater[0].retryAfter).toBe("2026-10-01T14:10:00.000Z");
  });
  it("refreshes stale captures without changing their timestamps or giving them sold counts", () => {
    const result = buildPersistentResearchQueue(draft, { captures, now: new Date("2026-10-10T14:00:00Z") });
    expect(result.plan.summary).toMatchObject({ reused: 0, refresh: 1, scheduled: 1 });
    expect(result.checkpoint.entries).toHaveLength(0);
    expect(page.capturedAt).toBe("2026-10-01T13:00:00Z");
  });
  it("requests annual evidence only for a thin recent sample with sufficient estimated margin", () => {
    const thin = { ...page, rows: [{ ...row, totalSold: 1, avgSoldPrice: 65 }] };
    const result = buildPersistentResearchQueue(draft, { captures: { ...captures, pages: [thin] }, now });
    expect(result.plan.summary).toMatchObject({ tasks: 2, reused: 1, scheduled: 1 });
    expect(result.plan.entries[0].periodDays).toBe(365);
    expect(new URL(result.plan.entries[0].url).searchParams.get("dayRange")).toBe("365");
    const weak = buildPersistentResearchQueue(draft, { captures: { ...captures, pages: [{ ...thin, rows: [{ ...row, totalSold: 1, avgSoldPrice: 12 }] }] }, now });
    expect(weak.plan.entries).toHaveLength(0);
  });
  it("keeps conflicting colors out of pricing and creates an edition-review task", () => {
    const colored = { ...find, sourceListingTitle: "Example Artist Actual Album Red Vinyl LP" };
    const result = buildPersistentResearchQueue({ ...draft, researchCandidates: [colored] }, { captures: { ...captures, pages: [{ ...page, rows: [{ ...row, title: "Example Artist Actual Album Blue Vinyl LP" }] }] }, now });
    expect(result.plan.editionReviews).toHaveLength(1);
    expect(result.plan.completed[0].targets[0].evidence.exactPrice).toBeNull();
    expect(result.plan.sourcing).toHaveLength(0);
  });
  it("uses observed sales to discover a non-sale retailer offer before source filtering", () => {
    const expensive = { ...find, purchasePrice: 40 };
    const source = { ...captures, pages: [{ ...page, rows: [{ ...row, avgSoldPrice: 100 }] }] };
    const enriched = createCapturedSoldIndex(source, now).enrich(expensive);
    expect(enriched).toMatchObject({ soldDiscoveryBasis: "exact_captured_market_sales", soldEvidence: { unitsSold90Days: 9 }, capturedAt: find.capturedAt });
    expect(isHighSignalProductFind(enriched)).toBe(true);
    expect(createCapturedSoldIndex(source, new Date("2026-10-10T14:00:00Z")).enrich(expensive)).toEqual(expensive);
  });
});

describe("capture repair and observed periods", () => {
  const olderRow = {
    listingLinkUnavailable: true,
    cells: ["Example Artist Actual Album New Vinyl LP", "Edit", "$ 40.00 Fixed price", "$ 0.00 100% Free shipping", "6", "$ 240.00", "-", "Mar 24, 2026"],
  };
  const annualObserved = {
    ...page, captureMethod: "visible_browser", completePagination: true, periodDays: 365,
    url: page.url.replace("dayRange=90", "dayRange=365"),
    observedWindow: { startDate: "2025-09-30", endDate: "2026-09-30" }, rows: [olderRow],
  };
  it("retains older observed annual rows when eBay no longer supplies a listing link", () => {
    expect(assessSoldCapture(annualObserved, now).windowVerified).toBe(true);
    const result = curateResearchForFind(find, { entries: [{ findId: find.id, runs: [annualObserved] }] }, now);
    expect(result).toMatchObject({ sales90Days: null, sales365Days: 6, averageSoldPrice: 40, velocityStatus: "verified_window_totals" });
    expect(result).toMatchObject({ rows: [{ itemUrl: "" }] });
    expect(buildPersistentResearchQueue(draft, { captures: { ...captures, pages: [annualObserved] }, now }).checkpoint.entries).toHaveLength(1);
  });
  it.each([
    { ...annualObserved, rows: [{ ...olderRow, listingLinkUnavailable: undefined }] },
    { ...annualObserved, captureMethod: undefined },
    { ...annualObserved, completePagination: undefined },
    { ...annualObserved, rows: [{ ...olderRow, cells: olderRow.cells.slice(0, 7) }] },
    { ...annualObserved, rows: [{ ...olderRow, cells: olderRow.cells.map((cell, index) => index === 7 ? "Sep 24, 2026" : cell) }] },
    { ...annualObserved, rows: [{ ...olderRow, href: "https://other.example/123456789012" }] },
  ])("requires explicit complete historical-table evidence for unlinked sales", (bad) => {
    expect(assessSoldCapture(bad, now).reasonCodes).toContain("listing_identity_missing");
    expect(curateResearchForFind(find, { entries: [{ findId: find.id, runs: [bad] }] }, now).sales365Days).toBeNull();
  });
  it.each([olderRow, { ...olderRow, href: row.itemUrl }])("rejects repeated observed rows, including overlap with a linked copy", (copy) => {
    const duplicate = { ...annualObserved, rows: [olderRow, copy] };
    expect(assessSoldCapture(duplicate, now).reasonCodes).toContain("duplicate_listings");
    expect(curateResearchForFind(find, { entries: [{ findId: find.id, runs: [duplicate] }] }, now).sales365Days).toBeNull();
  });
  it("accepts visibly confirmed filter controls when Seller Hub omits a URL parameter, never a conflict", () => {
    const observed = { ...page, url: page.url.replace("&conditionId=1000", ""), observedFilters: { conditionId: "1000", categoryId: "176985", tabName: "SOLD" } };
    expect(assessSoldCapture(observed, now).windowVerified).toBe(true);
    expect(assessSoldCapture({ ...observed, url: observed.url + "&conditionId=3000" }, now).windowVerified).toBe(false);
    expect(assessSoldCapture({ ...observed, url: observed.url.replace("tabName=SOLD", "tabName=ACTIVE") }, now).windowVerified).toBe(false);
    expect(assessSoldCapture({ ...observed, observedFilters: undefined }, now).windowVerified).toBe(false);
  });
  it("keeps a good capture when a newer attempt fails at the same URL", () => {
    const failed = { ...page, capturedAt: now.toISOString(), complete: false, rows: [], failureReason: "network" };
    const merged = mergeSoldCaptures([page], [failed], now);
    expect(merged).toHaveLength(2);
    expect(merged.map(p => p.captureAssessment.status).sort()).toEqual(["complete", "repair"]);
    const result = buildPersistentResearchQueue(draft, { captures: { ...captures, pages: merged }, now });
    expect(result.plan.summary.reused).toBe(1);
  });
  it("does not replace verified quantities with a newer incomplete date header", () => {
    const bad = { ...page, capturedAt: now.toISOString(), observedWindow: undefined };
    const result = buildPersistentResearchQueue(draft, { captures: { ...captures, pages: [page, bad] }, now });
    expect(result.plan.completed[0].targets[0].evidence.units90Days).toBe(9);
    expect(result.checkpoint.entries[0].runs[0].capturedAt).toBe(page.capturedAt);
  });
  it.each([
    [{ ...page, url: page.url.replace("1000", "3000") }, "filters_unverified"],
    [{ ...page, completePagination: false }, "pagination_incomplete"],
    [{ ...page, rows: [row, row] }, "duplicate_listings"],
    [{ ...page, rows: [{ ...row, itemUrl: "" }] }, "listing_identity_missing"],
    [{ ...page, rows: [{ ...row, dateLastSold: "2025-01-01" }] }, "row_date_outside_window"],
    [{ ...page, observedWindow: undefined }, "window_unverified"],
  ])("explains why a capture cannot establish a complete window", (bad, code) => {
    expect(assessSoldCapture(bad, now)).toMatchObject({ windowVerified: false });
    expect(assessSoldCapture(bad, now).reasonCodes).toContain(code);
  });
  it("retains independently observed annual and recent counts without summing overlap", () => {
    const annual = { ...page, periodDays: 365, url: page.url.replace("dayRange=90", "dayRange=365"), observedWindow: { startDate: "2025-09-30", endDate: "2026-09-30" }, rows: [{ ...row, totalSold: 21, avgSoldPrice: 80 }] };
    const result = curateResearchForFind(find, { entries: [{ findId: find.id, runs: [page, annual] }] }, now);
    expect(result).toMatchObject({ sales90Days: 9, sales365Days: 21, averageSoldPrice: 40 });
    expect(mergeResearchSoldEvidence(null, result, page.capturedAt)).toMatchObject({ unitsSold90Days: 9, unitsSold365Days: 21 });
  });
  it("replaces an older overlapping search rather than preferring its larger count", () => {
    const older = { ...page, capturedAt: "2026-09-30T13:00:00Z", observedWindow: { startDate: "2026-07-01", endDate: "2026-09-29" }, rows: [{ ...row, totalSold: 99, avgSoldPrice: 95 }] };
    const result = curateResearchForFind(find, { entries: [{ findId: find.id, runs: [page, older] }] }, now);
    expect(result).toMatchObject({ sales90Days: 9, totalSoldCount: 9, averageSoldPrice: 40 });
  });
});
