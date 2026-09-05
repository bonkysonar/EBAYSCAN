import type { ArbitrageImportPayload } from "../lib/arbitrage/types";
import { retailEligibility } from "../../scripts/lib/retailIdentity.mjs";

const error = (message: string) =>
  Object.assign(new Error(message), { statusCode: 422 });

/** Separate publication contract. The full-catalog publication gate is unchanged. */
export function mergeVerifiedSourceUpdates(
  incoming: ArbitrageImportPayload,
  previous: ArbitrageImportPayload | null,
  authoritativeIds: string[],
  now = Date.now(),
): ArbitrageImportPayload {
  if (incoming.sourceUpdateVersion !== 1)
    throw error("Unsupported source update version.");
  const reports = incoming.sourceReports ?? [];
  const ids = reports.map((r) => String(r.id ?? ""));
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !authoritativeIds.includes(id)) ||
    incoming.runManifest?.scannedSourceCount !== ids.length ||
    incoming.runManifest?.sourceCatalogCount !== authoritativeIds.length
  )
    throw error(
      "Source update manifest does not match the configured sources.",
    );
  const started = Date.parse(incoming.createdAt);
  if (
    !Number.isFinite(started) ||
    now - started > 86400000 ||
    started > now + 300000
  )
    throw error("Source updates require a scan from the last 24 hours.");
  const products = new Set(
    reports
      .filter(
        (r) =>
          Number(r.catalogPageAvailableCount) > 0 &&
          ["healthy", "partial"].includes(String(r.catalogHealth)) &&
          r.productParseHealth === "productive",
      )
      .map((r) => String(r.id)),
  );
  const sales = new Set(
    reports
      .filter(
        (r) =>
          Number(r.salePageAvailableCount) > 0 &&
          ["healthy", "partial"].includes(String(r.salePageHealth)),
      )
      .map((r) => String(r.id)),
  );
  const fresh = (date: string) =>
    Number.isFinite(Date.parse(date)) &&
    Date.parse(date) >= started - 300000 &&
    Date.parse(date) <= now + 300000;
  const freshProduct = (find: ArbitrageImportPayload["finds"][number]) => {
    if (!find.retailObservationMethod && !find.retailObservedAt && !find.retailObservationUrl)
      return fresh(find.capturedAt);
    if (!["visible_browser", "visible_browser_catalog"].includes(find.retailObservationMethod ?? ""))
      return false;
    const report = reports.find((entry) => entry.id === find.sourceId);
    const observed = Date.parse(find.retailObservedAt ?? "");
    const reportObserved = Date.parse(String(report?.browserObservedAt ?? ""));
    if (!Number.isFinite(observed) || now - observed > 6 * 3600000 || observed > now + 300000 ||
        Date.parse(find.capturedAt) !== observed || !Number.isFinite(reportObserved) ||
        observed > reportObserved || reportObserved > now + 300000 ||
        !(Number(report?.browserObservationCount) > 0) ||
        report?.browserCatalogCoverage !== "bounded_visible_pages" ||
        !Array.isArray(report.browserObservedUrls)) return false;
    try {
      const page = new URL(find.retailObservationUrl ?? "");
      const product = new URL(find.sourceUrl);
      const canonical = (url: URL) => `${url.origin.replace(/^https:\/\/www\./, "https://")}${url.pathname}${url.search}`;
      const safeUrl = (url: URL) => url.protocol === "https:" && !url.username && !url.password && !url.port &&
        !/(?:account|checkout|customer_authentication|cart|buyer_flags)/i.test(url.href);
      return safeUrl(page) && safeUrl(product) &&
        page.hostname.replace(/^www\./, "") === product.hostname.replace(/^www\./, "") &&
        report.browserObservedUrls.some((url) => typeof url === "string" && canonical(new URL(url)) === canonical(page));
    } catch { return false; }
  };
  const observations = (
    incoming.saleObservations ??
    incoming.saleEvents ??
    []
  ).filter((f) => sales.has(f.sourceId ?? "") && fresh(f.capturedAt));
  const newProducts = incoming.finds.filter(
    (f) =>
      f.opportunityType !== "sitewide_sale" &&
      products.has(f.sourceId ?? "") &&
      freshProduct(f) &&
      retailEligibility(f).eligible,
  );
  if (!products.size && !sales.size)
    throw error(
      "No independently verified source updates. The scan attempt can still be recorded.",
    );
  // Keep old observation times. A healthy sale page alone cannot refresh stock/prices.
  const retained = (previous?.finds ?? []).filter(
    (f) =>
      f.opportunityType !== "sitewide_sale" && !products.has(f.sourceId ?? ""),
  );
  const oldReports = new Map(
    (previous?.sourceReports ?? []).map((r) => [String(r.id), r]),
  );
  const mergedReports = authoritativeIds.map((id) => {
    const current = reports.find((r) => r.id === id);
    const prior = oldReports.get(id);
    return current
      ? {
          ...current,
          lastAttemptAt: incoming.createdAt,
          verifiedAt: products.has(id)
            ? incoming.createdAt
            : (prior?.verifiedAt ?? previous?.createdAt ?? null),
        }
      : {
          ...prior,
          id,
          lastAttemptAt: prior?.lastAttemptAt ?? previous?.createdAt ?? null,
          verifiedAt: prior?.verifiedAt ?? previous?.createdAt ?? null,
        };
  });
  return {
    ...incoming,
    finds: [...newProducts, ...retained],
    saleObservations: observations,
    saleEvents: observations,
    sourceReports: mergedReports,
    sourceUpdates: {
      version: 1,
      updatedSourceIds: [...new Set([...products, ...sales])],
      retainedSourceIds: authoritativeIds.filter((id) => !products.has(id)),
      lastBroadScanAt:
        previous?.sourceUpdates?.lastBroadScanAt ??
        (previous?.publicationMode !== "source_updates"
          ? (previous?.createdAt ?? null)
          : null),
      lastBroadAttemptAt:
        incoming.runManifest?.requestedSourceIds?.length === 0
          ? incoming.createdAt
          : (previous?.sourceUpdates?.lastBroadAttemptAt ??
            previous?.createdAt ??
            null),
    },
  };
}
