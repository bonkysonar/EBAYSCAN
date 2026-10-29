import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetailScanStatus } from "../components/RetailScanStatus";
import type { ArbitrageResearchProgress } from "../lib/arbitrage/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});
const progress: ArbitrageResearchProgress = {
  planned: 240, completed: 0, validated: 0, noRows: 0, failed: 0, pending: 240,
  researchedRows: 0, limit: 240, outsidePlan: 12, complete: false, status: "incomplete",
};
describe("sold research progress visibility", () => {
  it("keeps pending and deferred work visible after publication", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "published", researchProgress: progress }) })));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{ createdAt: "2026-09-05T01:00:00Z", finds: [] }} />));
    expect(container.textContent).toContain("Latest attempt sold research: 0/240 offers researched");
    expect(container.textContent).toContain("240 pending; 0 failed; 12 deferred");
  });
  it("labels persisted publication counts when the latest attempt has no research data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "running" }) })));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{ createdAt: "2026-09-05T01:00:00Z", finds: [], researchProgress: { ...progress, planned: 10, completed: 2, validated: 1, noRows: 1, pending: 8, outsidePlan: 0 } }} />));
    expect(container.textContent).toContain("Published report sold research: 2/10 offers researched; 1 with matching sales; 1 without confirmed matching sales; 8 pending");
  });
  it("distinguishes reused query windows from offer coverage and repairs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "research", researchQueue: { offers: 12, distinctQueries: 8, tasks: 9, reused: 4, repair: 2, refresh: 1, pending: 2, scheduled: 4, retryLater: 1, deferred: 0, editionReviews: 3 } }) })));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{ createdAt: "2026-10-01T14:00:00Z", finds: [] }} />));
    expect(container.textContent).toContain("8 distinct album searches across 12 offers. 4 date-window captures reused; 2 need capture repair");
    expect(container.textContent).toContain("3 need edition identification");
  });
  it("does not let a campaign-only refresh erase the published report's research totals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "partial", researchProgress: { ...progress, planned: 0, completed: 0 } }) })));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{ createdAt: "2026-10-03T14:00:00Z", finds: [], researchProgress: { ...progress, planned: 139, completed: 139, validated: 98, noRows: 41, pending: 0, outsidePlan: 0, complete: true, status: "complete" } }} />));
    expect(container.textContent).toContain("Published report sold research: 139/139 offers researched; 98 with matching sales");
    expect(container.textContent).toContain("Latest attempt: no product research in this update.");
  });
  it("shows the completed source update separately from pending historical offers and source failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "partial", message: "95 sources are blocked or failed." }) })));
    const latestProgress: ArbitrageResearchProgress = { ...progress, planned: 12, completed: 12, validated: 4, noRows: 8, pending: 0, outsidePlan: 0, complete: true, status: "complete" };
    const latestQueue = { offers: 12, distinctQueries: 12, tasks: 12, reused: 12, repair: 0, refresh: 0, pending: 0, scheduled: 0, retryLater: 0, deferred: 0, editionReviews: 0 };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{
      createdAt: "2026-10-29T13:13:16Z", finds: [], publicationMode: "source_updates",
      sourceUpdates: { version: 1, updatedSourceIds: ["retailer-a"], retainedSourceIds: ["retailer-b"], lastBroadScanAt: "2026-10-09T12:33:23Z", lastBroadAttemptAt: "2026-10-29T13:13:16Z" },
      researchProgress: { ...latestProgress, planned: 48, pending: 36, complete: false, status: "incomplete" },
      latestUpdateResearchProgress: latestProgress,
      researchQueue: { ...latestQueue, offers: 48, distinctQueries: 48, pending: 36 },
      latestUpdateResearchQueue: latestQueue,
    }} />));
    expect(container.textContent).toContain("Latest published update sold research: 12/12 offers researched; 4 with matching sales; 8 without confirmed matching sales; 0 pending; 0 failed");
    expect(container.textContent).not.toContain("Published report sold research: 12/48");
    const history = container.querySelector("details");
    expect(history?.open).toBe(false);
    expect(history?.textContent).toContain("These totals include older offers.");
    expect(history?.textContent).toContain("All report observations sold research: 12/48 offers researched; 4 with matching sales; 8 without confirmed matching sales; 36 pending");
    expect(container.textContent).toContain("12 distinct album searches across 12 offers.");
    expect(container.textContent).toContain("Verified retailer updates · partial coverage");
    expect(container.textContent).toContain("95 sources are blocked or failed.");
    expect(container.textContent).toContain("1 sources updated; other observations retain their original dates.");
  });
  it("keeps unresolved work in the latest update visible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{
      createdAt: "2026-10-29T13:13:16Z", finds: [], publicationMode: "source_updates",
      latestUpdateResearchProgress: { ...progress, planned: 12, completed: 9, validated: 4, noRows: 5, pending: 2, failed: 1, outsidePlan: 0 },
    }} />));
    expect(container.textContent).toContain("Latest published update sold research: 9/12 offers researched; 4 with matching sales; 5 without confirmed matching sales; 2 pending; 1 failed");
  });
  it.each([
    { name: "older attempt", startedAt: "2026-10-28T12:00:00Z", updatedAt: "2026-10-28T13:00:00Z", expectedOffers: 12 },
    { name: "attempt last updated before publication", startedAt: "2026-10-29T13:00:00Z", updatedAt: "2026-10-29T13:30:00Z", expectedOffers: 12 },
    { name: "attempt without timestamps", startedAt: undefined, updatedAt: undefined, expectedOffers: 12 },
    { name: "current attempt updated after publication", startedAt: "2026-10-29T13:00:00Z", updatedAt: "2026-10-29T14:02:00Z", expectedOffers: 14 },
  ])("uses queue evidence by recency for $name", async ({ startedAt, updatedAt, expectedOffers }) => {
    const queue = { offers: 12, distinctQueries: 12, tasks: 12, reused: 12, repair: 0, refresh: 0, pending: 0, scheduled: 0, retryLater: 0, deferred: 0, editionReviews: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "research", startedAt, updatedAt, researchQueue: { ...queue, offers: 14, pending: 2 } }) })));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{
      createdAt: "2026-10-29T13:13:16Z", publishedAt: "2026-10-29T14:01:55Z", finds: [],
      latestUpdateResearchQueue: queue,
    }} />));
    expect(container.querySelector('[aria-label="Research queue"]')?.textContent).toContain(`12 distinct album searches across ${expectedOffers} offers.`);
  });
});
