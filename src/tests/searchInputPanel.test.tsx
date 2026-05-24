import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInputPanel } from "../components/SearchInputPanel";
import type { SearchInput } from "../lib/ebay/types";

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
});

function renderSearchPanel(onSearch = vi.fn<(input: SearchInput) => void>()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(<SearchInputPanel isSearching={false} onSearch={onSearch} />);
  });

  return { container, onSearch };
}

async function enterText(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    setNativeInputValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await nextFrame();
  });
}

describe("SearchInputPanel focus workflow", () => {
  it("submits catalog searches with Enter, clears the field, and keeps catalog focused", async () => {
    const { container, onSearch } = renderSearchPanel();
    const catalog = container.querySelector<HTMLInputElement>("#catalog");
    expect(catalog).toBeTruthy();

    await enterText(catalog!, "ECM 1 1216");

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ catalogNumber: "ECM 1 1216", type: "catalog" }));
    expect(catalog?.value).toBe("");
    expect(document.activeElement).toBe(catalog);
  });

  it("refocuses the last Enter-submitted input when the Discogs helper asks for focus back", async () => {
    const { container } = renderSearchPanel();
    const manual = container.querySelector<HTMLInputElement>("#manual");
    const barcode = container.querySelector<HTMLInputElement>("#barcode");
    expect(manual).toBeTruthy();
    expect(barcode).toBeTruthy();

    await enterText(manual!, "Asia Asia");
    barcode?.focus();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("record-scanner-refocus-last-input"));
      await nextFrame();
    });

    expect(document.activeElement).toBe(manual);
  });
});

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}
