export type RunQualityAssessment = {
  blockedSourceCount: number;
  directCatalogCoverageCount: number;
  directCatalogCoverageRate: number;
  directProductiveRate: number;
  directProductiveSourceCount: number;
  directSalePageCoverageCount: number;
  directSalePageCoverageRate: number;
  directSourceCount: number;
  minimumDirectCatalogCoverageRate: number;
  minimumDirectProductiveRate: number;
  parserEmptySourceCount: number;
  publishable: boolean;
  reasons: string[];
  status: "blocked" | "degraded" | "healthy";
  targetDirectCatalogCoverageRate: number;
  targetDirectProductiveRate: number;
  targetDirectSalePageCoverageRate: number;
};

export function assessRunQuality(
  sourceReports: unknown,
  options?: Partial<{
    minimumDirectCatalogCoverageRate: number;
    minimumDirectProductiveRate: number;
    targetDirectCatalogCoverageRate: number;
    targetDirectProductiveRate: number;
    targetDirectSalePageCoverageRate: number;
  }>,
): RunQualityAssessment;

export function isDirectSourceReport(report: unknown): boolean;
