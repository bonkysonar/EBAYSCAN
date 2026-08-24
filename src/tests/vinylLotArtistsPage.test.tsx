import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VinylLotArtists } from "../components/VinylLotArtists";
import {
  loadVinylLotArtistPreferences,
  VINYL_LOT_ARTIST_STORAGE_KEY,
} from "../lib/vinylLots/artistPreferences";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => localStorage.clear());

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
});

describe("VinylLotArtists", () => {
  it("starts with grouped discovery signals and a clear non-valuation disclaimer", () => {
    renderPage();

    expect(container?.textContent).toContain("Hip-hop");
    expect(container?.textContent).toContain("Classic rock");
    expect(container?.textContent).toContain("1990s rock");
    expect(container?.textContent).toContain("Instrumental jazz");
    expect(container?.textContent).toContain("Miles Davis");
    expect(container?.textContent).toContain("Pearl Jam");
    expect(container?.textContent).toContain("Discovery signal, not a value guarantee");
    expect(container?.textContent).toContain("Singles, 7-inch records");
  });

  it("adds, edits, pauses, changes mode, removes, and persists an artist", () => {
    renderPage();

    changeInput("#new-vinyl-lot-artist-name", "Test Artist");
    changeSelect("#new-vinyl-lot-artist-genre", "instrumental-jazz");
    changeSelect("#new-vinyl-lot-artist-mode", "always-review");
    clickButton("Add artist");

    let saved = loadVinylLotArtistPreferences();
    let artist = saved.find((candidate) => candidate.name === "Test Artist");
    expect(artist).toMatchObject({ enabled: true, genre: "instrumental-jazz", mode: "always-review" });
    expect(localStorage.getItem(VINYL_LOT_ARTIST_STORAGE_KEY)).toBeTruthy();

    clickButton("Edit", "Edit Test Artist");
    changeInput(`[id="edit-vinyl-lot-artist-name-${artist?.id}"]`, "Test Artist Updated");
    changeSelect(`[id="edit-vinyl-lot-artist-genre-${artist?.id}"]`, "hip-hop");
    clickButton("Save changes");

    saved = loadVinylLotArtistPreferences();
    artist = saved.find((candidate) => candidate.id === artist?.id);
    expect(artist).toMatchObject({ name: "Test Artist Updated", genre: "hip-hop" });

    clickCheckbox("Pause Test Artist Updated");
    const modeSelect = container?.querySelector<HTMLSelectElement>(`[id="vinyl-lot-artist-mode-${artist?.id}"]`);
    expect(modeSelect).toBeTruthy();
    act(() => {
      setNativeSelectValue(modeSelect!, "priority");
      modeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    saved = loadVinylLotArtistPreferences();
    artist = saved.find((candidate) => candidate.id === artist?.id);
    expect(artist).toMatchObject({ enabled: false, mode: "priority" });

    clickButton("Remove", "Remove Test Artist Updated");
    expect(loadVinylLotArtistPreferences().some((candidate) => candidate.id === artist?.id)).toBe(false);
  });

  it("preserves an intentionally empty saved list", () => {
    localStorage.setItem(VINYL_LOT_ARTIST_STORAGE_KEY, JSON.stringify({ artists: [], schemaVersion: 1 }));
    expect(loadVinylLotArtistPreferences()).toEqual([]);
  });
});

function renderPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<VinylLotArtists />));
}

function changeInput(selector: string, value: string) {
  const input = container?.querySelector<HTMLInputElement>(selector);
  expect(input).toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function changeSelect(selector: string, value: string) {
  const select = container?.querySelector<HTMLSelectElement>(selector);
  expect(select).toBeTruthy();
  act(() => {
    setNativeSelectValue(select!, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function clickButton(label: string, ariaLabel?: string) {
  const buttons = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const button = buttons.find((candidate) =>
    candidate.textContent === label && (!ariaLabel || candidate.getAttribute("aria-label") === ariaLabel));
  expect(button).toBeTruthy();
  act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function clickCheckbox(ariaLabel: string) {
  const checkbox = container?.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${ariaLabel}"]`);
  expect(checkbox).toBeTruthy();
  act(() => checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
}
