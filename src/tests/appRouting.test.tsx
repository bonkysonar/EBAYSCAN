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

describe("App routing", () => {
  it("keeps Bulk Buy off the default scanner and enables it on the Bulk Buy page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/ebay/search")) {
        return new Response(JSON.stringify(searchPayload()), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    renderApp("#/scanner");

    expect(container?.querySelector("h1")?.textContent).toBe("Record Scanner");
    expect(container?.querySelector(".bulk-buy-panel")).toBeNull();

    await submitCatalogSearch("ABC-123");
    await navigate("#/bulk-buy");

    expect(container?.querySelector("h1")?.textContent).toBe("Bulk Buy Scanner");
    expect(container?.querySelector(".bulk-buy-panel")?.textContent).toContain("0 scanned");

    await submitCatalogSearch("ABC-123");

    expect(container?.querySelector(".bulk-buy-panel")?.textContent).toContain("1 scanned");
    expect(container?.querySelector(".bulk-buy-panel")?.textContent).toContain("Routing Test Record");
  });
});

function renderApp(hash: string) {
  window.location.hash = hash;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(<App />);
  });
}

async function navigate(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await Promise.resolve();
  });
}

async function submitCatalogSearch(catalogNumber: string) {
  const input = container?.querySelector<HTMLInputElement>("#catalog");
  expect(input).toBeTruthy();
  await act(async () => {
    setNativeInputValue(input!, catalogNumber);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
  });
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}

function searchPayload() {
  return {
    input: { catalogNumber: "ABC-123", conditionFilter: "used", type: "catalog" },
    listings: [
      {
        condition: "Used",
        currency: "USD",
        id: "listing-1",
        matchSignals: {},
        price: 16,
        shippingPrice: 4,
        source: "ebay",
        title: "Routing Test Record LP",
        totalPrice: 20,
      },
    ],
    marketSnapshot: {
      discogs: {
        confidence: "high",
        matchedTitle: "Routing Test Record",
        medianPrice: { currency: "USD", value: 18 },
        releaseId: 12345,
        releaseUrl: "https://www.discogs.com/release/12345-Routing-Test-Record",
        status: "available",
        warnings: [],
      },
    },
    source: "test",
    timestamp: "2026-06-22T10:00:00.000Z",
    warnings: [],
  };
}
