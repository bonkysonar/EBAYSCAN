import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

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
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("App Discogs pressing URL fallback", () => {
  it("updates the visible Discogs release immediately for three pasted URLs even when stats are blocked", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/ebay/search")) {
        return new Response(JSON.stringify(searchPayload()), { status: 200 });
      }
      if (String(url).includes("/api/discogs/stats")) {
        return new Response(JSON.stringify({ error: "Discogs blocked the automatic page pull (403)." }), { status: 502 });
      }
      return new Response("{}", { status: 404 });
    }));
    renderApp();

    await submitCatalogSearch();

    await applyPressingUrl("https://www.discogs.com/release/8769631-Various-Pebbles-Vol-One");
    expect(discogsLink()?.href).toBe("https://www.discogs.com/release/8769631-Various-Pebbles-Vol-One");
    expect(container?.textContent).not.toContain("$42.00 USD");
    expect(container?.textContent).not.toContain("$21.00 USD");

    await applyPressingUrl("https://www.discogs.com/release/249504-Fleetwood-Mac-Rumours");
    expect(discogsLink()?.href).toBe("https://www.discogs.com/release/249504-Fleetwood-Mac-Rumours");
    expect(container?.textContent).not.toContain("$42.00 USD");

    await applyPressingUrl("https://www.discogs.com/release/367963-Michael-Jackson-Thriller");
    expect(discogsLink()?.href).toBe("https://www.discogs.com/release/367963-Michael-Jackson-Thriller");
    expect(container?.textContent).not.toContain("$42.00 USD");
  });
});

function renderApp() {
  window.location.hash = "#/scanner";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(<App />);
  });
}

async function submitCatalogSearch() {
  const input = container?.querySelector<HTMLInputElement>("#catalog");
  expect(input).toBeTruthy();
  await act(async () => {
    setNativeInputValue(input!, "BFD-5016");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
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

function discogsLink(): HTMLAnchorElement | null | undefined {
  return container?.querySelector<HTMLAnchorElement>(".discogs-title a");
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}

function searchPayload() {
  return {
    input: { catalogNumber: "BFD-5016", conditionFilter: "used", type: "catalog" },
    listings: [
      {
        condition: "Used",
        currency: "USD",
        id: "listing-1",
        matchSignals: {},
        price: 20,
        shippingPrice: 0,
        source: "ebay",
        title: "Pebbles Vol. One",
        totalPrice: 20,
      },
    ],
    marketSnapshot: {
      discogs: {
        confidence: "high",
        matchedTitle: "Various - Pebbles Vol. One",
        releaseId: 5486280,
        releaseUrl: "https://www.discogs.com/release/5486280-Various-Pebbles-Vol-One",
        salesStats: {
          highPrice: { currency: "USD", value: 55 },
          importedAt: "2026-05-24T10:00:00.000Z",
          lastSold: "May 1, 2026",
          lowPrice: { currency: "USD", value: 12 },
          medianPrice: { currency: "USD", value: 42 },
          source: "page_fetch",
        },
        suggestedPrice: { currency: "USD", value: 21 },
        suggestedPriceCondition: "Very Good (VG)",
        status: "available",
        warnings: [],
      },
    },
    source: "test",
    timestamp: "2026-05-24T10:00:00.000Z",
    warnings: [],
  };
}
