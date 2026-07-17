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
import type { ArbitrageFind, ArbitrageImportPayload } from "../lib/arbitrage/types";
import { readJsonResponse } from "../lib/http/jsonResponse";

type CampaignStatus = "changed" | "ended" | "evergreen" | "new" | "ongoing" | "unknown";
type SaleCampaign = Omit<ArbitrageFind, "saleStatus"> & {
  endedAt?: string | null;
  lastSeenAt?: string;
  reopenedAt?: string | null;
  saleCampaignId?: string;
  saleConsecutiveSeenCount?: number;
  saleFailureCount?: number;
  saleLastCheckedAt?: string;
  saleMissCount?: number;
  saleObservedThisRun?: boolean;
  saleScanCount?: number;
  saleStatus?: CampaignStatus;
};
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
type SourceReport = {
  candidateCount?: number;
  catalogHealth?: string;
  error?: string;
  id: string;
  name: string;
  pageErrors?: Array<{ failureKind?: string; requestedUrl: string }>;
  priority?: number | null;
  resolvedUrls?: string[];
  saleEventCount?: number;
  salePageAvailableCount?: number;
  salePageHealth?: string;
  status: string;
  url?: string;
};
type PayloadWithSales = ArbitrageImportPayload & {
  phase?: string;
  runId?: string;
  saleCampaignLedger?: { campaigns?: SaleCampaign[]; history?: SaleHistoryEvent[] };
  sourceReports?: SourceReport[];
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
  const [sourceReports, setSourceReports] = useState<SourceReport[]>([]);
  const [latestPayload, setLatestPayload] = useState<PayloadWithSales | null>(null);
  const [feedback, setFeedback] = useState<ReviewFeedback>(() => loadReviewFeedback());
  const [latestMessage, setLatestMessage] = useState<string | null>(null);
  const [isLoadingLatest, setIsLoadingLatest] = useState(true);
  const hasLoadedLatestRef = useRef(false);
  const lastResumeRefreshRef = useRef(0);
  const latestRequestRef = useRef(0);

  const grouped = useMemo(() => groupCampaigns(campaigns, feedback), [campaigns, feedback]);
  const coverage = summarizeCoverage(sourceReports);
  const historyByCampaign = useMemo(() => {
    const groupedHistory = new Map<string, SaleHistoryEvent[]>();
    for (const event of historyEvents) {
      groupedHistory.set(event.campaignId, [...(groupedHistory.get(event.campaignId) ?? []), event]);
    }
    for (const [campaignId, events] of groupedHistory) {
      groupedHistory.set(
        campaignId,
        [...events].sort((left, right) => Date.parse(right.at) - Date.parse(left.at)),
      );
    }
    return groupedHistory;
  }, [historyEvents]);

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
      const baseMessage = `Loaded ${fallbackCampaigns.length} tracked campaigns from ${latest.fileName}.`;
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

  function reviewCampaign(campaign: SaleCampaign, outcome: SaleReviewOutcome | null) {
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
            New and changed campaigns lead. Long-running offers stay quieter, failed checks become
            unknown diagnostics instead of staying in the active-sale feed, and simultaneous campaigns
            from one retailer remain separate.
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
        <Stat label="New" value={grouped.new.length} tone="new" />
        <Stat label="Changed" value={grouped.changed.length} tone="changed" />
        <Stat label="Ongoing" value={grouped.ongoing.length} />
        <Stat label="Evergreen" value={grouped.evergreen.length} />
        <Stat label="Unknown" value={grouped.unknown.length} tone={grouped.unknown.length ? "warn" : undefined} />
        <Stat label="Ended" value={grouped.ended.length} />
        <Stat
          label="Sale-page coverage"
          value={coverage.hasSaleDiagnostics ? `${coverage.saleCapable}/${coverage.attempted}` : "Unavailable"}
        />
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
            {coverage.hasSaleDiagnostics
              ? `${coverage.healthy} healthy · ${coverage.degraded} degraded · ${coverage.blocked} blocked`
              : `${coverage.attempted} legacy source reports · sale diagnostics unavailable`}
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
        open={grouped.new.length + grouped.changed.length === 0}
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
                {coverage.hasSaleDiagnostics
                  ? `${coverage.attempted} attempted · ${coverage.saleCapable} sale-page capable · ${coverage.degraded} degraded · ${coverage.blocked} blocked`
                  : `${coverage.attempted} legacy reports · sale-page diagnostics unavailable`}
              </small>
            </span>
            <span>Inspect</span>
          </summary>
          <div className="site-sale-coverage-list">
            {sourceReports.map((report) => (
              <a
                className={
                  coverageBucket(report) === "blocked"
                    ? "coverage-error"
                    : coverageBucket(report) === "degraded"
                      ? "coverage-partial"
                      : ""
                }
                href={report.resolvedUrls?.[0] ?? report.url}
                key={report.id}
                rel="noreferrer"
                target="_blank"
              >
                <span>{report.name}</span>
                <small>{coverageLabel(report)}</small>
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
  campaigns: SaleCampaign[];
  feedback: ReviewFeedback;
  historyByCampaign: Map<string, SaleHistoryEvent[]>;
  onReview: (campaign: SaleCampaign, outcome: SaleReviewOutcome | null) => void;
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
  campaign: SaleCampaign;
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
        <strong>{campaign.saleDiscountPercent ? `${campaign.saleDiscountPercent}%+` : saleSignalLabel(campaign)}</strong>
      </div>

      <p>{campaign.saleSignal ?? campaign.sourceListingTitle ?? campaign.title}</p>
      {campaign.saleEvidence ? <blockquote>{campaign.saleEvidence}</blockquote> : null}

      <dl className="site-sale-meta">
        <Metric label="First seen" value={formatDate(campaign.firstSeenAt ?? campaign.capturedAt)} />
        <Metric label="Last seen" value={formatDate(campaign.lastSeenAt ?? campaign.capturedAt)} />
        <Metric label="Successful scans" value={campaign.saleScanCount ?? 1} />
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

function groupCampaigns(campaigns: SaleCampaign[], feedback: ReviewFeedback) {
  const groups: Record<CampaignStatus | "reviewedOut", SaleCampaign[]> = {
    changed: [],
    ended: [],
    evergreen: [],
    new: [],
    ongoing: [],
    reviewedOut: [],
    unknown: [],
  };
  for (const campaign of mergeCampaigns(campaigns)) {
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

function campaignKey(campaign: SaleCampaign): string {
  return campaign.saleCampaignId || campaign.saleFingerprint || campaign.id;
}

function campaignPriority(campaign: SaleCampaign): number {
  return (
    statusPriority(campaign.saleStatus) * 1_000_000 +
    new Date(campaign.lastSeenAt ?? campaign.capturedAt).getTime()
  );
}

function compareCampaigns(left: SaleCampaign, right: SaleCampaign): number {
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

function summarizeCoverage(reports: SourceReport[]) {
  const attempted = reports.length;
  const buckets = reports.map(coverageBucket);
  const healthy = buckets.filter((bucket) => bucket === "healthy").length;
  const degraded = buckets.filter((bucket) => bucket === "degraded").length;
  const blocked = buckets.filter((bucket) => bucket === "blocked").length;
  const hasSaleDiagnostics = reports.some(
    (report) =>
      report.salePageHealth !== undefined ||
      report.salePageAvailableCount !== undefined,
  );
  const saleCapable = reports.filter(
    (report) =>
      (report.salePageAvailableCount ?? 0) > 0 ||
      report.salePageHealth === "healthy" ||
      report.salePageHealth === "partial",
  ).length;
  return { attempted, blocked, degraded, hasSaleDiagnostics, healthy, saleCapable };
}

function coverageBucket(report: SourceReport): "blocked" | "degraded" | "healthy" {
  if (report.status === "error") return "blocked";
  if (
    report.status === "partial" ||
    report.catalogHealth === "partial" ||
    report.salePageHealth === "partial"
  ) {
    return "degraded";
  }
  const attemptedHealth = [report.catalogHealth, report.salePageHealth].filter(
    (health) => health && health !== "not_attempted" && health !== "not_checked",
  );
  if (attemptedHealth.length > 0 && attemptedHealth.every((health) => health === "failed")) {
    return "blocked";
  }
  if (attemptedHealth.some((health) => health === "failed")) return "degraded";
  return "healthy";
}

function coverageLabel(report: SourceReport): string {
  if (report.status === "error") return report.error ?? "blocked";
  const recovery = report.pageErrors?.some((error) => error.failureKind === "not_found")
    ? " · stale URL bypassed"
    : "";
  if ((report.saleEventCount ?? 0) > 0) {
    return `${report.saleEventCount} sale signal${report.saleEventCount === 1 ? "" : "s"}${recovery}`;
  }
  if ((report.salePageAvailableCount ?? 0) > 0) {
    return `${report.salePageAvailableCount} sale page${report.salePageAvailableCount === 1 ? "" : "s"}${recovery}`;
  }
  if ((report.candidateCount ?? 0) > 0) return `${report.candidateCount} products${recovery}`;
  return `checked${recovery}`;
}

function saleSignalLabel(sale: SaleCampaign): string {
  if (/\b(?:bogo|buy\s+one|buy\s+1|2\s+for\s+1|two\s+for\s+one)\b/i.test(sale.saleSignal ?? "")) {
    return "BOGO";
  }
  if (/\b(?:code|coupon|promo)\b/i.test(sale.saleSignal ?? "")) return "Code";
  return "Sale";
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
