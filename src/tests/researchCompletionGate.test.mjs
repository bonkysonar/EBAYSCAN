import { describe, expect, it } from "vitest";
import { assertResearchReady, researchProgress } from "../../scripts/lib/retailWorkflowState.mjs";
import { productResearchRowMatchScore } from "../../scripts/lib/productResearchCuration.mjs";
import { curateResearchForFind } from "../../scripts/lib/productResearchCuration.mjs";
import { assessSoldCapture, mergeSoldCaptures } from "../../scripts/lib/soldCaptureQuality.mjs";
import { retailEligibility } from "../../scripts/lib/retailIdentity.mjs";
import { buildPersistentResearchQueue } from "../../scripts/lib/persistentResearchQueue.mjs";

const now = new Date("2026-10-03T18:00:00Z");
const find = { id: "one", artist: "Example Artist", title: "Actual Album", sourceListingTitle: "Example Artist Actual Album LP", purchasePrice: 10, sourceCurrency: "USD", condition: "new/sealed", sourceId: "shop", sourceUrl: "https://shop.example/products/album", physicalFormatConfirmed: true, identityStatus: "resolved", capturedAt: now.toISOString() };
const draft = { phase: "scan", runId: "scan-test", finds: [find] };
const run = { query: "Example Artist Actual Album", url: "https://www.ebay.com/sh/research?keywords=Example+Artist+Actual+Album&conditionId=1000&categoryId=176985&tabName=SOLD&dayRange=90&tz=America%2FLos_Angeles", capturedAt: now.toISOString(), periodDays: 90, condition: "New", category: "Vinyl Records", complete: true, completePagination: true, observedWindow: { startDate: "2026-07-05", endDate: "2026-10-03" }, rows: [] };
const progress = value => researchProgress(draft, { runId: draft.runId, entries: [{ findId: find.id, runs: [value] }] }, now);

describe("research completion is a publication prerequisite", () => {
  it("rejects record maintenance supplies even when retailer copy says vinyl", () => {
    expect(retailEligibility({ ...find, sourceListingTitle: "Vinyl Styl Deep Groove Record Washer Replacement Filters 10 Pk with Screen - Accessories" })).toEqual({ eligible: false, reason: "record_accessory" });
    expect(retailEligibility({ ...find, sourceListingTitle: "Artist The Washer LP" }).eligible).toBe(true);
    expect(retailEligibility({ ...find, sourceListingTitle: "NEW SEALED Minor Sleeve Dmg" })).toMatchObject({ eligible: false, reason: "damaged_stock" });
  });
  it("accepts a verified empty search without claiming positive sold evidence", () => {
    const result = progress(run);
    expect(result).toMatchObject({ complete: true, completed: 1, noRows: 1, validated: 0 });
    expect(() => assertResearchReady(result, { tasks: 1, reused: 1 })).not.toThrow();
  });
  it.each([
    { complete: false }, { completePagination: false }, { observedWindow: null },
    { capturedAt: "2026-09-01T18:00:00Z" }, { condition: "Used" },
    { error: "server failed" },
    { rows: [{ title: "Truncated row" }] },
    { rows: [{ title: "Example Artist Actual Album LP", avgSoldPrice: 20, totalSold: 1, dateLastSold: "2025-01-01", itemUrl: "https://www.ebay.com/itm/123456789012" }] },
  ])("keeps defective captures unfinished: %j", changes => {
    const result = progress({ ...run, ...changes });
    expect(result.complete).toBe(false);
    expect(result.completed).toBe(0);
    expect(() => assertResearchReady(result)).toThrow(/Research incomplete/);
  });
  it("does not abandon annual follow-up or deferred queries after the base search", () => {
    expect(() => assertResearchReady(progress(run), { pending: 1 })).toThrow();
    expect(() => assertResearchReady(progress(run), { deferred: 1 })).toThrow();
  });
  it("permits a campaign-only update without claiming completed product research", () => {
    expect(() => assertResearchReady({ status: "not_needed" }, { tasks: 0 })).not.toThrow();
  });
});

describe("single album sold comparables", () => {
  const album = { ...find, artist: "Garth Brooks", title: "The Chase", sourceListingTitle: "Garth Brooks The Chase LP" };
  it.each([
    "Garth Brooks 3 LP Vinyl, The Chase, Fresh Horses, In Pieces, Sealed Brand NEW",
    "Garth Brooks 2 LP LOT, The Chase, Fresh Horses, Vinyl Limited NEW",
    "Garth Brooks The Chase Vinyl Lot of 2",
  ])("rejects a multi-album sale: %s", title => expect(productResearchRowMatchScore(album, title)).toBe(0));
  it("retains legitimate two-disc single albums", () => {
    expect(productResearchRowMatchScore({ ...find, sourceListingTitle: "Example Artist Actual Album 2LP" }, "Example Artist Actual Album 2LP Vinyl New Sealed")).toBeGreaterThan(.68);
  });
});

describe("validate only the identified exact sales actually counted", () => {
  const exact = { title: "Example Artist Actual Album New Vinyl LP", avgSoldPrice: 30, avgShipping: 0, totalSold: 5, dateLastSold: "2026-09-29", itemUrl: "https://www.ebay.com/itm/123456789012" };
  const premium = { ...exact, title: "Example Artist Actual Album Signed Vinyl LP", itemUrl: null, avgSoldPrice: 280, totalSold: 1 };
  function curate(rows) {
    return curateResearchForFind(find, { entries: [{ findId: find.id, runs: [{ ...run, status: "complete", rows }] }] }, now);
  }
  it("retains linked ordinary-edition sales when an unrelated signed edition lost its link", () => {
    expect(curate([exact, premium])).toMatchObject({ sales90Days: 5, averageSoldPrice: 30, velocityStatus: "verified_window_totals", windowCountIsLowerBound: true });
    expect(assessSoldCapture({ ...run, rows: [exact, premium] }, now)).toMatchObject({ searchComplete: true, windowVerified: false });
  });
  it("never validates a counted row whose own identity is missing", () => {
    expect(curate([{ ...exact, itemUrl: null }]).sales90Days).toBeNull();
  });
  it("still rejects duplicate pagination rows", () => {
    expect(curate([exact, exact]).sales90Days).toBeNull();
  });
  it("does not use a policy-removed title or its price to establish value", () => {
    const removed = { cells: ["This listing has been removed for a policy violation."] };
    const unknown = { cells: ["123456789999", "Edit", "$900.00", "$0.00 100% Free shipping", "50", "$45000", "–", "Sep 20, 2026"] };
    expect(curate([removed, unknown, exact])).toMatchObject({ averageSoldPrice: 30, sales90Days: 5, totalSoldCount: 5, windowCountIsLowerBound: true });
    expect(assessSoldCapture({ ...run, rows: [removed, unknown, exact] }, now).searchComplete).toBe(true);
  });
  it("preserves fully collected redacted results when a newer retry stops early", () => {
    const complete = { ...run, rows: [exact, { cells: ["This listing has been removed for a policy violation."] }] };
    const partial = { ...run, capturedAt: new Date(Number(now) + 1000).toISOString(), complete: false, completePagination: false, rows: [exact] };
    const saved = mergeSoldCaptures([complete], [partial], now);
    expect(saved).toHaveLength(2);
    expect(saved.some(page => assessSoldCapture(page, now).searchComplete)).toBe(true);
  });
  it("accepts a fully paginated search beyond 1000 rows without counting duplicate listings", () => {
    const rows = Array.from({length:1800}, (_,i)=>({...exact,itemUrl:`https://www.ebay.com/itm/${123456780000+i}`}));
    expect(assessSoldCapture({...run,rows},now).searchComplete).toBe(true);
    expect(assessSoldCapture({...run,rows:[...rows,rows[0]]},now).searchComplete).toBe(false);
  });
  it("does not let an earlier partial save hide completion with the same timestamp", () => {
    const complete = {...run,rows:[exact,{cells:['This listing has been removed for a policy violation.']}]};
    const partial = {...run,complete:false,completePagination:false,rows:[exact]};
    const queue = buildPersistentResearchQueue(draft,{now,captures:{captureMethod:'visible_browser',pages:[partial,complete]}});
    expect(queue.plan.summary).toMatchObject({reused:1,repair:0,pending:0});
  });
});
