import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/arbitrage/vinylShopSources", () => ({
  getActiveRetailSources: () => [{ id: "store" }],
}));
import {
  readArbitrageFindsHistory,
  readLatestArbitrageFinds,
  uploadArbitrageFinds,
} from "../server/arbitrageFindsApi";

describe("arbitrage finds publication", () => {
  const originalUploadToken = process.env.ARBITRAGE_UPLOAD_TOKEN;
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  let workspace = "";

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "record-scanner-arbitrage-"));
    process.env.ARBITRAGE_UPLOAD_TOKEN = "test-upload-token";
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true });
    restoreEnv("ARBITRAGE_UPLOAD_TOKEN", originalUploadToken);
    restoreEnv("BLOB_READ_WRITE_TOKEN", originalBlobToken);
  });

  it("publishes an immutable final run and atomically points latest to it", async () => {
    const result = await uploadArbitrageFinds(
      workspace,
      finalPayload({ createdAt: "2026-07-13T12:45:44.923Z", runId: "daily-2026-07-13" }),
      "test-upload-token",
    );

    const directory = join(workspace, "exports", "arbitrage-finds");
    const pointerPath = join(directory, "latest.json");
    const runPath = join(directory, "runs", "daily-2026-07-13", "final.json");
    expect(result).toMatchObject({
      runId: "daily-2026-07-13",
      status: "published",
      storage: "local-filesystem",
    });
    expect(existsSync(pointerPath)).toBe(true);
    expect(existsSync(runPath)).toBe(true);
    expect(JSON.parse(readFileSync(pointerPath, "utf8"))).toMatchObject({
      runId: "daily-2026-07-13",
      storagePath: "arbitrage-finds/runs/daily-2026-07-13/final.json",
    });
    expect(JSON.parse(readFileSync(runPath, "utf8"))).toMatchObject({
      phase: "final",
      publication: {
        runId: "daily-2026-07-13",
      },
      runId: "daily-2026-07-13",
      schemaVersion: 2,
    });
  });

  it("rejects draft, legacy, and unsafe run payloads", async () => {
    await expect(
      uploadArbitrageFinds(
        workspace,
        { ...finalPayload(), phase: "scan", publicationStatus: "draft" },
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      uploadArbitrageFinds(
        workspace,
        { ...finalPayload(), publicationStatus: "draft" },
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      uploadArbitrageFinds(
        workspace,
        {
          createdAt: "2026-07-13T12:45:44.923Z",
          finds: [],
          source: "daily-vinyl-retail-arbitrage-scan",
        },
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      uploadArbitrageFinds(workspace, finalPayload({ runId: "../../outside" }), "test-upload-token"),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          createdAt: "2099-01-01T00:00:00.000Z",
          runId: "future-run",
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a final run when direct-retailer coverage is below the publication floor", async () => {
    const sourceReports = Array.from({ length: 10 }, (_, index) => ({
      candidateCount: index < 6 ? 2 : 0,
      catalogHealth: index < 6 ? "healthy" : "failed",
      catalogPageAvailableCount: index < 6 ? 1 : 0,
      crawlType: "retailer",
      id: `source-${index}`,
      productParseHealth: index < 6 ? "productive" : "failed",
      salePageAvailableCount: index < 6 ? 1 : 0,
      salePageHealth: index < 6 ? "healthy" : "failed",
      status: index < 6 ? "candidates" : "error",
    }));

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({ runId: "low-coverage-run", sourceReports }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("stores a server-assessed quality summary for an authoritative complete run", async () => {
    const sourceReports = [{
      candidateCount: 2,
      catalogHealth: "healthy",
      catalogPageAvailableCount: 1,
      crawlType: "retailer",
      id: "store",
      productParseHealth: "productive",
      salePageAvailableCount: 1,
      salePageHealth: "healthy",
      status: "candidates",
    }];

    await uploadArbitrageFinds(
      workspace,
      finalPayload({ runId: "degraded-coverage-run", sourceReports }),
      "test-upload-token",
    );
    const latest = await readLatestArbitrageFinds(workspace);

    expect(latest).toMatchObject({
      payload: {
        runQuality: {
          directCatalogCoverageRate: 1,
          directProductiveRate: 1,
          publishable: true,
          status: "healthy",
        },
      },
      status: "available",
    });
  });

  it("rejects targeted scans even when every selected source was reachable", async () => {
    const sourceReports = Array.from({ length: 2 }, (_, index) => ({
      candidateCount: 2,
      catalogHealth: "healthy",
      catalogPageAvailableCount: 1,
      crawlType: "retailer",
      id: `selected-source-${index}`,
      productParseHealth: "productive",
      status: "candidates",
    }));

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          runId: "targeted-scan-run",
          runManifest: {
            scannedSourceCount: 2,
            sourceCatalogCount: 120,
          },
          sourceReports,
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("rejects a targeted manifest even when its source counts self-report as complete", async () => {
    const sourceReports = [sourceReport("healthy")];
    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          runId: "targeted-equal-count-run",
          runManifest: {
            requestedSourceIds: ["store"],
            scannedSourceCount: 1,
            sourceCatalogCount: 1,
          },
          sourceReports,
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("rejects a self-attested complete run whose source IDs do not match the configured catalog", async () => {
    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          runId: "forged-catalog-run",
          sourceReports: [{ ...sourceReport("healthy"), id: "not-the-configured-store" }],
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("rejects runs whose manifest omits scanned source reports", async () => {
    const sourceReports = Array.from({ length: 2 }, (_, index) => ({
      candidateCount: 2,
      catalogHealth: "healthy",
      catalogPageAvailableCount: 1,
      crawlType: "retailer",
      id: `reported-source-${index}`,
      productParseHealth: "productive",
      status: "candidates",
    }));

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          runId: "missing-report-run",
          runManifest: {
            scannedSourceCount: 3,
            sourceCatalogCount: 3,
          },
          sourceReports,
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("rejects schema-v2 publications that omit source reports, manifest counts, or per-source diagnostics", async () => {
    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({ runId: "missing-source-reports", sourceReports: [] }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({ runId: "missing-manifest-counts", runManifest: {} }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          runId: "missing-source-diagnostics",
          sourceReports: [{ id: "opaque-source" }],
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("rejects a reachable run when every direct-retailer parser is empty", async () => {
    const sourceReports = Array.from({ length: 10 }, (_, index) => ({
      candidateCount: 0,
      catalogHealth: "healthy",
      catalogPageAvailableCount: 1,
      crawlType: "retailer",
      id: `empty-source-${index}`,
      productParseHealth: "empty",
      status: "empty",
    }));

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({ runId: "all-parsers-empty", sourceReports }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("rejects duplicate source report IDs", async () => {
    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          runId: "duplicate-source-reports",
          sourceReports: [sourceReport("healthy"), sourceReport("healthy")],
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("leaves the latest pointer unchanged after targeted, malformed, and parser-empty uploads", async () => {
    await uploadArbitrageFinds(
      workspace,
      finalPayload({ runId: "known-good-baseline" }),
      "test-upload-token",
    );

    const attempts = [
      finalPayload({
        createdAt: "2026-07-14T12:45:44.923Z",
        runId: "bad-targeted",
        runManifest: {
          requestedSourceIds: ["store"],
          scannedSourceCount: 1,
          sourceCatalogCount: 1,
        },
      }),
      finalPayload({
        createdAt: "2026-07-14T12:45:44.923Z",
        runId: "bad-malformed",
        runManifest: {},
      }),
      finalPayload({
        createdAt: "2026-07-14T12:45:44.923Z",
        runId: "bad-empty-parsers",
        sourceReports: Array.from({ length: 10 }, (_, index) => ({
          candidateCount: 0,
          catalogHealth: "healthy",
          catalogPageAvailableCount: 1,
          crawlType: "retailer",
          id: `empty-${index}`,
          productParseHealth: "empty",
          status: "empty",
        })),
      }),
    ];

    for (const attempt of attempts) {
      await expect(
        uploadArbitrageFinds(workspace, attempt, "test-upload-token"),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(await readLatestArbitrageFinds(workspace)).toMatchObject({
        payload: { runId: "known-good-baseline" },
        status: "available",
      });
    }
  });

  it("rejects a fabricated BUY whose acquisition offer is not verified and preserves latest", async () => {
    await uploadArbitrageFinds(
      workspace,
      finalPayload({ runId: "buy-safety-baseline" }),
      "test-upload-token",
    );

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          createdAt: "2026-07-14T12:45:44.923Z",
          finds: [
            productFind({
              decision: "BUY",
              purchaseOfferVerification: "campaign_advertised",
              status: "BUY",
            }),
          ],
          runId: "fabricated-unverified-buy",
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(await readLatestArbitrageFinds(workspace)).toMatchObject({
      payload: { runId: "buy-safety-baseline" },
      status: "available",
    });
  });

  it("makes retries idempotent and rejects conflicting content for one runId", async () => {
    const payload = finalPayload({ runId: "same-run" });
    const first = await uploadArbitrageFinds(workspace, payload, "test-upload-token");
    const retry = await uploadArbitrageFinds(workspace, payload, "test-upload-token");

    expect(first.status).toBe("published");
    expect(retry).toMatchObject({ runId: "same-run", status: "already-published" });
    await expect(
      uploadArbitrageFinds(
        workspace,
        { ...payload, finds: [productFind({ id: "different-find" })] },
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("recovers a completed immutable run when the latest pointer was not committed", async () => {
    const payload = finalPayload({ runId: "recoverable-run" });
    const first = await uploadArbitrageFinds(workspace, payload, "test-upload-token");
    const pointerPath = join(workspace, "exports", "arbitrage-finds", "latest.json");
    rmSync(pointerPath);

    const recovered = await uploadArbitrageFinds(workspace, payload, "test-upload-token");
    expect(recovered).toMatchObject({
      fileName: first.fileName,
      payloadHash: first.payloadHash,
      runId: "recoverable-run",
      status: "published",
    });
    expect(await readLatestArbitrageFinds(workspace)).toMatchObject({
      payload: { runId: "recoverable-run" },
      status: "available",
    });
  });

  it("does not let an older final run replace latest", async () => {
    await uploadArbitrageFinds(
      workspace,
      finalPayload({ createdAt: "2026-07-14T12:00:00.000Z", runId: "run-newer" }),
      "test-upload-token",
    );

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({ createdAt: "2026-07-13T12:00:00.000Z", runId: "run-older" }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await readLatestArbitrageFinds(workspace)).toMatchObject({
      payload: { runId: "run-newer" },
      status: "available",
    });
  });

  it("orders latest by scan observation time instead of later curation time", async () => {
    await uploadArbitrageFinds(
      workspace,
      finalPayload({
        createdAt: "2026-07-14T13:00:00.000Z",
        runId: "observed-july-14",
        saleCampaignLedger: emptyLedger("observed-july-14", "2026-07-14T12:00:00.000Z"),
      }),
      "test-upload-token",
    );

    await expect(
      uploadArbitrageFinds(
        workspace,
        finalPayload({
          createdAt: "2026-07-15T18:00:00.000Z",
          runId: "curated-late-but-observed-old",
          saleCampaignLedger: emptyLedger("curated-late-but-observed-old", "2026-07-13T12:00:00.000Z"),
        }),
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await readLatestArbitrageFinds(workspace)).toMatchObject({
      payload: { runId: "observed-july-14" },
      status: "available",
    });
  });

  it("ignores a newer raw archive when no latest pointer exists", async () => {
    const directory = join(workspace, "exports", "arbitrage-finds");
    const finalPath = join(directory, "retail-arbitrage-2026-07-13.json");
    const rawPath = join(directory, "retail-arbitrage-2026-07-14T12-00-00-000Z.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      finalPath,
      JSON.stringify({
        createdAt: "2026-07-13T12:00:00.000Z",
        finds: [],
        source: "daily-vinyl-retail-arbitrage-scan",
      }),
    );
    writeFileSync(
      rawPath,
      JSON.stringify({
        createdAt: "2026-07-14T12:00:00.000Z",
        finds: [],
        phase: "scan",
        publicationStatus: "draft",
        source: "daily-vinyl-retail-arbitrage-scan",
      }),
    );

    expect(await readLatestArbitrageFinds(workspace)).toMatchObject({
      fileName: "retail-arbitrage-2026-07-13.json",
      payload: { source: "daily-vinyl-retail-arbitrage-scan" },
      status: "available",
    });
  });

  it("preserves legacy site-wide alerts that exist only in finds", async () => {
    const directory = join(workspace, "exports", "arbitrage-finds");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "retail-arbitrage-2026-07-13.json"),
      JSON.stringify({
        createdAt: "2026-07-13T12:00:00.000Z",
        finds: [saleEvent()],
        source: "daily-vinyl-retail-arbitrage-scan",
      }),
    );

    const latest = await readLatestArbitrageFinds(workspace);
    expect(latest).toMatchObject({
      payload: {
        finds: [expect.objectContaining({ opportunityType: "sitewide_sale" })],
      },
      status: "available",
    });
  });

  it("deduplicates legacy sale-page variants and rebuilds summary counts from returned rows", async () => {
    const directory = join(workspace, "exports", "arbitrage-finds");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "retail-arbitrage-2026-07-13.json"),
      JSON.stringify({
        createdAt: "2026-07-13T12:00:00.000Z",
        finds: [
          saleEvent(),
          saleEvent({
            id: "sale-store-page-2",
            sourceUrl: "https://store.example/collections/sale?page=2&sort_by=best-selling",
          }),
          productFind({ id: "album" }),
          productFind({ id: "navigation", sourceListingTitle: "Home", title: "Home" }),
        ],
        source: "daily-vinyl-retail-arbitrage-scan",
        summary: {
          byDecision: { BUY: 50, REVIEW: 50, REJECT: 0, WATCH: 50 },
          findCount: 150,
          includedProductFindCount: 100,
          saleEventCount: 50,
        },
      }),
    );

    const latest = await readLatestArbitrageFinds(workspace);
    expect(latest.status).toBe("available");
    if (latest.status !== "available") return;
    expect(latest.payload.finds).toHaveLength(2);
    expect(new Set(latest.payload.finds.map((find) => find.id)).size).toBe(2);
    expect(latest.payload.finds.filter((find) => find.opportunityType === "sitewide_sale")).toHaveLength(1);
    expect(latest.payload.summary).toMatchObject({
      byDecision: { BUY: 0, REVIEW: 1, REJECT: 0, WATCH: 1 },
      findCount: 2,
      includedProductFindCount: 1,
      saleEventCount: 1,
    });
  });

  it("orders pointerless legacy finals by observation time instead of file modification time", async () => {
    const directory = join(workspace, "exports", "arbitrage-finds");
    mkdirSync(directory, { recursive: true });
    const newerPath = join(directory, "retail-arbitrage-newer.json");
    const olderPath = join(directory, "retail-arbitrage-older.json");
    writeFileSync(
      newerPath,
      JSON.stringify({
        createdAt: "2026-07-15T12:00:00.000Z",
        finds: [],
        source: "daily-vinyl-retail-arbitrage-scan",
      }),
    );
    writeFileSync(
      olderPath,
      JSON.stringify({
        createdAt: "2026-07-14T12:00:00.000Z",
        finds: [],
        source: "daily-vinyl-retail-arbitrage-scan",
      }),
    );
    const early = new Date("2026-07-01T00:00:00.000Z");
    const late = new Date("2026-07-20T00:00:00.000Z");
    utimesSync(newerPath, early, early);
    utimesSync(olderPath, late, late);

    expect(await readLatestArbitrageFinds(workspace)).toMatchObject({
      fileName: "retail-arbitrage-newer.json",
      payload: { createdAt: "2026-07-15T12:00:00.000Z" },
      status: "available",
    });
  });

  it("can migrate the same legacy final artifact to pointer-backed publication", async () => {
    const directory = join(workspace, "exports", "arbitrage-finds");
    mkdirSync(directory, { recursive: true });
    const legacy = {
      createdAt: "2026-07-13T12:45:44.923Z",
      finds: [],
      saleEvents: [],
      source: "daily-vinyl-retail-arbitrage-scan",
    };
    writeFileSync(join(directory, "retail-arbitrage-2026-07-13.json"), JSON.stringify(legacy));

    const result = await uploadArbitrageFinds(
      workspace,
      {
        ...legacy,
        phase: "final",
        publicationStatus: "final",
        runId: "migrated-legacy-run",
        saleObservations: [],
        schemaVersion: 2,
        runManifest: {
          requestedSourceIds: [],
          scannedSourceCount: 1,
          sourceCatalogCount: 1,
        },
        sourceReports: [sourceReport("healthy")],
      },
      "test-upload-token",
    );

    expect(result).toMatchObject({ runId: "migrated-legacy-run", status: "published" });
    expect(existsSync(join(directory, "latest.json"))).toBe(true);
  });

  it("persists campaign history, uses failures as unknown, and ends after two successful misses", async () => {
    await uploadArbitrageFinds(
      workspace,
      finalPayload({
        createdAt: "2026-07-13T12:00:00.000Z",
        finds: [saleEvent()],
        runId: "run-day-1",
        saleEvents: [saleEvent()],
        saleObservations: [saleEvent()],
        sourceReports: [sourceReport("healthy")],
      }),
      "test-upload-token",
    );
    await uploadArbitrageFinds(
      workspace,
      finalPayload({
        createdAt: "2026-07-14T12:00:00.000Z",
        runId: "run-day-2",
        saleEvents: [],
        saleObservations: [],
        sourceReports: [sourceReport("blocked")],
      }),
      "test-upload-token",
    );

    let latest = await readLatestArbitrageFinds(workspace);
    expect(latest).toMatchObject({
      payload: {
        saleEvents: [],
        saleCampaignLedger: {
          campaigns: [
            expect.objectContaining({
              lastSeenAt: "2026-07-13T12:00:00.000Z",
              saleMissCount: 0,
              saleStatus: "unknown",
            }),
          ],
        },
      },
    });

    await uploadArbitrageFinds(
      workspace,
      finalPayload({
        createdAt: "2026-07-15T12:00:00.000Z",
        runId: "run-day-3",
        saleEvents: [],
        saleObservations: [],
        sourceReports: [sourceReport("healthy")],
      }),
      "test-upload-token",
    );
    await uploadArbitrageFinds(
      workspace,
      finalPayload({
        createdAt: "2026-07-16T12:00:00.000Z",
        runId: "run-day-4",
        saleEvents: [],
        saleObservations: [],
        sourceReports: [sourceReport("healthy")],
      }),
      "test-upload-token",
    );

    latest = await readLatestArbitrageFinds(workspace);
    expect(latest).toMatchObject({ payload: { saleEvents: [] } });
    const history = await readArbitrageFindsHistory(workspace, { sourceId: "store" });
    expect(history).toMatchObject({
      campaigns: [
        expect.objectContaining({
          endedAt: "2026-07-16T12:00:00.000Z",
          lastSeenAt: "2026-07-13T12:00:00.000Z",
          saleMissCount: 2,
          saleStatus: "ended",
        }),
      ],
      runId: "run-day-4",
      status: "available",
      summary: { ended: 1 },
    });
    expect(history.status === "available" ? history.events.map((event) => event.reason) : []).toEqual(
      expect.arrayContaining(["first_seen", "source_check_failed", "successful_miss", "ended_after_successful_misses"]),
    );
  });

  it("keeps valid unknown-artist records while filtering obvious non-record navigation", async () => {
    await uploadArbitrageFinds(
      workspace,
      finalPayload({
        finds: [
          productFind({ artist: "Unknown Artist", id: "soundtrack", title: "Stranger Things 5 Soundtrack" }),
          productFind({ artist: "Select Accts", id: "navigation", title: "Home" }),
          productFind({
            id: "mixed-shopify",
            shopifyVariantTitle: "2xLP",
            sourceListingTitle: "Artist - Album (CD / Vinyl) - 2xLP",
          }),
        ],
      }),
      "test-upload-token",
    );

    const latest = await readLatestArbitrageFinds(workspace);
    expect(latest.status === "available" ? latest.payload.finds.map((find) => find.id) : []).toEqual([
      "soundtrack",
      "mixed-shopify",
    ]);
  });

  it("requires the configured upload token", async () => {
    await expect(uploadArbitrageFinds(workspace, finalPayload(), "wrong-token")).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

function finalPayload(overrides: Record<string, unknown> = {}) {
  const sourceReports = Array.isArray(overrides.sourceReports)
    ? overrides.sourceReports
    : [sourceReport("healthy")];
  return {
    createdAt: "2026-07-13T12:45:44.923Z",
    finds: [],
    phase: "final",
    publicationStatus: "final",
    runId: "daily-2026-07-13-default",
    saleEvents: [],
    saleObservations: [],
    schemaVersion: 2,
    source: "daily-vinyl-retail-arbitrage-scan",
    runManifest: {
      requestedSourceIds: [],
      scannedSourceCount: sourceReports.length,
      sourceCatalogCount: sourceReports.length,
    },
    sourceReports,
    ...overrides,
  };
}

function productFind(overrides: Record<string, unknown> = {}) {
  return {
    artist: "Artist",
    capturedAt: "2026-07-13T12:45:44.923Z",
    id: "product",
    opportunityType: "product_deal",
    purchasePrice: 10,
    sourceId: "store",
    sourceName: "Store",
    sourceUrl: "https://store.example/products/album",
    title: "Album",
    ...overrides,
  };
}

function saleEvent(overrides: Record<string, unknown> = {}) {
  return {
    artist: "Sale alert",
    capturedAt: "2026-07-13T12:00:00.000Z",
    id: "sale-store",
    opportunityType: "sitewide_sale",
    purchasePrice: 0,
    saleDiscountPercent: 40,
    saleEvidence: "Banner: 40% off all vinyl.",
    saleFingerprint: "store-sale-40",
    saleScope: "vinyl-wide",
    saleSignal: "Store has 40% off all vinyl.",
    saleVerification: "retailer-page",
    sourceId: "store",
    sourceName: "Store",
    sourceUrl: "https://store.example/collections/sale",
    title: "40%+ sale: Store",
    ...overrides,
  };
}

function sourceReport(status: string) {
  return {
    candidateCount: 1,
    catalogHealth: "healthy",
    catalogPageAvailableCount: 1,
    crawlType: "retailer",
    id: "store",
    productParseHealth: "productive",
    salePageHealth: { status },
    status: status === "healthy" ? "empty" : "partial",
  };
}

function emptyLedger(runId: string, updatedAt: string) {
  return {
    campaigns: [],
    history: [],
    runId,
    schemaVersion: 1,
    updatedAt,
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
