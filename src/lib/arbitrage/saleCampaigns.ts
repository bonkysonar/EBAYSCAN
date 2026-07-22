import type { ArbitrageFind } from "./types";

export type SaleLifecycleStatus = "changed" | "ended" | "evergreen" | "new" | "ongoing" | "unknown";

export type SaleObservation = Omit<ArbitrageFind, "saleStatus"> & {
  endedAt?: string | null;
  lastSeenAt?: string;
  reopenedAt?: string | null;
  saleCampaignId?: string;
  saleConsecutiveSeenCount?: number;
  saleFailureCount?: number;
  saleLastCheckedAt?: string;
  saleMissCount?: number;
  saleObservationCount?: number;
  saleObservationPageCount?: number;
  saleObservationUrls?: string[];
  saleObservedThisRun?: boolean;
  saleCode?: string | null;
  salePromoCode?: string | null;
  promoCode?: string | null;
  saleStatus?: SaleLifecycleStatus;
};

type SourceHealthValue =
  | string
  | {
      health?: string;
      state?: string;
      status?: string;
    }
  | null;

export type NormalizedSaleCampaign = SaleObservation & {
  displayCampaignKey: string;
  mergedCampaignIds: string[];
  normalizedSalePages: string[];
  saleObservationCount: number;
  saleObservationPageCount: number;
  saleStatus: SaleLifecycleStatus;
};

export type SaleSourceReport = {
  candidateCount?: number;
  catalogHealth?: SourceHealthValue;
  catalogPageAttemptCount?: number;
  catalogPageAvailableCount?: number;
  error?: string;
  id: string;
  name: string;
  pageErrors?: Array<{ failureKind?: string; requestedUrl?: string }>;
  priority?: number | null;
  productParseHealth?: string;
  resolvedUrls?: string[];
  saleEventCount?: number;
  salePageAttemptCount?: number;
  salePageAvailableCount?: number;
  salePageHealth?: SourceHealthValue;
  status?: string;
  url?: string;
  usableCoverage?: string;
};

export type SalePayloadShape = {
  finds?: SaleObservation[];
  saleCampaignLedger?: { campaigns?: SaleObservation[] } | SaleObservation[];
  saleEvents?: SaleObservation[];
  saleObservations?: SaleObservation[];
  sourceReports?: SaleSourceReport[];
};

export type NormalizedSaleData = {
  campaigns: NormalizedSaleCampaign[];
  pageCount: number;
  rawObservationCount: number;
  retailerCount: number;
  uniqueOfferCount: number;
};

export type CoverageState = "blocked" | "degraded" | "empty" | "healthy" | "not_checked";

export type SourceCoverage = {
  report: SaleSourceReport;
  state: CoverageState;
};

export type CoverageSummary = Record<CoverageState, number> & {
  sources: SourceCoverage[];
  total: number;
};

const ACTIVE_STATUSES = new Set<SaleLifecycleStatus>(["changed", "evergreen", "new", "ongoing"]);
const FAILED_HEALTH_STATES = new Set(["blocked", "error", "failed", "timeout", "unavailable", "unknown"]);
const MEANINGFUL_USABLE_COVERAGE = new Set(["high_signal", "raw_candidates", "selected"]);
const STATUS_PRIORITY: Record<SaleLifecycleStatus, number> = {
  changed: 5,
  ended: 0,
  evergreen: 3,
  new: 6,
  ongoing: 4,
  unknown: 2,
};

export function normalizeSalePayload(payload: SalePayloadShape): NormalizedSaleData {
  const ledger = Array.isArray(payload.saleCampaignLedger)
    ? payload.saleCampaignLedger
    : payload.saleCampaignLedger?.campaigns ?? [];
  const saleEvents = sitewideSales(payload.saleEvents);
  const legacyFinds = sitewideSales(payload.finds);
  const campaigns = [...ledger, ...(saleEvents.length ? saleEvents : legacyFinds)];
  const rawObservations = sitewideSales(payload.saleObservations).length
    ? sitewideSales(payload.saleObservations)
    : saleEvents.length
      ? saleEvents
      : legacyFinds;
  return normalizeSaleCampaigns(campaigns, rawObservations);
}

export function normalizeSaleCampaigns(
  campaigns: SaleObservation[],
  rawObservations: SaleObservation[] = [],
): NormalizedSaleData {
  const campaignGroups = groupByDisplayIdentity(
    suppressConflictingDiscoveryLeads(sitewideSales(campaigns)),
  );
  const observationGroups = groupByDisplayIdentity(sitewideSales(rawObservations));
  const normalized = [...campaignGroups.entries()]
    .map(([key, rows]) => buildCampaign(key, rows, observationGroups.get(key) ?? []))
    .sort(compareCampaigns);
  const active = normalized.filter((campaign) => ACTIVE_STATUSES.has(campaign.saleStatus));
  const activePages = new Set(active.flatMap((campaign) => campaign.normalizedSalePages));
  const fallbackObservationCount = normalized.reduce((total, campaign) => total + campaign.saleObservationCount, 0);

  return {
    campaigns: normalized,
    pageCount: activePages.size,
    rawObservationCount: rawObservations.length || fallbackObservationCount,
    retailerCount: new Set(active.map(retailerIdentity)).size,
    uniqueOfferCount: active.length,
  };
}

export function displaySaleCampaignKey(sale: SaleObservation): string {
  const retailer = retailerIdentity(sale);
  const page = normalizeSalePageUrl(sale.sourceUrl);
  const text = saleIdentityText(sale);
  const promoCode = explicitPromoCode(sale) ?? extractSalePromoCode(text);
  const discount = normalizedDiscount(sale.saleDiscountPercent);
  const discountQualifier = normalizedDiscountQualifier(sale, text, discount);
  const offer = offerIdentity(text, page, discount, promoCode);
  const pageIdentity = portableEconomicOffer(offer, discount, promoCode) ? "any" : page;
  return `${retailer}|page:${pageIdentity}|offer:${offer}|code:${promoCode ?? "none"}|discount:${discount ?? "none"}|qualifier:${discountQualifier}`;
}

export function normalizeSalePageUrl(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let path = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, "") || "/";
    path = path.replace(/\/products\.json$/, "");
    path = path.replace(/\/(?:page|p)\/\d+$/, "");
    path = path.replace(/\/page[-_]\d+$/, "");
    const collection = path.match(/^(\/collections\/[^/]+)/);
    if (collection) path = collection[1];

    const retained = new URLSearchParams();
    for (const [key, entry] of url.searchParams) {
      if (/^(?:constraint|fbclid|filter(?:\..+)?|gclid|mc_cid|mc_eid|page|p|ref|section_id|sort|sort_by|source|tags?|utm_.+|view)$/i.test(key)) continue;
      retained.append(key.toLowerCase(), entry.toLowerCase());
    }
    retained.sort();
    return `${host}${path}${retained.size ? `?${retained.toString()}` : ""}`;
  } catch {
    return value.trim().toLowerCase().split(/[?#]/, 1)[0].replace(/\/+$/, "");
  }
}

export function normalizedSaleScope(sale: SaleObservation): string {
  const scope = (sale.saleScope ?? "unknown").toLowerCase();
  if (scope !== "sitewide" && scope !== "vinyl-wide") return scope;

  const evidence = sale.saleEvidence ?? sale.sourceListingTitle ?? sale.title ?? "";
  const economicSignal = /\b(?:[1-9]\d?\s*%\s*off|bogo|buy\s+one\s+get\s+one|promo\s+code|coupon\s+code|use\s+code)\b/i;
  const sitewideClaim = /\b(?:sitewide|site-wide|storewide|store-wide|entire\s+(?:site|store)|everything)\b/i;
  const vinylWideClaim = /\ball\s+(?:vinyl|records|lps|music)\b/i;
  const hasOfferEvidence = economicSignal.test(evidence);

  if (scope === "sitewide" && sitewideClaim.test(evidence) && hasOfferEvidence) return "sitewide";
  if (vinylWideClaim.test(evidence) && hasOfferEvidence) return "vinyl-wide";

  const pageAndEvidence = `${normalizeSalePageUrl(sale.sourceUrl)} ${evidence}`;
  if (/\b(?:clearance|closeout|garage[- ]sale|warehouse[- ](?:sale|overstock)|overstock[- ]sale)\b/i.test(pageAndEvidence)) {
    return "clearance";
  }
  return "unknown";
}

export function extractSalePromoCode(value: string): string | null {
  const patterns = [
    /\b(?:promo|coupon|discount)\s+code\s*[:\-]?\s*["']?([a-z0-9][a-z0-9_-]{2,24})\b/i,
    /\buse\s+(?:promo\s+)?code\s*[:\-]?\s*["']?([a-z0-9][a-z0-9_-]{2,24})\b/i,
    /\buse\s+([a-z0-9][a-z0-9_-]{3,24})\s+(?:at\s+checkout|to\s+(?:save|get))/i,
  ];
  const ignored = new Set(["CODE", "COUPON", "PROMO", "SAVE", "THIS", "YOUR"]);
  for (const pattern of patterns) {
    const code = value.match(pattern)?.[1]?.toUpperCase();
    if (code && !ignored.has(code)) return code;
  }
  return null;
}

export function classifySourceCoverage(report: SaleSourceReport): CoverageState {
  const catalogHealth = coverageHealthStatus(report.catalogHealth);
  const salePageHealth = coverageHealthStatus(report.salePageHealth);
  const meaningful =
    finiteCount(report.candidateCount) > 0 ||
    finiteCount(report.saleEventCount) > 0 ||
    report.productParseHealth === "productive" ||
    MEANINGFUL_USABLE_COVERAGE.has(report.usableCoverage ?? "");
  const salePageFailed = FAILED_HEALTH_STATES.has(salePageHealth);
  const catalogFailed = FAILED_HEALTH_STATES.has(catalogHealth);
  const failed = report.status === "error" || catalogFailed || report.productParseHealth === "failed";
  const partial =
    report.status === "partial" ||
    catalogHealth === "partial" ||
    salePageHealth === "partial" ||
    (report.pageErrors?.length ?? 0) > 0;
  const catalogReached =
    finiteCount(report.catalogPageAvailableCount) > 0 || ["healthy", "partial", "success"].includes(catalogHealth);

  if (meaningful && (failed || salePageFailed || partial)) return "degraded";
  if (meaningful) return "healthy";
  if (salePageFailed && catalogReached && !catalogFailed) return "degraded";
  if (salePageFailed || failed) return "blocked";

  const attempted =
    finiteCount(report.catalogPageAttemptCount) > 0 ||
    finiteCount(report.salePageAttemptCount) > 0 ||
    finiteCount(report.catalogPageAvailableCount) > 0 ||
    finiteCount(report.salePageAvailableCount) > 0 ||
    ["candidates", "empty", "healthy", "partial", "sale_signals"].includes(report.status ?? "") ||
    ["healthy", "partial", "success"].includes(catalogHealth) ||
    ["healthy", "partial", "success"].includes(salePageHealth) ||
    report.productParseHealth === "empty" ||
    (report.resolvedUrls?.length ?? 0) > 0;
  return attempted ? "empty" : "not_checked";
}

export function coverageHealthStatus(value: SourceHealthValue | undefined): string {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? value.status ?? value.state ?? value.health ?? ""
        : "";
  return raw.trim().toLowerCase();
}

export function summarizeSourceCoverage(reports: SaleSourceReport[]): CoverageSummary {
  const sources = reports.map((report) => ({ report, state: classifySourceCoverage(report) }));
  return {
    blocked: sources.filter(({ state }) => state === "blocked").length,
    degraded: sources.filter(({ state }) => state === "degraded").length,
    empty: sources.filter(({ state }) => state === "empty").length,
    healthy: sources.filter(({ state }) => state === "healthy").length,
    not_checked: sources.filter(({ state }) => state === "not_checked").length,
    sources,
    total: sources.length,
  };
}

function sitewideSales(rows: SaleObservation[] | undefined): SaleObservation[] {
  return (rows ?? []).filter((sale) => sale.opportunityType === undefined || sale.opportunityType === "sitewide_sale");
}

function groupByDisplayIdentity(rows: SaleObservation[]): Map<string, SaleObservation[]> {
  const grouped = new Map<string, SaleObservation[]>();
  for (const sale of rows) {
    const key = displaySaleCampaignKey(sale);
    grouped.set(key, [...(grouped.get(key) ?? []), sale]);
  }
  return grouped;
}

function suppressConflictingDiscoveryLeads(rows: SaleObservation[]): SaleObservation[] {
  const byOfferBase = new Map<string, SaleObservation[]>();
  for (const sale of rows) {
    const retailer = retailerIdentity(sale);
    const page = normalizeSalePageUrl(sale.sourceUrl);
    const text = saleIdentityText(sale);
    const promoCode = explicitPromoCode(sale) ?? extractSalePromoCode(text);
    const discount = normalizedDiscount(sale.saleDiscountPercent);
    const offer = offerIdentity(text, page, discount, promoCode);
    const pageIdentity = portableEconomicOffer(offer, discount, promoCode) ? "any" : page;
    const key = `${retailer}|page:${pageIdentity}|offer:${offer}|code:${promoCode ?? "none"}`;
    byOfferBase.set(key, [...(byOfferBase.get(key) ?? []), sale]);
  }
  return [...byOfferBase.values()].flatMap((group) => {
    const confirmed = group.filter((sale) => sale.saleVerification === "retailer-page");
    if (confirmed.length === 0) return group;
    const confirmedDiscounts = new Set(
      confirmed.map(economicDiscountIdentity),
    );
    return group.filter(
      (sale) =>
        sale.saleVerification === "retailer-page" ||
        confirmedDiscounts.has(economicDiscountIdentity(sale)),
    );
  });
}

function buildCampaign(
  key: string,
  campaignRows: SaleObservation[],
  observationRows: SaleObservation[],
): NormalizedSaleCampaign {
  const representative = [...campaignRows].sort(compareRepresentatives)[0];
  const observations = observationRows.length ? observationRows : campaignRows;
  const explicitObservationCount = Math.max(0, ...campaignRows.map((sale) => finiteCount(sale.saleObservationCount)));
  const urls = [
    ...observations.flatMap((sale) => sale.saleObservationUrls ?? [sale.sourceUrl]),
    ...campaignRows.flatMap((sale) => sale.saleObservationUrls ?? []),
  ];
  const normalizedPages = [...new Set(urls.map(normalizeSalePageUrl).filter(Boolean))];
  const mergedCampaignIds = [
    ...new Set(campaignRows.map((sale) => sale.saleCampaignId).filter((value): value is string => Boolean(value))),
  ];

  return {
    ...representative,
    displayCampaignKey: key,
    firstSeenAt: earliestDate(campaignRows.map((sale) => sale.firstSeenAt).filter((value): value is string => Boolean(value))),
    lastSeenAt: latestDate(campaignRows.map((sale) => sale.lastSeenAt ?? sale.capturedAt)),
    mergedCampaignIds,
    normalizedSalePages: normalizedPages,
    saleObservationCount: observationRows.length || explicitObservationCount || campaignRows.length,
    saleObservationPageCount: normalizedPages.length,
    saleScope: normalizedSaleScope(representative),
    saleStatus: highestStatus(campaignRows),
  };
}

function compareCampaigns(left: NormalizedSaleCampaign, right: NormalizedSaleCampaign): number {
  return (
    STATUS_PRIORITY[right.saleStatus] - STATUS_PRIORITY[left.saleStatus] ||
    Date.parse(right.lastSeenAt ?? right.capturedAt) - Date.parse(left.lastSeenAt ?? left.capturedAt) ||
    left.sourceName.localeCompare(right.sourceName)
  );
}

function compareRepresentatives(left: SaleObservation, right: SaleObservation): number {
  return representativeScore(right) - representativeScore(left) || Date.parse(right.lastSeenAt ?? right.capturedAt) - Date.parse(left.lastSeenAt ?? left.capturedAt);
}

function representativeScore(sale: SaleObservation): number {
  const status = sale.saleStatus ?? "ongoing";
  const salePage = /\b(?:sale|clearance|deal|garage|overstock|promo)/i.test(normalizeSalePageUrl(sale.sourceUrl)) ? 30 : 0;
  const scope = normalizedSaleScope(sale);
  const scopeScore = scope === "sitewide" ? 5 : scope === "vinyl-wide" ? 4 : scope === "clearance" ? 3 : 2;
  return (sale.saleVerification === "retailer-page" ? 10_000 : 0) + STATUS_PRIORITY[status] * 100 + salePage + scopeScore + (sale.saleEvidence ? 1 : 0);
}

function highestStatus(rows: SaleObservation[]): SaleLifecycleStatus {
  return [...rows].sort(
    (left, right) => STATUS_PRIORITY[right.saleStatus ?? "ongoing"] - STATUS_PRIORITY[left.saleStatus ?? "ongoing"],
  )[0]?.saleStatus ?? "ongoing";
}

function retailerIdentity(sale: SaleObservation): string {
  const pageHost = normalizeSalePageUrl(sale.sourceUrl).split("/", 1)[0];
  const source = pageHost || sale.sourceId || sale.sourceName || "unknown-source";
  return source.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function saleIdentityText(sale: SaleObservation): string {
  return [sale.saleEvidence, sale.saleSignal, sale.sourceListingTitle, sale.title].filter(Boolean).join(" ");
}

function explicitPromoCode(sale: SaleObservation): string | null {
  for (const value of [sale.salePromoCode, sale.saleCode, sale.promoCode]) {
    if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
  }
  return null;
}

function normalizedDiscount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function economicDiscountIdentity(sale: SaleObservation): string {
  const discount = normalizedDiscount(sale.saleDiscountPercent);
  return `${discount ?? "none"}|${normalizedDiscountQualifier(sale, saleIdentityText(sale), discount)}`;
}

function normalizedDiscountQualifier(
  sale: SaleObservation,
  text: string,
  discount: number | null,
): "exact" | "none" | "up_to" {
  if (sale.saleDiscountQualifier === "up_to") return "up_to";
  if (sale.saleDiscountQualifier === "exact") return "exact";
  if (discount === null) return "none";
  const escapedDiscount = String(discount).replace(".", "\\.");
  return new RegExp(`\\bup\\s+to\\s+(?:an?\\s+)?${escapedDiscount}\\s*(?:%|percent)\\s*off\\b`, "i").test(text)
    ? "up_to"
    : "exact";
}

function offerIdentity(text: string, page: string, discount: number | null, promoCode: string | null): string {
  if (/\b(?:bogo|buy\s+one\s+get\s+one|buy\s+1\s+get\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(text)) return "bogo";
  if (/\b(?:buy\s+more|volume\s+discount|multi[- ]?buy)\b/i.test(text)) return "volume";
  if (promoCode) return "promo-code";
  if (discount !== null) return "percent-sale";
  if (/\bgarage[- ]sale\b/i.test(`${page} ${text}`)) return "garage-sale";
  if (/\bwarehouse[- ](?:overstock|sale)\b|\boverstock[- ]sale\b/i.test(`${page} ${text}`)) return "warehouse-overstock";
  if (/\bclearance\b/i.test(`${page} ${text}`)) return "clearance";
  if (/\bfree\s+shipping\b/i.test(text)) return "free-shipping";
  return "sale";
}

function portableEconomicOffer(offer: string, discount: number | null, promoCode: string | null): boolean {
  return discount !== null || Boolean(promoCode) || offer === "bogo" || offer === "volume";
}

function finiteCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function earliestDate(values: string[]): string | undefined {
  return values.sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function latestDate(values: string[]): string | undefined {
  return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}
