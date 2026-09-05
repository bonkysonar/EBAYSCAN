import { describe, expect, it } from "vitest";
import { admittedSourceIds, researchProgress } from "../../scripts/lib/retailWorkflowState.mjs";
import { buildProductResearchPlan } from "../../scripts/lib/productResearchCuration.mjs";
import { mergeVerifiedSourceUpdates } from "../server/retailSourceUpdates";

const at = "2026-09-05T00:00:00.000Z";
const find = { id: "record", artist: "Mother Love Bone", title: "Shine", purchasePrice: 10, sourceId: "shop", sourceName: "Shop", sourceUrl: "https://shop.example/products/shine", capturedAt: at };
const draft = { runId: "scan-test", researchCandidates: [find], createdAt: at, finds: [find] };
const query = buildProductResearchPlan([find])[0].variants[0].query;

describe("retail workflow state", () => {
  it("does not call an empty or pending checkpoint completed research", () => {
    expect(researchProgress(draft, { runId: draft.runId, entries: [] }, new Date(at))).toMatchObject({ planned: 1, completed: 0, validated: 0, noRows: 0, pending: 1, complete: false });
    expect(researchProgress(draft, { runId: draft.runId, entries: [{ findId: find.id, runs: [{ query, status: "pending", rows: [] }] }] }, new Date(at))).toMatchObject({ completed: 0, noRows: 0, pending: 1, complete: false });
  });

  it("counts successful empty searches separately from failed searches", () => {
    const checkpoint = (status: string) => ({ runId: draft.runId, entries: [{ findId: find.id, runs: [{ query, status, rows: [] }] }] });
    expect(researchProgress(draft, checkpoint("complete"), new Date(at))).toMatchObject({ completed: 1, validated: 0, noRows: 1, pending: 0, complete: true });
    expect(researchProgress(draft, checkpoint("blocked"), new Date(at))).toMatchObject({ completed: 0, noRows: 0, failed: 1, complete: false });
  });

  it("counts validated matched evidence while retaining incomplete work in the full plan", () => {
    const second = { ...find, id: "other", title: "Other Release" };
    const checkpoint = { runId: draft.runId, entries: [{ findId: find.id, runs: [{ query, status: "complete", rows: [{ title: "Mother Love Bone - Shine Vinyl LP New Sealed", totalSold: 2, avgSoldPrice: 30, avgShipping: 5, dateLastSold: "2026-08-30" }] }] }] };
    expect(researchProgress({ ...draft, researchCandidates: [find, second] }, checkpoint, new Date(at))).toMatchObject({ planned: 2, completed: 1, validated: 1, researchedRows: 1, pending: 1, complete: false });
  });

  it("keeps the workflow bounded at 240 and refuses a wrong-run checkpoint", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ ...find, id: `row-${i}` }));
    const entries = rows.slice(0, 240).map((row) => ({ findId: row.id, runs: [{ query, status: "complete", rows: [] }] }));
    expect(researchProgress({ ...draft, researchCandidates: rows }, { runId: draft.runId, entries }, new Date(at))).toMatchObject({ planned: 240, completed: 240, outsidePlan: 60, limit: 240, complete: false });
    expect(() => researchProgress(draft, { runId: "scan-other", entries: [] })).toThrow("another scan");
  });

  it("reports the same admitted source count as the publication contract", () => {
    const reports = [
      { id: "productive", catalogPageAvailableCount: 1, catalogHealth: "healthy", productParseHealth: "productive" },
      { id: "empty", catalogPageAvailableCount: 1, catalogHealth: "healthy", productParseHealth: "empty" },
      { id: "failed", catalogPageAvailableCount: 1, catalogHealth: "failed", productParseHealth: "productive" },
      { id: "sale", salePageAvailableCount: 1, salePageHealth: "partial" },
      { id: "failed-sale", salePageAvailableCount: 1, salePageHealth: "failed" },
    ];
    const ids = reports.map((row) => row.id);
    const payload = { ...draft, sourceReports: reports, sourceUpdateVersion: 1, runManifest: { scannedSourceCount: reports.length, sourceCatalogCount: reports.length } };
    const admitted = mergeVerifiedSourceUpdates(payload, null, ids, Date.parse(at));
    expect(admittedSourceIds(payload)).toEqual(["productive", "sale"]);
    expect(admittedSourceIds(payload)).toEqual(admitted.sourceUpdates!.updatedSourceIds);
  });
});
