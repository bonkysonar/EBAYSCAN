import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadReviewFeedback,
  pruneStaleSaleFeedback,
  saleFeedbackKey,
  saleCampaignObservationKey,
  saleOutcomeForCampaign,
  saveReviewFeedback,
  setSaleOutcome,
  type ReviewFeedback,
  type SaleReviewOutcome,
} from "../lib/arbitrage/reviewFeedback";
import {
  coverageHealthStatus,
  normalizeSaleCampaigns,
  summarizeSourceCoverage,
  type NormalizedSaleCampaign,
  type SaleObservation,
  type SaleSourceReport,
} from "../lib/arbitrage/saleCampaigns";
import type { ArbitrageImportPayload } from "../lib/arbitrage/types";
import { readJsonResponse } from "../lib/http/jsonResponse";

type CampaignStatus = "changed" | "ended" | "evergreen" | "new" | "ongoing" | "unknown";
type SaleCampaign = SaleObservation;
type DisplaySaleCampaign = NormalizedSaleCampaign;
type SaleHistoryEvent = {
  at: string;
  campaignId: string;
  fromStatus: CampaignStatus | null;
  id: string;
  reason: string;
  runId: string;
  sourceId: string;
  toStatus: CampaignStatus;
};
type PayloadWithSales = ArbitrageImportPayload & {
  phase?: string;
  runId?: string;
  saleCampaignLedger?: { campaigns?: SaleCampaign[]; history?: SaleHistoryEvent[] };
  saleObservations?: SaleCampaign[];
  sourceReports?: SaleSourceReport[];
};
type LatestFindsResponse =
  | { fileName: string; payload: PayloadWithSales; status: "available" }
  | { message: string; status: "empty" };
type HistoryResponse =
  | {
      campaigns: SaleCampaign[];
      events: SaleHistoryEvent[];
      runId: string;
      status: "available";
      summary: Record<CampaignStatus, number>;
      updatedAt: string;
    }
  | { message: string; status: "empty" };
type ErrorResponse = { error: string };

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const HISTORY_TIMEOUT_MS = 5 * 1000;

const saleOutcomes: Array<{ label: string; value: SaleReviewOutcome }> = [
  { label: "Confirmed", value: "confirmed" },
  { label: "False positive", value: "false_positive" },
  { label: "Expired", value: "expired" },
  { label: "Wrong scope", value: "wrong_scope" },
];

export function SiteWideSales() {
  const [campaigns, setCampaigns] = useState<SaleCampaign[]>([]);
  const [historyEvents, setHistoryEvents] = useState<SaleHistoryEvent[]>([]);
  const [sourceReports, setSourceReports] = useState<SaleSourceReport[]>([]);
  const [latestPayload, setLatestPayload] = useState<PayloadWithSales | null>(null);
  const [feedback, setFeedback] = useState<ReviewFeedback>(() => loadReviewFeedback());
  const [latestMessage, setLatestMessage] = useState<string | null>(null);
  const [isLoadingLatest, setIsLoadingLatest] = useState(true);
  const hasLoadedLatestRef = useRef(false);
  const lastResumeRefreshRef = useRef(0);
  const latestRequestRef = useRef(0);

  const normalizedSales = useMemo(
    () => normalizeSaleCampaigns(campaigns, latestPayload?.saleObservations ?? (latestPayload?.saleEvents as SaleCampaign[] | undefined) ?? []),
    [campaigns, latestPayload],
  );
  const grouped = useMemo(() => groupCampaigns(normalizedSales.campaigns, feedback), [normalizedSales.campaigns, feedback]);
  const activeCampaigns = [...grouped.new, ...grouped.changed, ...grouped.ongoing, ...grouped.evergreen];
  const activeRetailers = new Set(activeCampaigns.map((campaign) => campaign.sourceId)).size;
  const coverage = useMemo(() => summarizeSourceCoverage(sourceReports), [sourceReports]);
  const historyByCampaign = useMemo(() => {
    const historyByRawCampaign = new Map<string, SaleHistoryEvent[]>();
    for (const event of historyEvents) {
      historyByRawCampaign.set(event.campaignId, [...(historyByRawCampaign.get(event.campaignId) ?? []), event]);
    }
    const groupedHistory = new Map<string, SaleHistoryEvent[]>();
    for (const campaign of normalizedSales.campaigns) {
      const ids = campaign.mergedCampaignIds.length
        ? campaign.mergedCampaignIds
        : campaign.saleCampaignId
          ? [campaign.saleCampaignId]
          : [];
      const events = ids
        .flatMap((id) => historyByRawCampaign.get(id) ?? [])
        .filter((event, index, values) => values.findIndex((candidate) => candidate.id === event.id) === index)
        .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
      groupedHistory.set(campaignKey(campaign), events);
    }
    return groupedHistory;
  }, [historyEvents, normalizedSales.campaigns]);

  useEffect(() => saveReviewFeedback(feedback), [feedback]);
  useEffect(() => {
    lastResumeRefreshRef.current = Date.now();
    void loadLatestSales();
    const refreshInterval = window.setInterval(() => {
      void loadLatestSales();
    }, AUTO_REFRESH_INTERVAL_MS);
    const refreshAfterResume = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastResumeRefreshRef.current < 1_000) return;
      lastResumeRefreshRef.current = now;
      void loadLatestSales();
    };
    window.addEventListener("focus", refreshAfterResume);
    document.addEventListener("visibilitychange", refreshAfterResume);
    return () => {
      latestRequestRef.current += 1;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshAfterResume);
      document.removeEventListener("visibilitychange", refreshAfterResume);
    };
  }, []);

  async function loadLatestSales() {
    const requestId = ++latestRequestRef.current;
    setIsLoadingLatest(true);
    try {
      const latestResponse = await fetch(`/api/arbitrage/latest?ts=${Date.now()}`, {
        cache: "no-store",
      });
      const latest = await readJsonResponse<ErrorResponse | LatestFindsResponse>(
        latestResponse,
        "Latest sales endpoint",
      );
      if (requestId !== latestRequestRef.current) return;
      if ("error" in latest) throw new Error(latest.error);
      if (!latestResponse.ok) throw new Error("Latest sale load failed.");
      if (latest.status === "empty") {
        hasLoadedLatestRef.current = true;
        setCampaigns([]);
        setHistoryEvents([]);
        setSourceReports([]);
        setLatestPayload(null);
        setLatestMessage(latest.message);
        return;
      }

      const fallbackCampaigns = mergeCampaigns([
        ...(latest.payload.saleCampaignLedger?.campaigns ?? []),
        ...((latest.payload.saleEvents ?? latest.payload.finds) as SaleCampaign[]),
      ]);
      const embeddedEvents = latest.payload.saleCampaignLedger?.history ?? [];
      const normalized = normalizeSaleCampaigns(
        fallbackCampaigns,
        latest.payload.saleObservations ?? ((latest.payload.saleEvents ?? latest.payload.finds) as SaleCampaign[]),
      );
      const baseMessage = `Loaded ${normalized.uniqueOfferCount} active offers from ${normalized.retailerCount} retailers across ${normalized.pageCount} sale pages (${normalized.rawObservationCount} raw observations) from ${latest.fileName}.`;
      setCampaigns(fallbackCampaigns);
      setHistoryEvents(embeddedEvents);
      setSourceReports(latest.payload.sourceReports ?? []);
      setLatestPayload(latest.payload);
      hasLoadedLatestRef.current = true;
      setFeedback((current) => pruneStaleSaleFeedback(current, fallbackCampaigns));
      setLatestMessage(baseMessage);
      void loadHistoryForLatest(latest.payload.runId, requestId, baseMessage);
    } catch (caught) {
      if (requestId !== latestRequestRef.current) return;
      const message = caught instanceof Error ? caught.message : "Latest sale load failed.";
      if (!hasLoadedLatestRef.current) {
        setCampaigns([]);
        setHistoryEvents([]);
        setSourceReports([]);
        setLatestPayload(null);
        setLatestMessage(message);
      } else {
        setLatestMessage(`Refresh failed; keeping the last verified publication. ${message}`);
      }
    } finally {
      if (requestId === latestRequestRef.current) setIsLoadingLatest(false);
    }
  }

  async function loadHistoryForLatest(
    expectedRunId: string | undefined,
    requestId: number,
    baseMessage: string,
  ) {
    if (!expectedRunId) {
      if (requestId === latestRequestRef.current) {
        setLatestMessage(`${baseMessage} Campaign history was not used because the latest run has no run ID.`);
      }
      return;
    }

    try {
      const historyResponse = await fetchWithTimeout(
        `/api/arbitrage/history?limit=500&ts=${Date.now()}`,
        { cache: "no-store" },
        HISTORY_TIMEOUT_MS,
      );
      const history = await readJsonResponse<ErrorResponse | HistoryResponse>(
        historyResponse,
        "Sale history endpoint",
      );
      if (requestId !== latestRequestRef.current) return;
      if ("error" in history) throw new Error(history.error);
      if (!historyResponse.ok || history.status !== "available") {
        setLatestMessage(`${baseMessage} Campaign history was unavailable.`);
        return;
      }
      if (history.runId !== expectedRunId) {
        setLatestMessage(
          `${baseMessage} Campaign history was ignored because it belongs to run ${history.runId}.`,
        );
        return;
      }

      const nextCampaigns = mergeCampaigns(history.campaigns);
      setCampaigns(nextCampaigns);
      setHistoryEvents(history.events);
      setFeedback((current) => pruneStaleSaleFeedback(current, nextCampaigns));
    } catch {
      if (requestId === latestRequestRef.current) {
        setLatestMessage(`${baseMessage} Campaign history was unavailable.`);
      }
    }
  }

  function reviewCampaign(campaign: DisplaySaleCampaign, outcome: SaleReviewOutcome | null) {
    const key = saleFeedbackKey(campaign);
    setFeedback((current) =>
      setSaleOutcome(
        current,
        key,
        outcome,
        undefined,
        saleCampaignObservationKey(campaign),
      ),
    );
  }

  return (
    <section className="site-sales-page">
      <div className="seller-hero panel compact-seller-hero site-sale-hero">
        <div>
          <span className="eyebrow">Campaign lifecycle, not a repeated snapshot</span>
          <h2>Site-wide Sales</h2>
          <p>
            New and changed campaigns lead, while every active ongoing and evergreen offer remains
            open below. Page, sort, and collection-tag duplicates are combined without merging distinct
            offers from the same retailer.
          </p>
        </div>
        <div className="seller-actions">
          <button type="button" onClick={loadLatestSales} disabled={isLoadingLatest}>
            {isLoadingLatest ? "Loading..." : "Reload scan data"}
          </button>
        </div>
      </div>

      {latestMessage ? <div className="warning-box">{latestMessage}</div> : null}

      <div className="seller-stats compact-seller-stats site-sale-stats">
        <Stat label="Active retailers" value={activeRetailers} />
        <Stat label="Unique offers" value={activeCampaigns.length} />
        <Stat label="Sale pages" value={normalizedSales.pageCount} />
        <Stat label="Raw observations" value={normalizedSales.rawObservationCount} />
        <Stat label="New / changed" value={grouped.new.length + grouped.changed.length} tone="new" />
        <Stat label="Healthy" value={coverage.healthy} />
        <Stat label="Degraded" value={coverage.degraded} tone={coverage.degraded ? "warn" : undefined} />
        <Stat label="Empty" value={coverage.empty} tone={coverage.empty ? "warn" : undefined} />
        <Stat label="Blocked" value={coverage.blocked} tone={coverage.blocked ? "warn" : undefined} />
      </div>

      <section className="panel site-sale-run-strip">
        <div>
          <strong>{latestPayload?.runId ?? "No run loaded"}</strong>
          <span>{latestPayload ? `Last scan ${formatAge(latestPayload.createdAt)}` : "No scan time"}</span>
        </div>
        <div>
          <strong>Automation target: daily at 5:30 local</strong>
          <span>
            {coverage.total
              ? `${coverage.healthy} healthy · ${coverage.degraded} degraded · ${coverage.empty} empty · ${coverage.blocked} blocked · ${coverage.not_checked} not checked`
              : "Source coverage unavailable"}
          </span>
        </div>
      </section>

      {grouped.new.length + grouped.changed.length > 0 ? (
        <section className="site-sale-priority">
          <div className="section-heading">
            <div>
              <h2>New and changed</h2>
              <span>Review these first</span>
            </div>
          </div>
          <div className="site-sale-grid">
            {[...grouped.new, ...grouped.changed].map((campaign) => (
              <SaleCard
                campaign={campaign}
                feedback={feedback}
                history={historyByCampaign.get(campaignKey(campaign)) ?? []}
                key={campaignKey(campaign)}
                onReview={(outcome) => reviewCampaign(campaign, outcome)}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="empty-state site-sale-empty">
          <h2>No new or changed campaigns</h2>
          <p>The scanner still tracks ongoing, evergreen, unknown, and ended campaigns below.</p>
        </section>
      )}

      <CampaignShelf
        title="Ongoing"
        subtitle="Recently reconfirmed campaigns"
        campaigns={grouped.ongoing}
        feedback={feedback}
        historyByCampaign={historyByCampaign}
        onReview={reviewCampaign}
        open
      />
      <CampaignShelf
        title="Needs source repair"
        subtitle="Not active recommendations: the offer disappeared, but its source check was not healthy enough to prove it ended"
        campaigns={grouped.unknown}
        feedback={feedback}
        historyByCampaign={historyByCampaign}
        onReview={reviewCampaign}
      />
      <CampaignShelf
        title="Evergreen"
        subtitle="Repeated for five or more successful observations"
        campaigns={grouped.evergreen}
        feedback={feedback}
        historyByCampaign={historyByCampaign}
        onReview={reviewCampaign}
        open
      />
      <CampaignShelf
        title="Ended and reviewed out"
        subtitle="Ended after repeated healthy misses, or removed from your active view by feedback"
        campaigns={[...grouped.ended, ...grouped.reviewedOut]}
        feedback={feedback}
        historyByCampaign={historyByCampaign}
        onReview={reviewCampaign}
      />

      {sourceReports.length ? (
        <details className="panel site-sale-coverage">
          <summary>
            <span>
              <strong>Source coverage</strong>
              <small>
                {coverage.total} sources · {coverage.healthy} healthy · {coverage.degraded} degraded · {coverage.empty} empty · {coverage.blocked} blocked · {coverage.not_checked} not checked
              </small>
            </span>
            <span>Inspect</span>
          </summary>
          <div className="site-sale-coverage-list">
            {coverage.sources.map(({ report, state }) => (
              <a
                className={
                  state === "blocked"
                    ? "coverage-error"
                    : state === "degraded" || state === "empty"
                      ? "coverage-partial"
                      : ""
                }
                href={report.resolvedUrls?.[0] ?? report.url ?? "#"}
                key={report.id}
                rel="noreferrer"
                target="_blank"
              >
                <span>{report.name}</span>
                <small>{coverageLabel(report, state)}</small>
              </a>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function CampaignShelf({
  campaigns,
  feedback,
  historyByCampaign,
  onReview,
  open = false,
  subtitle,
  title,
}: {
  campaigns: DisplaySaleCampaign[];
  feedback: ReviewFeedback;
  historyByCampaign: Map<string, SaleHistoryEvent[]>;
  onReview: (campaign: DisplaySaleCampaign, outcome: SaleReviewOutcome | null) => void;
  open?: boolean;
  subtitle: string;
  title: string;
}) {
  if (!campaigns.length) return null;
  return (
    <details className="panel site-sale-shelf" open={open}>
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span>{campaigns.length}</span>
      </summary>
      <div className="site-sale-grid">
        {campaigns.map((campaign) => (
          <SaleCard
            campaign={campaign}
            feedback={feedback}
            history={historyByCampaign.get(campaignKey(campaign)) ?? []}
            key={campaignKey(campaign)}
            onReview={(outcome) => onReview(campaign, outcome)}
          />
        ))}
      </div>
    </details>
  );
}

function SaleCard({
  campaign,
  feedback,
  history,
  onReview,
}: {
  campaign: DisplaySaleCampaign;
  feedback: ReviewFeedback;
  history: SaleHistoryEvent[];
  onReview: (outcome: SaleReviewOutcome | null) => void;
}) {
  const outcome = saleOutcomeForCampaign(feedback, campaign);
  const latestTransition = history[0];
  return (
    <article
      className={`panel site-sale-card sale-status-${campaign.saleStatus ?? "ongoing"} ${
        outcome ? `sale-reviewed-${outcome}` : ""
      }`}
      data-sale-status={campaign.saleStatus}
    >
      <div className="site-sale-card-header">
        <div>
          <span className={`site-sale-status status-${campaign.saleStatus ?? "ongoing"}`}>
            {campaign.saleStatus ?? "ongoing"}
          </span>
          <h3>{campaign.sourceName}</h3>
          <small>
            {campaign.saleVerification === "discovery-lead" ? "Unverified discovery lead" : "Retailer evidence"}
            {" · "}
            {campaign.saleScope ?? "sale"}
          </small>
        </div>
        <strong>{saleDiscountLabel(campaign)}</strong>
      </div>

      <p>{campaign.saleSignal ?? campaign.sourceListingTitle ?? campaign.title}</p>
      {campaign.saleEvidence ? <blockquote>{campaign.saleEvidence}</blockquote> : null}

      <dl className="site-sale-meta">
        <Metric label="First seen" value={formatDate(campaign.firstSeenAt ?? campaign.capturedAt)} />
        <Metric label="Last seen" value={formatDate(campaign.lastSeenAt ?? campaign.capturedAt)} />
        <Metric label="Successful scans" value={campaign.saleScanCount ?? 1} />
        <Metric
          label="Raw evidence"
          value={`${campaign.saleObservationCount} observation${campaign.saleObservationCount === 1 ? "" : "s"} · ${campaign.saleObservationPageCount} sale page${campaign.saleObservationPageCount === 1 ? "" : "s"}`}
        />
        <Metric
          label="Confidence"
          value={campaign.saleVerification === "retailer-page" ? "Retailer-confirmed" : "Needs confirmation"}
        />
        <Metric
          label="Latest change"
          value={
            latestTransition
              ? `${humanize(latestTransition.reason)} · ${formatDate(latestTransition.at)}`
              : campaign.saleStatus === "new"
                ? "First observation"
                : "No recorded transition"
          }
        />
        <Metric
          label="Observation"
          value={
            campaign.saleStatus === "unknown"
              ? `${campaign.saleFailureCount ?? 1} failed check(s)`
              : campaign.saleObservedThisRun === false
                ? `${campaign.saleMissCount ?? 0} healthy miss(es)`
                : "Seen this run"
          }
        />
      </dl>

      <div className="site-sale-card-actions">
        <a href={campaign.sourceUrl} target="_blank" rel="noreferrer">
          {campaign.saleVerification === "discovery-lead" ? "Open lead" : "Open evidence"}
        </a>
        <small>{history.length} lifecycle event{history.length === 1 ? "" : "s"}</small>
      </div>

      <div className="site-sale-feedback">
        {saleOutcomes.map((option) => (
          <button
            className={outcome === option.value ? "active" : ""}
            type="button"
            key={option.value}
            onClick={() => onReview(outcome === option.value ? null : option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </article>
  );
}

function groupCampaigns(campaigns: DisplaySaleCampaign[], feedback: ReviewFeedback) {
  const groups: Record<CampaignStatus | "reviewedOut", DisplaySaleCampaign[]> = {
    changed: [],
    ended: [],
    evergreen: [],
    new: [],
    ongoing: [],
    reviewedOut: [],
    unknown: [],
  };
  for (const campaign of campaigns) {
    const outcome = saleOutcomeForCampaign(feedback, campaign);
    if (outcome && outcome !== "confirmed") {
      groups.reviewedOut.push(campaign);
      continue;
    }
    groups[campaign.saleStatus ?? "ongoing"].push(campaign);
  }
  for (const values of Object.values(groups)) values.sort(compareCampaigns);
  return groups;
}

function mergeCampaigns(campaigns: SaleCampaign[]): SaleCampaign[] {
  const byCampaign = new Map<string, SaleCampaign>();
  for (const campaign of campaigns) {
    if (campaign.opportunityType !== "sitewide_sale") continue;
    const key = campaignKey(campaign);
    const current = byCampaign.get(key);
    if (!current || campaignPriority(campaign) >= campaignPriority(current)) {
      byCampaign.set(key, { ...current, ...campaign });
    }
  }
  return [...byCampaign.values()];
}

function campaignKey(campaign: SaleCampaign | DisplaySaleCampaign): string {
  return "displayCampaignKey" in campaign
    ? campaign.displayCampaignKey
    : campaign.saleCampaignId || campaign.saleFingerprint || campaign.id;
}

function campaignPriority(campaign: SaleCampaign): number {
  return (
    statusPriority(campaign.saleStatus) * 1_000_000 +
    new Date(campaign.lastSeenAt ?? campaign.capturedAt).getTime()
  );
}

function compareCampaigns(left: DisplaySaleCampaign, right: DisplaySaleCampaign): number {
  return (
    statusPriority(right.saleStatus) - statusPriority(left.saleStatus) ||
    new Date(right.lastSeenAt ?? right.capturedAt).getTime() -
      new Date(left.lastSeenAt ?? left.capturedAt).getTime()
  );
}

function statusPriority(status?: CampaignStatus): number {
  if (status === "new") return 6;
  if (status === "changed") return 5;
  if (status === "ongoing") return 4;
  if (status === "unknown") return 3;
  if (status === "evergreen") return 2;
  if (status === "ended") return 1;
  return 0;
}

function coverageLabel(report: SaleSourceReport, state: ReturnType<typeof summarizeSourceCoverage>["sources"][number]["state"]): string {
  const prefix = state === "not_checked" ? "Not checked" : `${state[0].toUpperCase()}${state.slice(1)}`;
  if (["blocked", "error", "failed", "timeout", "unavailable", "unknown"].includes(coverageHealthStatus(report.salePageHealth))) {
    return `${prefix} · sale-page checks failed`;
  }
  if (state === "blocked") return `${prefix} · ${report.error ?? "source fetch failed"}`;
  const recovery = report.pageErrors?.some((error) => error.failureKind === "not_found")
    ? " · stale URL bypassed"
    : "";
  if ((report.saleEventCount ?? 0) > 0) {
    return `${prefix} · ${report.saleEventCount} parsed sale signal${report.saleEventCount === 1 ? "" : "s"}${recovery}`;
  }
  if ((report.candidateCount ?? 0) > 0) return `${prefix} · ${report.candidateCount} parsed products${recovery}`;
  if (state === "empty") return `${prefix} · pages reached, no parsed offers or products${recovery}`;
  return `${prefix}${recovery}`;
}

function saleSignalLabel(sale: DisplaySaleCampaign): string {
  if (/\b(?:bogo|buy\s+one|buy\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(sale.saleSignal ?? "")) {
    return "BOGO";
  }
  if (/\b(?:code|coupon|promo)\b/i.test(sale.saleSignal ?? "")) return "Code";
  return "Sale";
}

function saleDiscountLabel(sale: DisplaySaleCampaign): string {
  if (!sale.saleDiscountPercent) return saleSignalLabel(sale);
  const evidence = [sale.saleEvidence, sale.saleSignal, sale.sourceListingTitle, sale.title].filter(Boolean).join(" ");
  const escapedDiscount = String(sale.saleDiscountPercent).replace(".", "\\.");
  const upTo =
    sale.saleDiscountQualifier === "up_to" ||
    new RegExp(`\\bup\\s+to\\s+(?:an?\\s+)?${escapedDiscount}\\s*(?:%|percent)\\s*off\\b`, "i").test(evidence);
  return upTo ? `Up to ${sale.saleDiscountPercent}% off` : `${sale.saleDiscountPercent}% off`;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatAge(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Stat({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "changed" | "new" | "warn";
  value: number | string;
}) {
  return (
    <div className={`seller-stat panel ${tone ? `stat-${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
