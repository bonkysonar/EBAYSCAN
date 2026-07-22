const DEFAULT_TARGETS = Object.freeze({
  minimumDirectCatalogCoverageRate: 0.7,
  minimumDirectProductiveRate: 0.3,
  targetDirectCatalogCoverageRate: 0.85,
  targetDirectProductiveRate: 0.4,
  targetDirectSalePageCoverageRate: 0.45,
});

export function assessRunQuality(sourceReports, options = {}) {
  const targets = { ...DEFAULT_TARGETS, ...options };
  const reports = Array.isArray(sourceReports) ? sourceReports : [];
  const directReports = reports.filter(isDirectSourceReport);
  const directSourceCount = directReports.length;
  const directCatalogCoverageCount = directReports.filter(hasCatalogCoverage).length;
  const directProductiveSourceCount = directReports.filter(hasProductiveParsing).length;
  const directSalePageCoverageCount = directReports.filter(hasSalePageCoverage).length;
  const blockedSourceCount = reports.filter(isBlocked).length;
  const parserEmptySourceCount = reports.filter(isParserEmpty).length;
  const directCatalogCoverageRate = rate(directCatalogCoverageCount, directSourceCount);
  const directProductiveRate = rate(directProductiveSourceCount, directSourceCount);
  const directSalePageCoverageRate = rate(directSalePageCoverageCount, directSourceCount);
  const reasons = [];

  if (directSourceCount === 0) reasons.push("No direct-retailer source reports were included.");
  if (directCatalogCoverageRate < targets.minimumDirectCatalogCoverageRate) {
    reasons.push(
      `Direct catalog coverage ${percent(directCatalogCoverageRate)} is below the ${percent(
        targets.minimumDirectCatalogCoverageRate,
      )} publication floor.`,
    );
  } else if (directCatalogCoverageRate < targets.targetDirectCatalogCoverageRate) {
    reasons.push(
      `Direct catalog coverage ${percent(directCatalogCoverageRate)} is below the ${percent(
        targets.targetDirectCatalogCoverageRate,
      )} operating target.`,
    );
  }
  if (directProductiveRate < targets.minimumDirectProductiveRate) {
    reasons.push(
      `Only ${percent(directProductiveRate)} of direct retailers produced parsed products; this is below the ${percent(
        targets.minimumDirectProductiveRate,
      )} publication floor.`,
    );
  } else if (directProductiveRate < targets.targetDirectProductiveRate) {
    reasons.push(
      `Only ${percent(directProductiveRate)} of direct retailers produced parsed products; target is ${percent(
        targets.targetDirectProductiveRate,
      )}.`,
    );
  }
  if (directSalePageCoverageRate < targets.targetDirectSalePageCoverageRate) {
    reasons.push(
      `Direct sale-page coverage ${percent(directSalePageCoverageRate)} is below the ${percent(
        targets.targetDirectSalePageCoverageRate,
      )} target.`,
    );
  }
  if (blockedSourceCount > 0) reasons.push(`${blockedSourceCount} source${blockedSourceCount === 1 ? " is" : "s are"} blocked or failed.`);
  if (parserEmptySourceCount > 0) {
    reasons.push(`${parserEmptySourceCount} source${parserEmptySourceCount === 1 ? " returned" : "s returned"} pages but parsed no products.`);
  }

  const blocked =
    directSourceCount === 0 ||
    directCatalogCoverageRate < targets.minimumDirectCatalogCoverageRate ||
    directProductiveRate < targets.minimumDirectProductiveRate;
  const degraded =
    !blocked &&
    (directCatalogCoverageRate < targets.targetDirectCatalogCoverageRate ||
      directProductiveRate < targets.targetDirectProductiveRate ||
      directSalePageCoverageRate < targets.targetDirectSalePageCoverageRate ||
      blockedSourceCount > 0 ||
      parserEmptySourceCount > 0);

  return {
    blockedSourceCount,
    directCatalogCoverageCount,
    directCatalogCoverageRate,
    directProductiveRate,
    directProductiveSourceCount,
    directSalePageCoverageCount,
    directSalePageCoverageRate,
    directSourceCount,
    minimumDirectCatalogCoverageRate: targets.minimumDirectCatalogCoverageRate,
    minimumDirectProductiveRate: targets.minimumDirectProductiveRate,
    parserEmptySourceCount,
    publishable: !blocked,
    status: blocked ? "blocked" : degraded ? "degraded" : "healthy",
    targetDirectCatalogCoverageRate: targets.targetDirectCatalogCoverageRate,
    targetDirectProductiveRate: targets.targetDirectProductiveRate,
    targetDirectSalePageCoverageRate: targets.targetDirectSalePageCoverageRate,
    reasons,
  };
}

export function isDirectSourceReport(report) {
  const crawlType = clean(report?.crawlType).toLowerCase();
  const group = clean(report?.group).toLowerCase();
  const retailSourceType = clean(report?.retailSourceType).toLowerCase();
  return (
    crawlType !== "deal-aggregator" &&
    crawlType !== "social-feed" &&
    group !== "discovery sources" &&
    retailSourceType !== "distributor_discovery"
  );
}

function hasCatalogCoverage(report) {
  const health = clean(report?.catalogHealth).toLowerCase();
  return Number(report?.catalogPageAvailableCount ?? 0) > 0 || health === "healthy" || health === "partial";
}

function hasProductiveParsing(report) {
  return Number(report?.candidateCount ?? 0) > 0 || clean(report?.productParseHealth).toLowerCase() === "productive";
}

function hasSalePageCoverage(report) {
  const health = clean(report?.salePageHealth).toLowerCase();
  return Number(report?.salePageAvailableCount ?? 0) > 0 || health === "healthy" || health === "partial";
}

function isBlocked(report) {
  return clean(report?.status).toLowerCase() === "error" || clean(report?.catalogHealth).toLowerCase() === "failed";
}

function isParserEmpty(report) {
  return clean(report?.productParseHealth).toLowerCase() === "empty";
}

function rate(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function clean(value) {
  return String(value ?? "").trim();
}
