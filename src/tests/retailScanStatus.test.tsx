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
    expect(container.textContent).toContain("Latest attempt sold research: 0/240 searches completed");
    expect(container.textContent).toContain("240 pending; 0 failed; 12 deferred");
  });
  it("labels persisted publication counts when the latest attempt has no research data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "running" }) })));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<RetailScanStatus payload={{ createdAt: "2026-09-05T01:00:00Z", finds: [], researchProgress: { ...progress, planned: 10, completed: 2, validated: 1, noRows: 1, pending: 8, outsidePlan: 0 } }} />));
    expect(container.textContent).toContain("Published scan sold research: 2/10 searches completed; 1 with matching sales; 1 without matching sales; 8 pending");
  });
});
