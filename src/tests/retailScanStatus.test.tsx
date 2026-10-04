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
    expect(container.textContent).toContain("Published report sold research: 2/10 offers researched; 1 with matching sales; 1 without matching sales; 8 pending");
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
});
