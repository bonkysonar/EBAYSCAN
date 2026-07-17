import { createHash } from "node:crypto";

export const SALE_CAMPAIGN_LEDGER_SCHEMA_VERSION = 1;

const DEFAULT_END_AFTER_MISSES = 2;
const DEFAULT_EVERGREEN_AFTER_SCANS = 5;
const DEFAULT_MAX_HISTORY_ENTRIES = 2_000;
const ACTIVE_SALE_STATUSES = new Set(["new", "changed", "ongoing", "evergreen"]);
const TRACKING_QUERY_KEYS = /^(?:fbclid|gclid|mc_cid|mc_eid|ref|source|utm_.+)$/i;

export function reconcileSaleCampaigns({
  previousLedger = null,
  saleEvents = [],
  sourceReports = [],
  observedAt,
  runId,
  options = {},
}) {
  const timestamp = validIsoTimestamp(observedAt) ? observedAt : new Date().toISOString();
  const effectiveRunId = cleanText(runId) || `legacy-${timestamp}`;
  const endAfterMisses = positiveInteger(options.endAfterMisses, DEFAULT_END_AFTER_MISSES);
  const evergreenAfterScans = positiveInteger(options.evergreenAfterScans, DEFAULT_EVERGREEN_AFTER_SCANS);
  const maxHistoryEntries = positiveInteger(options.maxHistoryEntries, DEFAULT_MAX_HISTORY_ENTRIES);
  const previous = normalizeLedger(previousLedger);
  const reportsBySource = new Map(
    (Array.isArray(sourceReports) ? sourceReports : [])
      .filter((report) => report && typeof report === "object" && cleanText(report.id))
      .map((report) => [cleanText(report.id), report]),
  );
  const previousCampaigns = previous.campaigns.map((campaign) => normalizeExistingCampaign(campaign));
  const previousById = new Map(previousCampaigns.map((campaign) => [campaign.saleCampaignId, campaign]));
  const previousByFingerprint = new Map();
  const previousByIdentity = new Map();

  for (const campaign of previousCampaigns) {
    const key = fingerprintLookupKey(campaign.sourceId, campaign.saleFingerprint);
    if (key) {
      const matches = previousByFingerprint.get(key) ?? [];
      matches.push(campaign);
      previousByFingerprint.set(key, matches);
    }
    const identityKey = saleCampaignIdFor(campaign);
    const identityMatches = previousByIdentity.get(identityKey) ?? [];
    identityMatches.push(campaign);
    previousByIdentity.set(identityKey, identityMatches);
  }

  const history = [...previous.history];
  const nextById = new Map();
  const matchedPreviousIds = new Set();
  const observations = dedupeObservations(saleEvents);
  const currentFingerprintKeys = new Set(
    observations.map((event) => fingerprintLookupKey(event.sourceId, event.saleFingerprint)).filter(Boolean),
  );

  for (const rawEvent of observations) {
    const normalized = normalizeObservedEvent(rawEvent, timestamp);
    const fingerprintMatches = previousByFingerprint.get(fingerprintLookupKey(normalized.sourceId, normalized.saleFingerprint)) ?? [];
    const exactPrevious = fingerprintMatches.find((candidate) => !matchedPreviousIds.has(candidate.saleCampaignId));
    const derivedPrevious = previousById.get(normalized.saleCampaignId);
    const identityMatches = previousByIdentity.get(saleCampaignIdFor(normalized)) ?? [];
    const fallbackMatches = [derivedPrevious, ...identityMatches].filter(
      (candidate, index, candidates) =>
        candidate &&
        candidates.findIndex((entry) => entry?.saleCampaignId === candidate.saleCampaignId) === index &&
        !matchedPreviousIds.has(candidate.saleCampaignId),
    );
    const unreservedFallback = fallbackMatches.find(
      (candidate) => !currentFingerprintKeys.has(fingerprintLookupKey(candidate.sourceId, candidate.saleFingerprint)),
    );
    let prior = exactPrevious ?? unreservedFallback ?? fallbackMatches[0] ?? null;
    let campaignId = prior?.saleCampaignId ?? normalized.saleCampaignId;

    if (!prior && (nextById.has(campaignId) || matchedPreviousIds.has(campaignId))) {
      campaignId = `${campaignId}-${shortHash(normalized.saleFingerprint || normalized.saleContentHash)}`;
      prior = previousById.get(campaignId) ?? null;
    }

    if (prior) matchedPreviousIds.add(prior.saleCampaignId);
    const saleScanCount = (prior?.saleScanCount ?? 0) + 1;
    const saleConsecutiveSeenCount =
      prior &&
      prior.saleStatus !== "ended" &&
      (prior.saleMissCount ?? 0) === 0 &&
      (prior.saleFailureCount ?? 0) === 0
        ? (prior.saleConsecutiveSeenCount ?? prior.saleScanCount ?? 0) + 1
        : 1;
    const contentChanged = Boolean(prior && prior.saleContentHash !== normalized.saleContentHash);
    const evidenceChanged = Boolean(prior && prior.saleEvidenceHash !== normalized.saleEvidenceHash);
    const wasEnded = prior?.saleStatus === "ended";
    const wasUnknown = prior?.saleStatus === "unknown";
    const saleStatus = !prior || wasEnded
      ? "new"
      : contentChanged
        ? "changed"
        : saleConsecutiveSeenCount >= evergreenAfterScans
          ? "evergreen"
          : "ongoing";
    const campaign = {
      ...(prior ?? {}),
      ...normalized,
      endedAt: null,
      firstSeenAt: prior?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      reopenedAt: wasEnded ? timestamp : prior?.reopenedAt ?? null,
      saleCampaignId: campaignId,
      saleConsecutiveSeenCount,
      saleFailureCount: 0,
      saleLastCheckedAt: timestamp,
      saleMissCount: 0,
      saleObservedThisRun: true,
      saleScanCount,
      saleStatus,
    };
    nextById.set(campaignId, campaign);

    const transition = observedTransition(prior, campaign, {
      contentChanged,
      evidenceChanged,
      wasEnded,
      wasUnknown,
    });
    if (transition) {
      history.push(historyEntry(campaign, effectiveRunId, timestamp, transition.reason, transition.fromStatus));
    }
  }

  for (const previousCampaign of previousCampaigns) {
    if (matchedPreviousIds.has(previousCampaign.saleCampaignId) || nextById.has(previousCampaign.saleCampaignId)) continue;
    if (previousCampaign.saleStatus === "ended") {
      nextById.set(previousCampaign.saleCampaignId, {
        ...previousCampaign,
        saleObservedThisRun: false,
      });
      continue;
    }

    const report = reportsBySource.get(previousCampaign.sourceId);
    if (!report) {
      nextById.set(previousCampaign.saleCampaignId, {
        ...previousCampaign,
        saleObservedThisRun: false,
      });
      continue;
    }

    const health = campaignObservationHealth(report, previousCampaign);
    if (health !== "success") {
      const campaign = {
        ...previousCampaign,
        saleFailureCount: (previousCampaign.saleFailureCount ?? 0) + 1,
        saleLastCheckedAt: timestamp,
        saleObservedThisRun: false,
        saleStatus: "unknown",
      };
      nextById.set(campaign.saleCampaignId, campaign);
      if (previousCampaign.saleStatus !== "unknown") {
        history.push(historyEntry(campaign, effectiveRunId, timestamp, "source_check_failed", previousCampaign.saleStatus));
      }
      continue;
    }

    const saleMissCount = (previousCampaign.saleMissCount ?? 0) + 1;
    const ended = saleMissCount >= endAfterMisses;
    const retainedStatus =
      previousCampaign.saleScanCount >= evergreenAfterScans || previousCampaign.saleStatus === "evergreen"
        ? "evergreen"
        : "ongoing";
    const campaign = {
      ...previousCampaign,
      endedAt: ended ? timestamp : null,
      saleFailureCount: 0,
      saleLastCheckedAt: timestamp,
      saleMissCount,
      saleObservedThisRun: false,
      saleStatus: ended ? "ended" : retainedStatus,
    };
    nextById.set(campaign.saleCampaignId, campaign);
    history.push(
      historyEntry(
        campaign,
        effectiveRunId,
        timestamp,
        ended ? "ended_after_successful_misses" : "successful_miss",
        previousCampaign.saleStatus,
      ),
    );
  }

  const campaigns = [...nextById.values()].sort(compareCampaigns);
  const addedHistory = history.slice(previous.history.length);
  const boundedHistory = history.slice(-maxHistoryEntries);
  const ledger = {
    campaigns,
    history: boundedHistory,
    runId: effectiveRunId,
    schemaVersion: SALE_CAMPAIGN_LEDGER_SCHEMA_VERSION,
    updatedAt: timestamp,
  };
  const activeSaleEvents = campaigns.filter((campaign) => ACTIVE_SALE_STATUSES.has(campaign.saleStatus));

  return {
    activeSaleEvents,
    historyEvents: addedHistory.slice(-maxHistoryEntries),
    ledger,
    summary: summarizeCampaigns(campaigns),
  };
}

export function saleCampaignLedgerFromPayload(payload) {
  if (!payload || typeof payload !== "object") return emptyLedger();
  if (payload.saleCampaignLedger && typeof payload.saleCampaignLedger === "object") {
    return normalizeLedger(payload.saleCampaignLedger);
  }

  const timestamp = validIsoTimestamp(payload.createdAt) ? payload.createdAt : new Date(0).toISOString();
  const campaigns = (Array.isArray(payload.saleEvents) ? payload.saleEvents : [])
    .filter((event) => event && typeof event === "object")
    .map((event) => {
      const normalized = normalizeObservedEvent(event, validIsoTimestamp(event.capturedAt) ? event.capturedAt : timestamp);
      return normalizeExistingCampaign({
        ...normalized,
        endedAt: event.endedAt ?? null,
        firstSeenAt: validIsoTimestamp(event.firstSeenAt) ? event.firstSeenAt : normalized.capturedAt,
        lastSeenAt: validIsoTimestamp(event.lastSeenAt) ? event.lastSeenAt : normalized.capturedAt,
        saleFailureCount: nonNegativeInteger(event.saleFailureCount, 0),
        saleLastCheckedAt: validIsoTimestamp(event.saleLastCheckedAt) ? event.saleLastCheckedAt : normalized.capturedAt,
        saleMissCount: nonNegativeInteger(event.saleMissCount, 0),
        saleObservedThisRun: event.saleObservedThisRun !== false,
        saleScanCount: positiveInteger(event.saleScanCount, 1),
        saleStatus: normalizeStatus(event.saleStatus),
      });
    });

  return {
    campaigns,
    history: [],
    runId: cleanText(payload.runId) || `legacy-${timestamp}`,
    schemaVersion: SALE_CAMPAIGN_LEDGER_SCHEMA_VERSION,
    updatedAt: timestamp,
  };
}

export function saleCampaignIdFor(event) {
  const sourceId = cleanText(event?.sourceId) || "unknown-source";
  const url = canonicalSaleUrl(event?.sourceUrl);
  const scope = cleanText(event?.saleScope) || "unknown";
  const verification = cleanText(event?.saleVerification) || "unknown";
  const offerType = saleOfferType(`${event?.saleSignal ?? ""} ${event?.saleEvidence ?? ""} ${event?.sourceListingTitle ?? ""}`);
  return `campaign-${sha256(stableJson([sourceId, url, scope, verification, offerType])).slice(0, 20)}`;
}

export function hashSaleContent(event) {
  const signal = normalizedContentText(event?.saleSignal ?? event?.sourceListingTitle ?? event?.title);
  const evidenceText = `${event?.saleEvidence ?? ""} ${event?.saleSignal ?? ""} ${event?.sourceListingTitle ?? ""}`;
  const content = {
    discountPercent: finiteNumberOrNull(event?.saleDiscountPercent),
    offerType: saleOfferType(evidenceText),
    promoCode: extractPromoCode(evidenceText),
    scope: cleanText(event?.saleScope).toLowerCase() || "unknown",
    signal,
    sourceUrl: canonicalSaleUrl(event?.sourceUrl),
    verification: cleanText(event?.saleVerification).toLowerCase() || "unknown",
  };
  return sha256(stableJson(content));
}

export function hashSaleEvidence(event) {
  const evidence = normalizedEvidenceText(event?.saleEvidence ?? event?.saleSignal ?? event?.sourceListingTitle ?? event?.title);
  return sha256(evidence);
}

export function sourceSaleObservationHealth(report) {
  if (!report || typeof report !== "object") return "unknown";
  const explicit = nestedHealthStatus(report.salePageHealth);
  if (explicit) return explicit;

  const reportStatus = cleanText(report.status).toLowerCase();
  if (["error", "failed", "blocked", "timeout", "unavailable", "unknown", "partial"].includes(reportStatus)) return "unknown";
  if (["available", "healthy", "recovered", "success", "ok", "candidates", "empty", "sale_signals"].includes(reportStatus)) return "success";
  return "unknown";
}

function campaignObservationHealth(report, campaign) {
  if (cleanText(campaign?.saleVerification).toLowerCase() === "discovery-lead") {
    return sourceSaleObservationHealth(report);
  }
  const hasUrlDiagnostics =
    Array.isArray(report?.salePageCheckedUrls) ||
    Array.isArray(report?.resolvedUrls);
  const resolvedUrls = [
    ...(Array.isArray(report?.salePageCheckedUrls) ? report.salePageCheckedUrls : []),
    ...(Array.isArray(report?.resolvedUrls) ? report.resolvedUrls : []),
  ].map(canonicalSaleUrl);
  if (resolvedUrls.includes(canonicalSaleUrl(campaign.sourceUrl))) return "success";
  if (hasUrlDiagnostics) return "unknown";
  return sourceSaleObservationHealth(report);
}

function nestedHealthStatus(value) {
  if (typeof value === "string") return normalizedHealthValue(value);
  if (!value || typeof value !== "object") return null;
  const direct = normalizedHealthValue(value.status ?? value.state ?? value.health);
  if (direct) return direct;
  if (value.checked === true && value.success === true) return "success";
  if (value.checked === true && value.success === false) return "unknown";
  if (Number(value.successfulPageCount) > 0 && Number(value.failedPageCount ?? 0) === 0) return "success";
  return null;
}

function normalizedHealthValue(value) {
  const status = cleanText(value).toLowerCase();
  if (!status) return null;
  if (["available", "healthy", "recovered", "success", "ok", "complete", "checked"].includes(status)) return "success";
  if (["error", "failed", "blocked", "timeout", "unavailable", "unknown", "partial", "not_checked"].includes(status)) return "unknown";
  return null;
}

function normalizeLedger(ledger) {
  if (!ledger || typeof ledger !== "object") return emptyLedger();
  return {
    campaigns: (Array.isArray(ledger.campaigns) ? ledger.campaigns : [])
      .filter((campaign) => campaign && typeof campaign === "object")
      .map(normalizeExistingCampaign),
    history: (Array.isArray(ledger.history) ? ledger.history : []).filter((entry) => entry && typeof entry === "object"),
    runId: cleanText(ledger.runId),
    schemaVersion: SALE_CAMPAIGN_LEDGER_SCHEMA_VERSION,
    updatedAt: validIsoTimestamp(ledger.updatedAt) ? ledger.updatedAt : new Date(0).toISOString(),
  };
}

function emptyLedger() {
  return {
    campaigns: [],
    history: [],
    runId: "",
    schemaVersion: SALE_CAMPAIGN_LEDGER_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeExistingCampaign(campaign) {
  const capturedAt = validIsoTimestamp(campaign?.capturedAt) ? campaign.capturedAt : new Date(0).toISOString();
  const normalized = normalizeObservedEvent(campaign, capturedAt);
  return {
    ...campaign,
    ...normalized,
    endedAt: validIsoTimestamp(campaign?.endedAt) ? campaign.endedAt : null,
    firstSeenAt: validIsoTimestamp(campaign?.firstSeenAt) ? campaign.firstSeenAt : capturedAt,
    lastSeenAt: validIsoTimestamp(campaign?.lastSeenAt) ? campaign.lastSeenAt : capturedAt,
    reopenedAt: validIsoTimestamp(campaign?.reopenedAt) ? campaign.reopenedAt : null,
    saleFailureCount: nonNegativeInteger(campaign?.saleFailureCount, 0),
    saleConsecutiveSeenCount: positiveInteger(
      campaign?.saleConsecutiveSeenCount,
      positiveInteger(campaign?.saleScanCount, 1),
    ),
    saleLastCheckedAt: validIsoTimestamp(campaign?.saleLastCheckedAt) ? campaign.saleLastCheckedAt : capturedAt,
    saleMissCount: nonNegativeInteger(campaign?.saleMissCount, 0),
    saleObservedThisRun: campaign?.saleObservedThisRun === true,
    saleScanCount: positiveInteger(campaign?.saleScanCount, 1),
    saleStatus: normalizeStatus(campaign?.saleStatus),
  };
}

function normalizeObservedEvent(event, capturedAt) {
  const saleContentHash = validHash(event?.saleContentHash) ? event.saleContentHash.toLowerCase() : hashSaleContent(event);
  const saleEvidenceHash = validHash(event?.saleEvidenceHash) ? event.saleEvidenceHash.toLowerCase() : hashSaleEvidence(event);
  const saleCampaignId = validCampaignId(event?.saleCampaignId) ? event.saleCampaignId : saleCampaignIdFor(event);
  const saleFingerprint = cleanText(event?.saleFingerprint) || `sale-${saleContentHash.slice(0, 20)}`;
  return {
    ...event,
    capturedAt,
    saleCampaignId,
    saleContentHash,
    saleEvidenceHash,
    saleFingerprint,
  };
}

function dedupeObservations(events) {
  const byObservation = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object" || !cleanText(event.sourceId)) continue;
    const evidenceText = `${event?.saleEvidence ?? ""} ${event?.saleSignal ?? ""} ${event?.sourceListingTitle ?? ""}`;
    const key = [
      saleCampaignIdFor(event),
      finiteNumberOrNull(event?.saleDiscountPercent) ?? "none",
      extractPromoCode(evidenceText) ?? "no-code",
    ].join("|");
    const current = byObservation.get(key);
    if (!current || observationPriority(event) > observationPriority(current)) byObservation.set(key, event);
  }
  return [...byObservation.values()];
}

function observationPriority(event) {
  const verification = event?.saleVerification === "retailer-page" ? 100_000 : 0;
  const discount = finiteNumberOrNull(event?.saleDiscountPercent) ?? 0;
  const evidenceLength = cleanText(event?.saleEvidence).length;
  return verification + discount * 100 + evidenceLength;
}

function observedTransition(prior, campaign, flags) {
  if (!prior) return { fromStatus: null, reason: "first_seen" };
  if (flags.wasEnded) return { fromStatus: "ended", reason: "reopened" };
  if (flags.contentChanged) return { fromStatus: prior.saleStatus, reason: "content_changed" };
  if (flags.wasUnknown) return { fromStatus: "unknown", reason: "source_check_recovered" };
  if (campaign.saleStatus === "evergreen" && prior.saleStatus !== "evergreen") {
    return { fromStatus: prior.saleStatus, reason: "evergreen_threshold_reached" };
  }
  if (prior.saleStatus === "new" || prior.saleStatus === "changed") {
    return { fromStatus: prior.saleStatus, reason: "confirmed_ongoing" };
  }
  if (flags.evidenceChanged) return { fromStatus: prior.saleStatus, reason: "evidence_refreshed" };
  return null;
}

function historyEntry(campaign, runId, at, reason, fromStatus) {
  const idSeed = [runId, campaign.saleCampaignId, at, reason, campaign.saleContentHash, campaign.saleMissCount];
  return {
    at,
    campaignId: campaign.saleCampaignId,
    contentHash: campaign.saleContentHash,
    evidenceHash: campaign.saleEvidenceHash,
    fromStatus: fromStatus ?? null,
    id: `sale-history-${sha256(stableJson(idSeed)).slice(0, 20)}`,
    reason,
    runId,
    sourceId: campaign.sourceId,
    toStatus: campaign.saleStatus,
  };
}

function summarizeCampaigns(campaigns) {
  const byStatus = { changed: 0, ended: 0, evergreen: 0, new: 0, ongoing: 0, unknown: 0 };
  for (const campaign of campaigns) {
    if (campaign.saleStatus in byStatus) byStatus[campaign.saleStatus] += 1;
  }
  return {
    active: campaigns.filter((campaign) => ACTIVE_SALE_STATUSES.has(campaign.saleStatus)).length,
    byStatus,
    total: campaigns.length,
  };
}

function compareCampaigns(left, right) {
  const statusPriority = { new: 6, changed: 5, ongoing: 4, unknown: 3, evergreen: 2, ended: 1 };
  const statusDifference = (statusPriority[right.saleStatus] ?? 0) - (statusPriority[left.saleStatus] ?? 0);
  if (statusDifference) return statusDifference;
  const seenDifference = Date.parse(right.lastSeenAt ?? 0) - Date.parse(left.lastSeenAt ?? 0);
  if (seenDifference) return seenDifference;
  return String(left.saleCampaignId).localeCompare(String(right.saleCampaignId));
}

function normalizeStatus(value) {
  const status = cleanText(value).toLowerCase();
  return ["new", "changed", "ongoing", "evergreen", "ended", "unknown"].includes(status) ? status : "ongoing";
}

function saleOfferType(text) {
  const value = String(text ?? "");
  if (/\b(?:bogo|buy\s+one\s+get\s+one|buy\s+1\s+get\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(value)) return "bogo";
  if (/\b(?:buy\s+more\s+save\s+more|spend\s+\$?\d+\s+(?:get|save))\b/i.test(value)) return "volume";
  if (/\b(?:coupon|promo(?:tional)?\s+code|discount\s+code|use\s+code)\b/i.test(value)) return "coupon";
  if (/\b(?:clearance|closeout|overstock|warehouse\s+sale|final\s+sale)\b/i.test(value)) return "clearance";
  return "sale";
}

function extractPromoCode(text) {
  const match = String(text ?? "").match(/\b(?:code|coupon)\s*[:\-]?\s*["']?([a-z0-9][a-z0-9_-]{2,20})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizedContentText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b(?:today|now|currently|limited time)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedEvidenceText(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function canonicalSaleUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function shortHash(value) {
  return sha256(value).slice(0, 8);
}

function fingerprintLookupKey(sourceId, fingerprint) {
  const source = cleanText(sourceId);
  const value = cleanText(fingerprint);
  return source && value ? `${source}|${value}` : "";
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validIsoTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validCampaignId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{2,127}$/i.test(value);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
