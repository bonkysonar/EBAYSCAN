import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetailArbitrage } from "../components/RetailArbitrage";
import { SiteWideSales } from "../components/SiteWideSales";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  vi.useRealTimers();
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("arbitrage pages", () => {
  it("keeps cached buys hidden until the authoritative latest request resolves", async () => {
    localStorage.setItem(
      "record-scanner-arbitrage-finds-v1",
      JSON.stringify([validatedBuyFind()]),
    );
    let resolveLatest: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveLatest = resolve;
          }),
      ),
    );

    await render(<RetailArbitrage />);

    expect(container?.textContent).not.toContain("Runtime Test Album");
    expect(container?.textContent).toContain("Cached recommendations stay hidden");

    await act(async () => {
      resolveLatest?.(
        jsonResponse({ message: "No final publication is available.", status: "empty" }),
      );
      await flushAsyncWork();
    });
  });

  it("clears a previously loaded buy when the latest publication becomes empty", async () => {
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        latestCalls += 1;
        if (latestCalls === 1) {
          return jsonResponse({
            fileName: "retail-arbitrage-test.json",
            payload: {
              createdAt: now(),
              finds: [validatedBuyFind()],
              phase: "final",
              runId: "test-run",
              sourceReports: [],
            },
            status: "available",
          });
        }
        return jsonResponse({ message: "No final publication is available.", status: "empty" });
      }),
    );

    await render(<RetailArbitrage />);
    expect(container?.textContent).toContain("Runtime Test Album");

    await clickButton("Reload scan data");

    expect(container?.textContent).not.toContain("Runtime Test Album");
    expect(container?.textContent).toContain("No final publication is available.");
    expect(container?.textContent).toContain("No record candidates in this run");
  });

  it("keeps the last verified retail publication when a refresh fails", async () => {
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        latestCalls += 1;
        if (latestCalls > 1) return errorResponse("Temporary latest failure.");
        return jsonResponse({
          fileName: "retail-arbitrage-test.json",
          payload: {
            createdAt: now(),
            finds: [validatedBuyFind()],
            phase: "final",
            runId: "test-run",
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<RetailArbitrage />);
    expect(container?.textContent).toContain("Runtime Test Album");

    await clickButton("Reload scan data");

    expect(container?.textContent).toContain("Runtime Test Album");
    expect(container?.textContent).toContain("keeping the last verified publication");
  });

  it("keeps an explicit Shopify vinyl variant visible under mixed CD product metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          fileName: "retail-arbitrage-test.json",
          payload: {
            createdAt: now(),
            finds: [
              {
                ...validatedBuyFind(),
                shopifyVariantTitle: "2xLP",
                sourceListingTitle: "Runtime Test Artist - Runtime Test Album (CD / Vinyl) - 2xLP",
              },
            ],
            phase: "final",
            runId: "test-run",
            sourceReports: [],
          },
          status: "available",
        }),
      ),
    );

    await render(<RetailArbitrage />);

    expect(container?.textContent).toContain("Runtime Test Album");
  });

  it("labels the actual purchase retailer separately from a discovery feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          fileName: "retail-arbitrage-test.json",
          payload: {
            createdAt: now(),
            finds: [
              {
                ...validatedBuyFind(),
                purchaseRetailerDomain: "amazon.com",
                purchaseRetailerName: "Amazon",
                sourceId: "deal-feed",
                sourceName: "Deal Feed",
                sourceUrl: "https://www.amazon.com/dp/example",
              },
            ],
            phase: "final",
            runId: "retailer-attribution-run",
            sourceReports: [],
          },
          status: "available",
        }),
      ),
    );

    await render(<RetailArbitrage />);

    expect(container?.textContent).toContain("Amazon via Deal Feed");
    expect(container?.textContent).toContain("Purchase retailerAmazon");
    expect(container?.textContent).toContain("Open Amazon");
    expect(
      Array.from(container?.querySelectorAll("select") ?? []).some((select) =>
        select.textContent?.includes("Amazon"),
      ),
    ).toBe(true);
  });

  it("shows adaptive priority, turnover, and buy-profile evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          fileName: "retail-arbitrage-test.json",
          payload: {
            createdAt: now(),
            finds: [
              {
                ...validatedBuyFind(),
                artistSoldUnits365Days: 40,
                artistSoldUnits1095Days: 120,
                soldEvidence: {
                  ...validatedBuyFind().soldEvidence,
                  unitsSold1095Days: 96,
                },
              },
            ],
            phase: "final",
            runId: "test-run",
            sourceReports: [],
          },
          status: "available",
        }),
      ),
    );

    await render(<RetailArbitrage />);

    expect(container?.querySelector(".arbitrage-sort.active")?.textContent).toContain("Priority");
    expect(container?.textContent).toContain("Band");
    expect(container?.textContent).toContain("Buy options");
    expect(container?.textContent).toContain("Fast turn / smaller margin");
    expect(container?.textContent).toContain("Balanced buy");
    expect(container?.textContent).toContain("Slower / higher margin");
    expect(container?.textContent).toContain("Profit / 30 days");
    expect(container?.textContent).toContain("Long-term velocity");
    expect(container?.textContent).toContain("Adaptive buy profiles");
  });

  it("releases dismissal and outcome feedback when the retail offer price changes", async () => {
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        latestCalls += 1;
        return jsonResponse({
          fileName: `retail-arbitrage-${latestCalls}.json`,
          payload: {
            createdAt: now(),
            finds: [validatedBuyFind(11 - latestCalls)],
            phase: "final",
            runId: `test-run-${latestCalls}`,
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<RetailArbitrage />);
    await clickButton("Dismiss");
    expect(container?.textContent).not.toContain("Runtime Test Album");

    await clickButton("Reload scan data");
    expect(container?.textContent).toContain("Runtime Test Album");

    await clickButton("False positive");
    expect(container?.textContent).not.toContain("Runtime Test Album");

    await clickButton("Reload scan data");
    expect(container?.textContent).toContain("Runtime Test Album");
  });

  it("re-scores retail evidence on the clock and polls for a fresh publication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    localStorage.setItem(
      "record-scanner-arbitrage-settings-v1",
      JSON.stringify({ maxOfferAgeDays: 0 }),
    );
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        latestCalls += 1;
        return jsonResponse({
          fileName: `retail-arbitrage-${latestCalls}.json`,
          payload: {
            createdAt: now(),
            finds: [validatedBuyFind()],
            phase: "final",
            runId: `test-run-${latestCalls}`,
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<RetailArbitrage />);
    expect(container?.textContent).toContain("Runtime Test Album");

    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await flushAsyncWork();
    });
    expect(container?.textContent).toContain("Runtime Test Album");
    expect(container?.textContent).toContain("Needs validation");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      await flushAsyncWork();
    });
    expect(latestCalls).toBe(2);
    expect(container?.textContent).toContain("Runtime Test Album");
  });

  it("refreshes and re-scores retail data when the window regains focus", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        latestCalls += 1;
        return jsonResponse({
          fileName: `retail-arbitrage-${latestCalls}.json`,
          payload: {
            createdAt: now(),
            finds: [validatedBuyFind()],
            phase: "final",
            runId: `test-run-${latestCalls}`,
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<RetailArbitrage />);
    expect(latestCalls).toBe(1);

    vi.setSystemTime(new Date("2026-07-16T12:05:00.000Z"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await flushAsyncWork();
    });

    expect(latestCalls).toBe(2);
  });

  it("shows parser-empty product sources as degraded instead of healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          fileName: "retail-arbitrage-coverage.json",
          payload: {
            createdAt: now(),
            finds: [validatedBuyFind()],
            phase: "final",
            runId: "coverage-run",
            runQuality: {
              directCatalogCoverageCount: 2,
              directProductiveSourceCount: 1,
              directSourceCount: 2,
              publishable: true,
              reasons: ["Only 50% of direct retailers produced parsed products; target is 40%."],
              status: "degraded",
            },
            selectionDiagnostics: {
              eligibleSourceCount: 2,
              largestSourceShare: 1,
              representedSourceCount: 1,
            },
            sourceReports: [
              {
                candidateCount: 1,
                catalogHealth: "healthy",
                catalogPageAvailableCount: 1,
                highSignalCandidateCount: 1,
                id: "runtime-store",
                name: "Runtime Records",
                priority: 1,
                productParseHealth: "productive",
                salePageHealth: "not_checked",
                selectedProductFindCount: 1,
                status: "candidates",
                usableCoverage: "selected",
              },
              {
                candidateCount: 0,
                catalogHealth: "healthy",
                catalogPageAvailableCount: 1,
                highSignalCandidateCount: 0,
                id: "empty-store",
                name: "HTTP Healthy Empty Store",
                priority: 1,
                productParseHealth: "empty",
                salePageHealth: "not_checked",
                selectedProductFindCount: 0,
                status: "empty",
                usableCoverage: "parser_empty",
              },
            ],
          },
          status: "available",
        }),
      ),
    );

    await render(<RetailArbitrage />);

    const productCoverage = Array.from(
      container?.querySelectorAll<HTMLElement>(".seller-stat") ?? [],
    ).find((stat) => stat.textContent?.includes("Product coverage"));
    expect(productCoverage?.textContent).toContain("1/2");
    expect(container?.textContent).toContain("1 healthy · 1 degraded · 0 blocked");
    expect(container?.textContent).toContain("Product yield 1/2; 1 parser-empty, 0 unavailable.");
    expect(container?.textContent).toContain("Degraded run · catalog reach 2/2");
    expect(container?.textContent).toContain("Selected from 1/2 eligible sources; largest source 100%");
    expect(container?.textContent).toContain("What the scanner actually checked");
    expect(container?.textContent).toContain("Runtime Records");
    expect(container?.textContent).toContain("HTTP Healthy Empty Store");
    expect(container?.textContent).toContain("zero qualifying products parsed");
  });

  it("shows the newest campaign transition even when embedded history arrives oldest-first", async () => {
    const campaign = saleCampaign();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/history")) {
          return jsonResponse({
            campaigns: [campaign],
            events: [
              transition("older", "first_seen", "2026-07-10T12:00:00.000Z"),
              transition("newer", "discount_changed", "2026-07-15T12:00:00.000Z"),
            ],
            runId: "sale-run",
            status: "available",
            summary: { changed: 1 },
            updatedAt: "2026-07-15T12:00:00.000Z",
          });
        }
        return jsonResponse({
          fileName: "retail-arbitrage-sales.json",
          payload: {
            createdAt: "2026-07-15T12:00:00.000Z",
            finds: [],
            phase: "final",
            runId: "sale-run",
            saleCampaignLedger: {
              campaigns: [campaign],
              history: [],
            },
            saleEvents: [campaign],
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<SiteWideSales />);

    const card = container?.querySelector(".site-sale-card");
    expect(card?.textContent).toContain("Discount changed");
    expect(card?.textContent).not.toContain("First seen ·");
  });

  it("labels exact and up-to discounts without overstating either offer", async () => {
    const exact = saleCampaign();
    const upTo = {
      ...saleCampaign(),
      id: "sale-store-up-to",
      saleCampaignId: "campaign-up-to",
      saleDiscountPercent: 50,
      saleDiscountQualifier: "up_to" as const,
      saleEvidence: "Save up to 50% off select vinyl.",
      saleSignal: "Up to 50% off select vinyl.",
      sourceId: "up-to-store",
      sourceName: "Up To Store",
      sourceUrl: "https://up-to-store.example/sale",
      title: "Up to 50% off sale",
    };
    const campaigns = [exact, upTo];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/history")) {
          return jsonResponse({
            campaigns,
            events: [],
            runId: "discount-labels",
            status: "available",
            summary: { changed: 2 },
            updatedAt: "2026-07-15T12:00:00.000Z",
          });
        }
        return jsonResponse({
          fileName: "retail-arbitrage-sales.json",
          payload: {
            createdAt: "2026-07-15T12:00:00.000Z",
            finds: [],
            phase: "final",
            runId: "discount-labels",
            saleCampaignLedger: { campaigns, history: [] },
            saleEvents: campaigns,
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<SiteWideSales />);

    expect(container?.textContent).toContain("40% off");
    expect(container?.textContent).toContain("Up to 50% off");
    expect(container?.textContent).not.toMatch(/\d+%\+/);
  });

  it("shows every active offer by default and separates raw observations from offers and retailers", async () => {
    const changed = {
      ...saleCampaign(),
      saleCampaignId: "campaign-changed",
      sourceUrl: "https://sale-store.example/collections/summer-sale",
    };
    const changedPageFragment = {
      ...changed,
      id: "sale-store-page-two",
      saleCampaignId: "campaign-changed-page-two",
      sourceUrl: "https://sale-store.example/collections/summer-sale/format_tape?page=2&sort_by=best-selling",
    };
    const ongoing = {
      ...saleCampaign(),
      id: "ongoing-store",
      saleCampaignId: "campaign-ongoing",
      saleStatus: "ongoing",
      sourceId: "ongoing-store",
      sourceName: "Ongoing Store",
      sourceUrl: "https://ongoing.example/clearance",
    };
    const evergreen = {
      ...saleCampaign(),
      id: "evergreen-store",
      saleCampaignId: "campaign-evergreen",
      saleStatus: "evergreen",
      sourceId: "evergreen-store",
      sourceName: "Evergreen Store",
      sourceUrl: "https://evergreen.example/sale",
    };
    const campaigns = [changed, changedPageFragment, ongoing, evergreen];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          fileName: "retail-arbitrage-sales.json",
          payload: {
            createdAt: "2026-07-15T12:00:00.000Z",
            finds: [],
            phase: "final",
            saleCampaignLedger: { campaigns, history: [] },
            saleEvents: campaigns,
            saleObservations: campaigns,
            sourceReports: [
              { id: "healthy", name: "Healthy", productParseHealth: "productive", status: "candidates" },
              {
                catalogHealth: "healthy",
                catalogPageAttemptCount: 2,
                id: "empty",
                name: "Empty",
                productParseHealth: "empty",
                status: "empty",
              },
              { catalogHealth: "failed", id: "blocked", name: "Blocked", status: "error" },
              {
                catalogHealth: "healthy",
                catalogPageAvailableCount: 1,
                id: "sale-pages-failed",
                name: "Sale Pages Failed",
                pageErrors: [{ failureKind: "timeout" }],
                salePageHealth: "failed",
                status: "partial",
              },
            ],
          },
          status: "available",
        }),
      ),
    );

    await render(<SiteWideSales />);

    expect(container?.querySelectorAll(".site-sale-card")).toHaveLength(3);
    expect(siteSaleStat("Active retailers")).toBe("3");
    expect(siteSaleStat("Unique offers")).toBe("3");
    expect(siteSaleStat("Raw observations")).toBe("4");
    expect(siteSaleStat("Healthy")).toBe("1");
    expect(siteSaleStat("Empty")).toBe("1");
    expect(siteSaleStat("Blocked")).toBe("1");
    expect(siteSaleStat("Degraded")).toBe("1");
    const failedSaleSource = Array.from(container?.querySelectorAll<HTMLAnchorElement>(".site-sale-coverage-list a") ?? [])
      .find((anchor) => anchor.textContent?.includes("Sale Pages Failed"));
    expect(failedSaleSource?.textContent).toContain("sale-page checks failed");
    expect(failedSaleSource?.textContent).not.toContain("pages reached");
    const shelves = Array.from(container?.querySelectorAll<HTMLDetailsElement>("details.site-sale-shelf") ?? []);
    expect(shelves.find((shelf) => shelf.querySelector("summary")?.textContent?.includes("Ongoing"))?.open).toBe(true);
    expect(shelves.find((shelf) => shelf.querySelector("summary")?.textContent?.includes("Evergreen"))?.open).toBe(true);
  });

  it("returns a changed sale campaign to the priority queue despite older review feedback", async () => {
    const campaign = {
      ...saleCampaign(),
      reopenedAt: "2026-07-15T12:00:00.000Z",
      saleContentHash: "changed-content",
    };
    localStorage.setItem(
      "record-scanner-arbitrage-review-feedback-v1",
      JSON.stringify({
        recordOutcomes: {},
        saleOutcomes: {
          "campaign-1": {
            observationKey: "older-observation",
            status: "expired",
            updatedAt: "2026-07-14T12:00:00.000Z",
          },
        },
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/history")) {
          return jsonResponse({
            campaigns: [campaign],
            events: [],
            runId: "sale-run",
            status: "available",
            summary: { changed: 1 },
            updatedAt: "2026-07-15T12:00:00.000Z",
          });
        }
        return jsonResponse({
          fileName: "retail-arbitrage-sales.json",
          payload: {
            createdAt: "2026-07-15T12:00:00.000Z",
            finds: [],
            phase: "final",
            runId: "sale-run",
            saleCampaignLedger: {
              campaigns: [campaign],
              history: [],
            },
            saleEvents: [campaign],
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<SiteWideSales />);

    expect(container?.querySelector(".site-sale-priority .site-sale-card")).toBeTruthy();
    expect(container?.querySelector(".site-sale-feedback button.active")).toBeNull();
  });

  it("renders embedded campaigns without waiting for history and ignores a mismatched history run", async () => {
    const campaign = saleCampaign();
    const staleCampaign = {
      ...campaign,
      id: "stale-sale",
      saleCampaignId: "stale-campaign",
      sourceName: "Stale History Store",
    };
    let resolveHistory: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("/history")) {
          return new Promise<Response>((resolve) => {
            resolveHistory = resolve;
          });
        }
        return Promise.resolve(
          jsonResponse({
            fileName: "retail-arbitrage-sales.json",
            payload: {
              createdAt: "2026-07-15T12:00:00.000Z",
              finds: [],
              phase: "final",
              runId: "sale-run",
              saleCampaignLedger: {
                campaigns: [campaign],
                history: [],
              },
              saleEvents: [campaign],
              sourceReports: [],
            },
            status: "available",
          }),
        );
      }),
    );

    await render(<SiteWideSales />);
    expect(container?.textContent).toContain("Sale Store");

    await act(async () => {
      resolveHistory?.(
        jsonResponse({
          campaigns: [staleCampaign],
          events: [],
          runId: "older-sale-run",
          status: "available",
          summary: { changed: 1 },
          updatedAt: "2026-07-14T12:00:00.000Z",
        }),
      );
      await flushAsyncWork();
    });

    expect(container?.textContent).toContain("Sale Store");
    expect(container?.textContent).not.toContain("Stale History Store");
    expect(container?.textContent).toContain("history was ignored");
  });

  it("bounds a stalled history request without removing embedded campaigns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    const campaign = saleCampaign();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("/history")) return new Promise<Response>(() => {});
        return Promise.resolve(
          jsonResponse({
            fileName: "retail-arbitrage-sales.json",
            payload: {
              createdAt: now(),
              finds: [],
              phase: "final",
              runId: "sale-run",
              saleCampaignLedger: {
                campaigns: [campaign],
                history: [],
              },
              saleEvents: [campaign],
              sourceReports: [],
            },
            status: "available",
          }),
        );
      }),
    );

    await render(<SiteWideSales />);
    expect(container?.textContent).toContain("Sale Store");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await flushAsyncWork();
    });

    expect(container?.textContent).toContain("Sale Store");
    expect(container?.textContent).toContain("history was unavailable");
  });

  it("polls the site-wide sales publication periodically", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/history")) {
          return jsonResponse({
            campaigns: [saleCampaign()],
            events: [],
            runId: `sale-run-${latestCalls}`,
            status: "available",
            summary: { changed: 1 },
            updatedAt: now(),
          });
        }
        latestCalls += 1;
        return jsonResponse({
          fileName: `retail-arbitrage-sales-${latestCalls}.json`,
          payload: {
            createdAt: now(),
            finds: [],
            phase: "final",
            runId: `sale-run-${latestCalls}`,
            saleCampaignLedger: {
              campaigns: [saleCampaign()],
              history: [],
            },
            saleEvents: [saleCampaign()],
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<SiteWideSales />);
    expect(latestCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await flushAsyncWork();
    });
    expect(latestCalls).toBe(2);
  });

  it("refreshes site-wide sales when the page becomes visible again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/history")) {
          return jsonResponse({
            campaigns: [saleCampaign()],
            events: [],
            runId: `sale-run-${latestCalls}`,
            status: "available",
            summary: { changed: 1 },
            updatedAt: now(),
          });
        }
        latestCalls += 1;
        return jsonResponse({
          fileName: `retail-arbitrage-sales-${latestCalls}.json`,
          payload: {
            createdAt: now(),
            finds: [],
            phase: "final",
            runId: `sale-run-${latestCalls}`,
            saleCampaignLedger: {
              campaigns: [saleCampaign()],
              history: [],
            },
            saleEvents: [saleCampaign()],
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<SiteWideSales />);
    expect(latestCalls).toBe(1);

    vi.setSystemTime(new Date("2026-07-16T12:05:00.000Z"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushAsyncWork();
    });

    expect(latestCalls).toBe(2);
  });

  it("keeps embedded sale campaigns when a later publication refresh fails", async () => {
    let latestCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/history")) {
          return jsonResponse({
            campaigns: [saleCampaign()],
            events: [],
            runId: "sale-run",
            status: "available",
            summary: { changed: 1 },
            updatedAt: now(),
          });
        }
        latestCalls += 1;
        if (latestCalls > 1) return errorResponse("Temporary sales failure.");
        return jsonResponse({
          fileName: "retail-arbitrage-sales.json",
          payload: {
            createdAt: now(),
            finds: [],
            phase: "final",
            runId: "sale-run",
            saleCampaignLedger: {
              campaigns: [saleCampaign()],
              history: [],
            },
            saleEvents: [saleCampaign()],
            sourceReports: [],
          },
          status: "available",
        });
      }),
    );

    await render(<SiteWideSales />);
    expect(container?.textContent).toContain("Sale Store");

    await clickButton("Reload scan data");

    expect(container?.textContent).toContain("Sale Store");
    expect(container?.textContent).toContain("keeping the last verified publication");
  });
});

async function render(component: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(component);
    await flushAsyncWork();
  });
}

async function clickButton(label: string) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button?.click();
    await flushAsyncWork();
  });
}

async function flushAsyncWork() {
  await Promise.resolve();
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function errorResponse(error: string) {
  return new Response(JSON.stringify({ error }), {
    headers: { "content-type": "application/json" },
    status: 503,
  });
}

function now() {
  return new Date().toISOString();
}

function validatedBuyFind(purchasePrice = 10) {
  const capturedAt = now();
  return {
    activeEvidence: {
      capturedAt,
      exactMatchedListingCount: 2,
      matchConfidence: "high",
      rawListingsInspected: 25,
      searchComplete: true,
      status: "available",
    },
    artist: "Runtime Test Artist",
    capturedAt,
    condition: "new/sealed",
    conservativeResalePrice: 45,
    id: "runtime-buy",
    opportunityType: "product_deal",
    purchasePrice,
    soldEvidence: {
      capturedAt,
      condition: "new_sealed",
      conservativeResalePrice: 45,
      latestSaleDate: capturedAt.slice(0, 10),
      matchConfidence: "high",
      source: "local-own-sales-history",
      status: "validated",
      unitsSold30Days: 5,
      unitsSold90Days: 12,
      unitsSold365Days: 30,
    },
    sourceCurrency: "USD",
    sourceId: "runtime-store",
    sourceListingTitle: "Runtime Test Artist - Runtime Test Album Vinyl LP",
    sourceName: "Runtime Records",
    sourceUrl: "https://runtime-records.example/products/runtime-test-album",
    title: "Runtime Test Album",
  };
}

function saleCampaign() {
  return {
    artist: "Sale alert",
    capturedAt: "2026-07-10T12:00:00.000Z",
    firstSeenAt: "2026-07-10T12:00:00.000Z",
    id: "sale-store-campaign",
    lastSeenAt: "2026-07-15T12:00:00.000Z",
    opportunityType: "sitewide_sale",
    purchasePrice: 0,
    saleCampaignId: "campaign-1",
    saleDiscountPercent: 40,
    saleEvidence: "40% off select vinyl.",
    saleFingerprint: "campaign-1-v2",
    saleScope: "vinyl-wide",
    saleSignal: "40% off select vinyl.",
    saleStatus: "changed",
    saleVerification: "retailer-page",
    sourceId: "sale-store",
    sourceName: "Sale Store",
    sourceUrl: "https://sale-store.example/sale",
    title: "40% sale",
  };
}

function siteSaleStat(label: string): string | undefined {
  return Array.from(container?.querySelectorAll<HTMLElement>(".site-sale-stats .seller-stat") ?? [])
    .find((stat) => stat.querySelector("span")?.textContent === label)
    ?.querySelector("strong")
    ?.textContent ?? undefined;
}

function transition(id: string, reason: string, at: string) {
  return {
    at,
    campaignId: "campaign-1",
    fromStatus: "ongoing",
    id,
    reason,
    runId: "sale-run",
    sourceId: "sale-store",
    toStatus: "changed",
  };
}
