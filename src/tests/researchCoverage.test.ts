import { describe, expect, it } from "vitest";
import { publishedResearchProgress } from "../lib/arbitrage/researchCoverage.mjs";
import { mergeVerifiedSourceUpdates } from "../server/retailSourceUpdates";
import type { ArbitrageFind, ArbitrageImportPayload } from "../lib/arbitrage/types";
const at = "2026-10-03T18:00:00Z", now = Date.parse(at);
const find = { id: "retained", sourceId: "older-source", artist: "Artist", title: "Album", sourceName: "Store", sourceUrl: "https://store.example/product/album", purchasePrice: 10, capturedAt: at, ebayResearchCompletionVersion: 2, ebayResearchSearchComplete: true, ebayResearchUpdatedAt: at, ebayResearchStatus: "validated", ebayResearchRows: [{ title: "Artist Album LP", totalSold: 3 }] } as ArbitrageFind;
describe("published research coverage", () => {
  it("keeps retained products in the denominator after a campaign-only source refresh", () => {
    const incoming = { createdAt: at, finds: [], publicationMode: "source_updates", sourceUpdateVersion: 1,
      runManifest: { scannedSourceCount: 1, sourceCatalogCount: 2 },
      sourceReports: [{ id: "refreshed-source", catalogHealth: "not_attempted", salePageHealth: "healthy", salePageAvailableCount: 1 }],
      researchProgress: { ...publishedResearchProgress([], now) },
    } as ArbitrageImportPayload;
    const result = mergeVerifiedSourceUpdates(incoming, { createdAt: at, finds: [find] }, ["older-source", "refreshed-source"], now);
    expect(result.researchProgress).toMatchObject({ scope: "visible_report", planned: 1, completed: 1, validated: 1 });
    expect(result.latestUpdateResearchProgress?.planned).toBe(0);
    expect(result.researchQueue).toBeUndefined();
  });
  it("does not trust legacy completion flags or stale captures", () => {
    expect(publishedResearchProgress([{ ...find, ebayResearchCompletionVersion: undefined }, { ...find, id: "stale", ebayResearchUpdatedAt: "2026-09-01T00:00:00Z" }], now)).toMatchObject({ planned: 2, completed: 0, pending: 2 });
  });
  it("distinguishes a complete empty search from positive matched sales", () => {
    expect(publishedResearchProgress([{ ...find, ebayResearchStatus: "no_rows", ebayResearchRows: [] }], now)).toMatchObject({ completed: 1, noRows: 1, validated: 0, complete: true });
  });
});
