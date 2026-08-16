import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VinylLotFinder } from "../components/VinylLotFinder";
import { VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY } from "../lib/vinylLots/scanAccess";
import type { VinylLotClassification } from "../lib/vinylLots/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("VinylLotFinder", () => {
  it("runs a transient scan and renders qualifying and near-match review groups", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(scanPayload()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await clickButton("Scan now");

    expect(fetchMock).toHaveBeenCalledWith("/api/vinyl-lots/scan", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      excludeSinglesAndFortyFives: true,
      includeUnknownCount: true,
      minimumRecords: 12,
    });
    expect(container?.textContent).toContain("Review first");
    expect(container?.textContent).toContain("Hip-Hop Collection - Lot of 24 LPs VG+");
    expect(container?.textContent).toContain("Smaller near-matches");
    expect(container?.textContent).toContain("Jazz Lot of 14 Miles Davis John Coltrane");
    expect(container?.textContent).toContain("No sold-comparable data or custom price ranking is included");
    expect(container?.textContent).not.toMatch(/undervalued|\bbuy\b|\broi\b|\bprofit\b/i);
  });

  it("removes every listing and review draft when the six-hour display window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(scanPayload()), { status: 200 })));
    renderPage();

    await clickButton("Scan now");
    expect(container?.textContent).toContain("Hip-Hop Collection - Lot of 24 LPs VG+");

    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 60 * 1_000);
    });

    expect(container?.textContent).not.toContain("Hip-Hop Collection - Lot of 24 LPs VG+");
    expect(container?.textContent).not.toContain("Grade this scan for Codex");
    expect(container?.textContent).toContain("expired after six hours");
  });

  it("refuses a response that crosses the eBay-only evidence boundary", async () => {
    const payload = { ...scanPayload(), evidenceScope: "mixed_marketplace_content" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
    renderPage();

    await clickButton("Scan now");

    expect(container?.textContent).not.toContain("Hip-Hop Collection - Lot of 24 LPs VG+");
    expect(container?.textContent).toContain("crossed the eBay-only discovery boundary");
  });

  it("sends a hosted access key only in the authorization header", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(scanPayload()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    const input = container?.querySelector<HTMLInputElement>("#vinyl-lot-access-key");
    expect(input).toBeTruthy();
    await act(async () => {
      setNativeInputValue(input!, "session-key");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButton("Scan now");

    expect(fetchMock).toHaveBeenCalledWith("/api/vinyl-lots/scan", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer session-key" }),
    }));
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("session-key");
    expect(localStorage.getItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY)).toBeNull();
  });

  it("blocks a hosted scan before the request when the access key is missing", async () => {
    vi.stubGlobal("location", { hostname: "ebayscan.vercel.app" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(scanPayload()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await clickButton("Scan now");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Enter the hosted scan access key");
    expect(container?.querySelector<HTMLDetailsElement>(".vinyl-lot-access")?.open).toBe(true);
  });

  it("remembers a hosted key only after a successful scan and can forget it", async () => {
    vi.stubGlobal("location", { hostname: "ebayscan.vercel.app" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(scanPayload()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await enterHostedAccessKey("verified-session-key");
    const remember = container?.querySelector<HTMLInputElement>("#vinyl-lot-remember-access-key");
    expect(remember).toBeTruthy();
    await act(async () => {
      remember?.click();
    });

    await clickButton("Scan now");

    expect(localStorage.getItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY)).toBe("verified-session-key");
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    const reloadedContainer = renderPage();
    expect(reloadedContainer.querySelector<HTMLInputElement>("#vinyl-lot-access-key")?.value).toBe("verified-session-key");
    expect(reloadedContainer.querySelector<HTMLInputElement>("#vinyl-lot-remember-access-key")?.checked).toBe(true);

    await clickButton("Forget saved key");

    expect(localStorage.getItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY)).toBeNull();
    expect(reloadedContainer.querySelector<HTMLInputElement>("#vinyl-lot-access-key")?.value).toBe("");
  });

  it("clears a rejected saved key and reopens the access panel", async () => {
    vi.stubGlobal("location", { hostname: "ebayscan.vercel.app" });
    localStorage.setItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY, "stale-session-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized vinyl-lot scan request." }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await clickButton("Scan now");

    expect(fetchMock).toHaveBeenCalledWith("/api/vinyl-lots/scan", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer stale-session-key" }),
    }));
    expect(localStorage.getItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY)).toBeNull();
    expect(container?.querySelector<HTMLInputElement>("#vinyl-lot-access-key")?.value).toBe("");
    expect(container?.querySelector<HTMLDetailsElement>(".vinyl-lot-access")?.open).toBe(true);
    expect(container?.textContent).toContain("access key was rejected");
  });

  it("collects every result rating plus an overall grade before preparing a local Codex handoff", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes("/feedback")) {
        return new Response(JSON.stringify({
          codexPrompt: "Review local feedback packet.",
          codexUrl: "codex://new?prompt=Review%20local%20feedback",
          feedbackId: "feedback-1",
          feedbackPath: "C:\\feedback\\feedback-1.json",
          message: "Saved locally.",
          storage: "local-device",
        }), { status: 200 });
      }
      return new Response(JSON.stringify(scanPayload()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPage();
    await clickButton("Scan now");

    changeSelectByLabel("Score Hip-Hop Collection - Lot of 24 LPs VG+", "8");
    changeTextareaByLabel("Explanation Hip-Hop Collection - Lot of 24 LPs VG+", "This is a useful real collection.");
    changeSelectByLabel("Score Jazz Lot of 14 Miles Davis John Coltrane", "3");
    changeTextareaByLabel("Explanation Jazz Lot of 14 Miles Davis John Coltrane", "Count is too small for this custom scan.");
    const overallSelect = container?.querySelector<HTMLSelectElement>(".vinyl-lot-feedback-overall select");
    const overallTextarea = container?.querySelector<HTMLTextAreaElement>(".vinyl-lot-feedback-overall textarea");
    expect(overallSelect).toBeTruthy();
    expect(overallTextarea).toBeTruthy();
    await act(async () => {
      setNativeSelectValue(overallSelect!, "6");
      overallSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      setNativeTextareaValue(overallTextarea!, "Mixed scan, but the feedback loop is usable.");
      overallTextarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await clickButton("Save & open in Codex");

    const feedbackCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/feedback"));
    expect(feedbackCall).toBeTruthy();
    const submitted = JSON.parse(String(feedbackCall?.[1]?.body));
    expect(submitted.listings).toHaveLength(2);
    expect(submitted.overall).toEqual({ note: "Mixed scan, but the feedback loop is usable.", score: 6 });
    expect(JSON.stringify(submitted)).not.toContain("quoted shipping");
    expect(openMock).toHaveBeenCalledWith(expect.stringMatching(/^codex:\/\/new/), "_blank", "noopener,noreferrer");
    expect(container?.textContent).toContain("Saved locally");
  });

  it("clearly labels the hosted browser fallback and never posts feedback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T13:00:00.000Z"));
    vi.stubGlobal("location", { hostname: "record-scanner.vercel.app" });
    vi.stubGlobal("crypto", webcrypto);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(scanPayload()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPage();
    await enterHostedAccessKey("hosted-session-key");
    await clickButton("Scan now");

    expect(container?.textContent).toContain("Hosted fallback · browser-local learning");
    expect(container?.textContent).toContain("then press Send in Codex");
    changeSelectByLabel("Score Hip-Hop Collection - Lot of 24 LPs VG+", "8");
    changeTextareaByLabel("Explanation Hip-Hop Collection - Lot of 24 LPs VG+", "This is a useful real collection.");
    changeSelectByLabel("Score Jazz Lot of 14 Miles Davis John Coltrane", "3");
    changeTextareaByLabel("Explanation Jazz Lot of 14 Miles Davis John Coltrane", "Count is too small for this custom scan.");
    const overallSelect = container?.querySelector<HTMLSelectElement>(".vinyl-lot-feedback-overall select");
    const overallTextarea = container?.querySelector<HTMLTextAreaElement>(".vinyl-lot-feedback-overall textarea");
    act(() => {
      setNativeSelectValue(overallSelect!, "6");
      overallSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      setNativeTextareaValue(overallTextarea!, "The hosted feedback handoff is usable.");
      overallTextarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await clickButton("Save in browser & open Codex");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/feedback"))).toBe(false);
    expect(localStorage.getItem("record-scanner-vinyl-lot-feedback-browser-v1")).toBeTruthy();
    expect(container?.textContent).toContain("Saved in this browser");
    expect(openMock).toHaveBeenCalledWith(expect.stringMatching(/^codex:\/\/new/), "_blank", "noopener,noreferrer");
  });
});

function renderPage(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<VinylLotFinder />));
  return container;
}

async function clickButton(label: string) {
  const button = [...(container?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}

async function enterHostedAccessKey(value: string) {
  const input = container?.querySelector<HTMLInputElement>("#vinyl-lot-access-key");
  expect(input).toBeTruthy();
  await act(async () => {
    setNativeInputValue(input!, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function changeSelectByLabel(label: string, value: string) {
  const select = container?.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  expect(select).toBeTruthy();
  act(() => {
    setNativeSelectValue(select!, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function changeTextareaByLabel(label: string, value: string) {
  const textarea = container?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  expect(textarea).toBeTruthy();
  act(() => {
    setNativeTextareaValue(textarea!, value);
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
}

function scanPayload() {
  const observedAt = new Date(Date.now());
  const expiresAt = new Date(observedAt.getTime() + 6 * 60 * 60 * 1_000);
  const itemCreationDate = new Date(observedAt.getTime() - 2 * 60 * 60 * 1_000).toISOString();
  const classification = (status: "qualifying" | "near-match", count: number, genre: "hip-hop" | "instrumental-jazz"): VinylLotClassification => ({
    collection: { confidence: "high", evidence: `Lot of ${count}`, isCollection: true },
    condition: { confidence: "medium", evidence: status === "qualifying" ? "VG+" : null, level: status === "qualifying" ? "supported-vg-plus" : "unknown" },
    flags: status === "near-match" ? ["near-match-size", "condition-unverified"] : [],
    genre: { confidence: "high", matchesTarget: true, primary: genre, searchGenre: genre, signals: [genre] },
    priorityArtistMatches: genre === "instrumental-jazz" ? ["Miles Davis"] : [],
    quantity: { confidence: "high", count, evidence: `Lot of ${count}`, meetsMinimum: count >= 20, nearMatch: count < 20, source: "title" },
    reviewReasons: status === "near-match" ? [{ code: "near-match-size", message: "Below the normal 20-record threshold." }] : [],
    status,
  });
  return {
    categoryId: "176985",
    complete: true,
    diagnostics: {
      classificationCounts: { "near-match": 1, qualifying: 1, rejected: 7, review: 0 },
      duplicateCount: 1,
      families: [
        { error: null, httpStatus: 200, id: "hip-hop-lots", label: "Hip-hop", phase: "primary", query: "hip hop", returnedCount: 5, status: "available", targetGenre: "hip-hop", totalReported: 5, warnings: [] },
      ],
      genreCoverage: [
        { displayedCount: 1, genre: "hip-hop", label: "Hip-hop", rawUniqueCount: 12, retainedCount: 10, status: "ok", targetCount: 10 },
        { displayedCount: 1, genre: "instrumental-jazz", label: "Instrumental jazz", rawUniqueCount: 11, retainedCount: 10, status: "ok", targetCount: 10 },
      ],
      invalidSummaryCount: 0,
      limits: { concurrency: 2, maxBrowseCalls: 4, pageSize: 50, requestTimeoutMs: 6000 },
      rawSummaryCount: 10,
      requestsMade: 4,
      requestMode: "bounded-concurrent",
    },
    evidenceScope: "active_ebay_listings_only",
    expiresAt: expiresAt.toISOString(),
    filters: { buyingOptions: ["FIXED_PRICE", "BEST_OFFER"], condition: "USED", fieldgroups: ["EXTENDED"], itemLocationCountry: "US", sort: "newlyListed" },
    listings: [
      listing("lot-1", "Hip-Hop Collection - Lot of 24 LPs VG+", classification("qualifying", 24, "hip-hop"), itemCreationDate),
      listing("lot-2", "Jazz Lot of 14 Miles Davis John Coltrane", classification("near-match", 14, "instrumental-jazz"), itemCreationDate),
    ],
    marketplaceId: "EBAY_US",
    observedAt: observedAt.toISOString(),
    scanOptions: {
      customQueries: {},
      excludeSinglesAndFortyFives: true,
      genres: ["hip-hop", "instrumental-jazz"],
      includeUnknownCount: true,
      minimumRecords: 20,
      priorityArtists: [],
      resultsPerGenre: 12,
    },
    schemaVersion: 2,
    soldDataIncluded: false,
    source: "ebay-browse",
    storage: "transient-no-persistence",
    warnings: [],
  };
}

function listing(itemId: string, title: string, classification: VinylLotClassification, itemCreationDate: string) {
  return {
    buyingOptions: ["FIXED_PRICE"],
    classification,
    condition: "Used",
    conditionId: "3000",
    imageUrl: null,
    itemCreationDate,
    itemId,
    itemLocationCountry: "US",
    itemLocationRegion: "CA",
    itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
    matchedGenres: [classification.genre.primary as "hip-hop" | "instrumental-jazz"],
    matchedSearchFamilyIds: [],
    price: { currency: "USD", value: "75.00" },
    seller: { feedbackPercentage: "100.0", feedbackScore: 123, username: "seller" },
    shippingCost: { currency: "USD", value: "12.00" },
    shortDescription: null,
    title,
  };
}
