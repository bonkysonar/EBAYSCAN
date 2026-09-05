import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeVerifiedSourceUpdates } from "../server/retailSourceUpdates";
import {
  feedbackReceipt,
  retailOperations,
} from "../server/retailOperationsApi";
import { applyRetailLearning } from "../../scripts/lib/retailLearning.mjs";
import { selectDecisionList } from "../lib/arbitrage/decisionList.mjs";
import type {
  ArbitrageFind,
  ArbitrageImportPayload,
} from "../lib/arbitrage/types";
const at = new Date().toISOString();
const item: ArbitrageFind = {
  id: "a",
  artist: "Artist",
  title: "Album",
  sourceName: "Store",
  sourceId: "a",
  sourceUrl: "https://store.example/album",
  purchasePrice: 20,
  capturedAt: at,
  sourceCurrency: "USD",
};
const incoming: ArbitrageImportPayload = {
  createdAt: at,
  finds: [item],
  publicationMode: "source_updates",
  sourceUpdateVersion: 1,
  runManifest: {
    scannedSourceCount: 1,
    sourceCatalogCount: 2,
    requestedSourceIds: ["a"],
    startedAt: at,
    scannerVersion: "test",
  },
  sourceReports: [
    {
      id: "a",
      catalogHealth: "healthy",
      catalogPageAvailableCount: 1,
      productParseHealth: "productive",
      salePageHealth: "healthy",
      salePageAvailableCount: 1,
    },
  ],
};
const directories: string[] = [];
const previousToken = process.env.ARBITRAGE_UPLOAD_TOKEN,
  previousBlob = process.env.BLOB_READ_WRITE_TOKEN;
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
  if (previousToken === undefined) delete process.env.ARBITRAGE_UPLOAD_TOKEN;
  else process.env.ARBITRAGE_UPLOAD_TOKEN = previousToken;
  if (previousBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previousBlob;
});
describe("retailer update and review contracts", () => {
  it("persists bounded research progress and cannot label an all-pending run complete", async () => {
    process.env.ARBITRAGE_UPLOAD_TOKEN = "test-secret";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const cwd = mkdtempSync(join(tmpdir(), "retail-progress-"));
    directories.push(cwd);
    await retailOperations(cwd, "POST", {
      runId: "test-research", startedAt: at, status: "partial", updatedSourceCount: 55,
      researchProgress: { planned: 240, completed: 0, validated: 0, noRows: 0, pending: 240, complete: true, status: "complete", title: "private listing", rows: ["raw content"] },
    }, "test-secret");
    const result = await retailOperations(cwd, "GET", null);
    expect(result).toMatchObject({ updatedSourceCount: 55, researchProgress: { planned: 240, completed: 0, validated: 0, pending: 240, complete: false, status: "incomplete" } });
    expect(JSON.stringify(result)).not.toContain("private listing");
    expect(JSON.stringify(result)).not.toContain("raw content");
  });

  it("updates one retailer while retaining the other offer timestamp and broad-scan date", () => {
    const old = "2026-08-01T12:00:00Z";
    const result = mergeVerifiedSourceUpdates(
      incoming,
      {
        createdAt: old,
        finds: [
          { ...item, id: "old-a" },
          { ...item, id: "old-b", sourceId: "b", capturedAt: old },
        ],
      },
      ["a", "b"],
    );
    expect(result.finds.map((f) => f.id)).toEqual(["a", "old-b"]);
    expect(result.finds[1].capturedAt).toBe(old);
    expect(result.sourceUpdates?.lastBroadScanAt).toBe(old);
  });
  it("cannot use a sale-page check to refresh a failed product catalog", () => {
    const partial = {
      ...incoming,
      sourceReports: [
        {
          ...incoming.sourceReports![0],
          catalogHealth: "failed",
          catalogPageAvailableCount: 0,
          productParseHealth: "failed",
        },
      ],
    };
    expect(
      mergeVerifiedSourceUpdates(
        partial,
        { createdAt: at, finds: [{ ...item, id: "old-a" }] },
        ["a", "b"],
      ).finds.map((f) => f.id),
    ).toEqual(["old-a"]);
  });
  it("retains catalog evidence and dates when a browser refresh checked only a sale page", () => {
    const old = new Date(Date.parse(at) - 3600000).toISOString();
    const previous = {
      createdAt: old, finds: [{ ...item, id: "old-a", capturedAt: old }],
      sourceReports: [{ id: "a", status: "partial", candidateCount: 132,
        catalogHealth: "healthy", catalogPageAvailableCount: 3, catalogPageAttemptCount: 3,
        productParseHealth: "productive", verifiedAt: old }],
    };
    const current = { ...incoming, sourceReports: [{ id: "a", status: "partial",
      candidateCount: 0, catalogHealth: "not_attempted", catalogPageAvailableCount: 0,
      catalogPageAttemptCount: 0, productParseHealth: "empty", salePageHealth: "healthy",
      salePageAvailableCount: 1 }] };
    const result = mergeVerifiedSourceUpdates(current, previous, ["a", "b"]);
    expect(result.sourceReports?.[0]).toMatchObject({ candidateCount: 132,
      catalogHealth: "healthy", catalogPageAvailableCount: 3, productParseHealth: "productive",
      salePageHealth: "healthy", verifiedAt: old, lastAttemptAt: at });
    expect(result.finds[0].capturedAt).toBe(old);
    // An actual failed catalog attempt must still replace its old healthy result.
    const failed = mergeVerifiedSourceUpdates({ ...current, sourceReports: [{
      ...current.sourceReports[0], catalogHealth: "failed", catalogPageAttemptCount: 1,
      productParseHealth: "failed",
    }] }, previous, ["a", "b"]);
    expect(failed.sourceReports?.[0]).toMatchObject({ catalogHealth: "failed", productParseHealth: "failed" });
  });
  it("admits browser offers captured before the scan only with fresh source-bound provenance", () => {
    const observed = new Date(Date.parse(at) - 45 * 60000).toISOString();
    const browserItem: ArbitrageFind = { ...item, capturedAt: observed, retailObservedAt: observed,
      retailObservationMethod: "visible_browser_catalog", retailObservationUrl: "https://store.example/collections/vinyl" };
    const browserReport = { ...incoming.sourceReports![0], browserObservationCount: 1,
      browserObservedAt: observed, browserObservedUrls: [browserItem.retailObservationUrl], browserCatalogCoverage: "bounded_visible_pages" };
    const payload = { ...incoming, finds: [browserItem], sourceReports: [browserReport] };
    const result = mergeVerifiedSourceUpdates(payload, null, ["a", "b"], Date.parse(at));
    expect(result.finds).toHaveLength(1);
    expect(result.finds[0].capturedAt).toBe(observed);
    expect(result.finds[0].retailObservedAt).toBe(observed);
    expect(result.sourceReports?.[0].verifiedAt).toBe(observed);
    for (const changes of [
      { retailObservationMethod: undefined },
      { retailObservedAt: undefined },
      { retailObservationUrl: undefined },
      { sourceId: "b" },
      { sourceUrl: "https://another-store.example/album" },
      { retailObservationUrl: "https://store.example/not-observed" },
      { capturedAt: at },
      { capturedAt: new Date(Date.parse(at) - 7 * 3600000).toISOString(), retailObservedAt: new Date(Date.parse(at) - 7 * 3600000).toISOString() },
    ]) expect(mergeVerifiedSourceUpdates({ ...payload, finds: [{ ...browserItem, ...changes }] }, null, ["a", "b"], Date.parse(at)).finds).toHaveLength(0);
    expect(mergeVerifiedSourceUpdates({ ...payload, sourceReports: incoming.sourceReports }, null, ["a", "b"], Date.parse(at)).finds).toHaveLength(0);
  });
  it("rejects unversioned, unknown, duplicate, stale and completely failed updates", () => {
    expect(() =>
      mergeVerifiedSourceUpdates(
        { ...incoming, sourceUpdateVersion: undefined },
        null,
        ["a", "b"],
      ),
    ).toThrow();
    expect(() =>
      mergeVerifiedSourceUpdates(incoming, null, ["x", "b"]),
    ).toThrow();
    expect(() =>
      mergeVerifiedSourceUpdates(
        { ...incoming, createdAt: "2020-01-01" },
        null,
        ["a", "b"],
      ),
    ).toThrow();
    expect(() =>
      mergeVerifiedSourceUpdates(
        { ...incoming, sourceReports: [{ id: "a" }] },
        null,
        ["a", "b"],
      ),
    ).toThrow();
  });
  it("saves only signed opaque review fields and reopens materially changed offers", async () => {
    process.env.ARBITRAGE_UPLOAD_TOKEN = "test-secret";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const cwd = mkdtempSync(join(tmpdir(), "retail-review-"));
    directories.push(cwd);
    const receipt = feedbackReceipt(item)!;
    await retailOperations(
      cwd,
      "POST",
      { receipt, outcome: "margin_too_thin", title: "untrusted raw content" },
      undefined,
      "feedback",
    );
    const raw = readFileSync(
      join(
        cwd,
        "exports",
        "retail-operations",
        "feedback",
        `${receipt.key}.json`,
      ),
      "utf8",
    );
    for (const text of [
      "Artist",
      "Album",
      "store.example",
      "untrusted raw content",
      "signature",
      "test-secret",
    ])
      expect(raw).not.toContain(text);
    const entries = [JSON.parse(raw)];
    expect(applyRetailLearning([item], entries)[0].learningSuppressed).toBe(
      true,
    );
    expect(
      applyRetailLearning([{ ...item, purchasePrice: 15 }], entries)[0]
        .learningSuppressed,
    ).toBe(false);
    await expect(
      retailOperations(
        cwd,
        "POST",
        { receipt: { ...receipt, key: "a".repeat(64) }, outcome: "bought" },
        undefined,
        "feedback",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("records a failed attempt independently of a published run", async () => {
    process.env.ARBITRAGE_UPLOAD_TOKEN = "test-secret";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const cwd = mkdtempSync(join(tmpdir(), "retail-status-"));
    directories.push(cwd);
    await retailOperations(
      cwd,
      "POST",
      { runId: "test-run", startedAt: at, status: "partial" },
      "test-secret",
    );
    await retailOperations(
      cwd,
      "POST",
      { runId: "test-run-2", startedAt: at, status: "failed" },
      "test-secret",
    );
    expect(await retailOperations(cwd, "GET", null)).toMatchObject({
      status: "failed",
      lastPublishedAt: expect.any(String),
    });
  });
  it("caps distinct releases without filling the list with weak or stale rows", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      ...item,
      id: String(i),
      title: `Album ${Math.floor(i / 2)}`,
      candidateTier: "A" as const,
      decision: "BUY",
      expectedNetProfit: 10 + i,
      roiRatio: 0.5,
    }));
    expect(selectDecisionList(rows)).toHaveLength(15);
    expect(
      selectDecisionList(rows.map((f) => ({ ...f, capturedAt: "2020-01-01" }))),
    ).toHaveLength(0);
  });
});
