import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    sourceReports: [],
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

function saleEvent() {
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
  };
}

function sourceReport(status: string) {
  return {
    id: "store",
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
