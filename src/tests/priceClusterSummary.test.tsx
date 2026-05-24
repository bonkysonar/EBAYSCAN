import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PriceClusterSummary } from "../components/PriceClusterSummary";
import type { DiscogsSalesStats } from "../lib/ebay/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("PriceClusterSummary manual Discogs pressing", () => {
  it("accepts three different Discogs pressing URLs even when stats are blocked", async () => {
    const onAccept = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Discogs blocked the automatic page pull (403)." }), { status: 502 })));
    renderSummary(onAccept);

    await applyPressingUrl("https://www.discogs.com/release/8769631-Various-Pebbles-Vol-One");
    await applyPressingUrl("https://www.discogs.com/release/249504-Fleetwood-Mac-Rumours");
    await applyPressingUrl("https://www.discogs.com/release/367963-Michael-Jackson-Thriller");

    const callsWithoutStats = onAccept.mock.calls.filter(([pressing]) => pressing.salesStats === undefined);
    expect(callsWithoutStats).toHaveLength(3);
    expect(callsWithoutStats.map(([pressing]) => pressing.releaseId)).toEqual([8769631, 249504, 367963]);
  });
});

function renderSummary(onDiscogsPressingAccept: (pressing: {
  matchedTitle?: string;
  releaseId?: number;
  releaseUrl: string;
  salesStats?: DiscogsSalesStats;
}) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <PriceClusterSummary
        discogs={{
          confidence: "high",
          matchedTitle: "Original Pressing",
          releaseId: 1,
          releaseUrl: "https://www.discogs.com/release/1-Original-Pressing",
          status: "available",
          warnings: [],
        }}
        onDiscogsPressingAccept={onDiscogsPressingAccept}
        summary={{
          averageCheapestTenTotalPrice: 10,
          cheapestTenCount: 10,
          highOutlierCount: 0,
          lowestTotalPrice: 8,
          medianTotalPrice: 12,
          priceSpread: 4,
          relevantResultCount: 6,
          resultCount: 6,
          sameTitleClusterCount: 6,
          trimmedMedianTotalPrice: 12,
        }}
      />,
    );
  });
}

async function applyPressingUrl(url: string) {
  const input = container?.querySelector<HTMLInputElement>('input[placeholder="Paste Discogs /release/ URL"]');
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((candidate) =>
    candidate.textContent?.includes("Apply Pressing URL"),
  );
  expect(input).toBeTruthy();
  expect(button).toBeTruthy();

  await act(async () => {
    setNativeInputValue(input!, url);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}
