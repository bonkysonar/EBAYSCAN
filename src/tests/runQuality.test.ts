import { describe, expect, it } from "vitest";
import { assessRunQuality } from "../../scripts/lib/runQuality.mjs";

function report(overrides: Record<string, unknown> = {}) {
  return {
    candidateCount: 3,
    catalogHealth: "healthy",
    catalogPageAvailableCount: 1,
    crawlType: "retailer",
    id: crypto.randomUUID(),
    productParseHealth: "productive",
    salePageAvailableCount: 1,
    salePageHealth: "healthy",
    status: "candidates",
    ...overrides,
  };
}

describe("run quality assessment", () => {
  it("distinguishes discovery feeds from direct retailer coverage", () => {
    const quality = assessRunQuality([
      report(),
      report({ crawlType: "deal-aggregator", group: "Discovery sources" }),
    ]);

    expect(quality).toMatchObject({
      directCatalogCoverageCount: 1,
      directSourceCount: 1,
      publishable: true,
      status: "healthy",
    });
  });

  it("blocks publication when direct catalog coverage falls below the floor", () => {
    const reports = [
      ...Array.from({ length: 6 }, () => report()),
      ...Array.from({ length: 4 }, () =>
        report({
          candidateCount: 0,
          catalogHealth: "failed",
          catalogPageAvailableCount: 0,
          productParseHealth: "failed",
          salePageAvailableCount: 0,
          salePageHealth: "failed",
          status: "error",
        }),
      ),
    ];

    const quality = assessRunQuality(reports);
    expect(quality.status).toBe("blocked");
    expect(quality.publishable).toBe(false);
    expect(quality.directCatalogCoverageRate).toBe(0.6);
    expect(quality.reasons.join(" ")).toContain("publication floor");
  });

  it("marks reachable-but-parser-empty coverage as degraded instead of healthy", () => {
    const reports = Array.from({ length: 10 }, (_, index) =>
      report(
        index < 5
          ? {}
          : {
              candidateCount: 0,
              productParseHealth: "empty",
            },
      ),
    );

    const quality = assessRunQuality(reports);
    expect(quality).toMatchObject({
      directCatalogCoverageRate: 1,
      directProductiveRate: 0.5,
      parserEmptySourceCount: 5,
      publishable: true,
      status: "degraded",
    });
  });

  it("blocks publication when reachable retailer pages produce no parsed products", () => {
    const quality = assessRunQuality(
      Array.from({ length: 10 }, () =>
        report({
          candidateCount: 0,
          productParseHealth: "empty",
          status: "empty",
        }),
      ),
    );

    expect(quality).toMatchObject({
      directCatalogCoverageRate: 1,
      directProductiveRate: 0,
      minimumDirectProductiveRate: 0.3,
      publishable: false,
      status: "blocked",
    });
    expect(quality.reasons.join(" ")).toContain("publication floor");
  });

  it("blocks a nearly empty run even when a small minority of parsers still work", () => {
    const quality = assessRunQuality(
      Array.from({ length: 10 }, (_, index) =>
        report(
          index < 2
            ? {}
            : {
                candidateCount: 0,
                productParseHealth: "empty",
                status: "empty",
              },
        ),
      ),
    );

    expect(quality.directProductiveRate).toBe(0.2);
    expect(quality.publishable).toBe(false);
    expect(quality.status).toBe("blocked");
  });
});
