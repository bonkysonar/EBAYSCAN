import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewedRetailOffers } from "../../scripts/lib/reviewedRetailOffers.mjs";
import { mergeVerifiedSourceUpdates } from "../server/retailSourceUpdates";
import { readLatestArbitrageFinds, uploadArbitrageFinds } from "../server/arbitrageFindsApi";
vi.mock("../lib/arbitrage/vinylShopSources", () => ({ getActiveRetailSources: () => [{ id: "best-buy" }] }));

const now = new Date().toISOString();
const observed = new Date(Date.parse(now) - 45 * 60000).toISOString();
const page = { sourceId: "best-buy", artist: "Test Artist", title: "Test Album", capturedAt: observed,
  url: "https://www.bestbuy.com/product/test-album/ABC123/sku/12345678",
  text: "# Test Album [Blue Smoke 2 LP] [VINYL]\nSKU: 12345678\nSold by Best Buy\nArtist\nTest Artist\nAvailability\n$20.00\n$5.00 shipping to 00000\nAdd to cart",
  shippingPolicy: { capturedAt: observed, url: "https://www.bestbuy.com/site/help-topics/free-shipping/pcmcat276800050002.c?id=pcmcat276800050002",
    text: "Free standard shipping on orders $35 and up. Free shipping is not available for Marketplace Products. The total is after coupons and before taxes." } };
const offer = reviewedRetailOffers({ version: 1, captureMethod: "public_page_reader", pages: [page] }, now)[0];
const payload = { createdAt: now, finds: [offer], publicationMode: "source_updates" as const,
  sourceUpdateVersion: 1, phase: "final", publicationStatus: "final", runId: "reviewed-offer-test", schemaVersion: 2,
  source: "daily-vinyl-retail-arbitrage-scan", saleObservations: [], saleEvents: [],
  runManifest: { scannedSourceCount: 1, sourceCatalogCount: 1, requestedSourceIds: ["best-buy"] },
  sourceReports: [{ id: "best-buy", catalogHealth: "healthy", catalogPageAvailableCount: 1,
    productParseHealth: "productive", evidenceScope: "observed_public_pages_only", scanComplete: false,
    resolvedUrls: [offer.sourceUrl] }] };

describe("reviewed offer publication", () => {
  let workspace: string;
  const token = process.env.ARBITRAGE_UPLOAD_TOKEN, blob = process.env.BLOB_READ_WRITE_TOKEN;
  beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), "reviewed-offer-"));
    process.env.ARBITRAGE_UPLOAD_TOKEN = "test-token"; delete process.env.BLOB_READ_WRITE_TOKEN; });
  afterEach(() => { rmSync(workspace, { recursive: true, force: true });
    if (token === undefined) delete process.env.ARBITRAGE_UPLOAD_TOKEN; else process.env.ARBITRAGE_UPLOAD_TOKEN = token;
    if (blob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = blob; });

  it("keeps a primary-page offer through upload, storage and the public latest API", async () => {
    await uploadArbitrageFinds(workspace, payload, "test-token");
    const latest = await readLatestArbitrageFinds(workspace);
    expect(latest).toMatchObject({ status: "available", payload: {
      finds: [expect.objectContaining({ id: offer.id, purchasePrice: 20, capturedAt: observed,
        retailObservationMethod: "public_page_reader", shippingOffer: offer.shippingOffer })],
      sourceReports: [expect.objectContaining({ verifiedAt: observed, scanComplete: false })],
    } });
  });
  it("rejects altered prices, dates, shipping terms, missing provenance and stale observations", () => {
    for (const change of [
      { purchasePrice: 1 }, { capturedAt: now }, { sourceUrl: "https://example.com/album" },
      { costs: { inboundShipping: 0 } }, { reviewedRetailEvidence: undefined },
      { shippingOffer: { ...offer.shippingOffer!, minimumSubtotal: 1 } },
      { reviewedRetailEvidence: { ...page, capturedAt: new Date(Date.parse(now) - 7 * 3600000).toISOString() } },
    ]) expect(mergeVerifiedSourceUpdates({ ...payload, finds: [{ ...offer, ...change }] }, null, ["best-buy"], Date.parse(now)).finds).toHaveLength(0);
    expect(mergeVerifiedSourceUpdates({ ...payload, sourceReports: [{ ...payload.sourceReports[0], resolvedUrls: [] }] }, null, ["best-buy"], Date.parse(now)).finds).toHaveLength(0);
  });
});
