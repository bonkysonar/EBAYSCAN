import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PriceClusterSummary } from "../components/PriceClusterSummary";
import type { DiscogsMarketSnapshot, DiscogsSalesStats } from "../lib/ebay/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("PriceClusterSummary manual Discogs pressing", () => {
  it("automatically sends each matched release to the persistent Discogs helper", () => {
    vi.useFakeTimers();
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);

    renderSummary(vi.fn(), {
      suggestedPrice: { currency: "USD", value: 12.34 },
      suggestedPriceCondition: "Very Good (VG)",
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(container?.textContent).toContain("Discogs Price Guide");
    expect(container?.textContent).toContain("$12.34 USD");
    expect(container?.textContent).toContain("loaded automatically");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseUrl: "https://www.discogs.com/release/1-Original-Pressing",
        type: "record-scanner-discogs-helper-request",
      }),
      window.location.origin,
    );
    const request = postMessage.mock.calls[0][0] as { token: string };
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            helperVersion: "0.2.0",
            token: request.token,
            type: "record-scanner-discogs-helper-status",
          },
          origin: window.location.origin,
        }),
      );
    });
    expect(container?.textContent).toContain("v0.2.0 is outdated");
    vi.useRealTimers();
  });

  it("does not reopen the helper after historical stats are already present", () => {
    vi.useFakeTimers();
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);

    renderSummary(vi.fn(), {
      salesStats: {
        importedAt: "2026-07-13T18:00:00.000Z",
        medianPrice: { currency: "USD", value: 12.34 },
        source: "browser_extension",
      },
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(postMessage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

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

function renderSummary(
  onDiscogsPressingAccept: (pressing: {
    matchedTitle?: string;
    releaseId?: number;
    releaseUrl: string;
    salesStats?: DiscogsSalesStats;
  }) => void,
  overrides: Partial<DiscogsMarketSnapshot> = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const discogs: DiscogsMarketSnapshot = {
    confidence: "high",
    matchedTitle: "Original Pressing",
    releaseId: 1,
    releaseUrl: "https://www.discogs.com/release/1-Original-Pressing",
    status: "available",
    warnings: [],
    ...overrides,
  };

  act(() => {
    root?.render(
      <PriceClusterSummary
        discogs={discogs}
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
