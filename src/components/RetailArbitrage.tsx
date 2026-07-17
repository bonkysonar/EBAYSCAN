import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { assessRecordCandidate } from "../../scripts/lib/candidatePipeline.mjs";
import { buildNewVinylResearchUrl, buildResearchKeywords } from "../lib/arbitrage/normalizeResearch";
import {
  loadReviewFeedback,
  pruneStaleRecordFeedback,
  recordOutcomeForFind,
  retailOfferFeedbackKey,
  saveReviewFeedback,
  setRecordOutcome,
  type RecordOutcome,
  type ReviewFeedback,
} from "../lib/arbitrage/reviewFeedback";
import { evaluateOpportunity } from "../lib/arbitrage/rules";
import {
  loadArbitrageFinds,
  loadArbitrageSettings,
  saveArbitrageFinds,
  saveArbitrageSettings,
} from "../lib/arbitrage/storage";
import type {
  ArbitrageFind,
  ArbitrageImportPayload,
  ArbitrageScoredFind,
  ArbitrageSettings,
} from "../lib/arbitrage/types";
import { readJsonResponse } from "../lib/http/jsonResponse";

type DecisionFilter =
  | "ALL"
  | "BUY"
  | "DISMISSED"
  | "NEEDS_VALIDATION"
  | "REJECT"
  | "TRACKED"
  | "WATCH";
type SortDirection = "asc" | "desc";
type SortKey =
  | "long_term_supply"
  | "price"
  | "priority"
  | "profit_rate"
  | "source"
  | "title"
  | "turn"
  | "velocity";
type ProductParseHealth = "empty" | "failed" | "not_attempted" | "productive";
type UsableCoverage =
  | "high_signal"
  | "not_attempted"
  | "parser_empty"
  | "raw_candidates"
  | "selected"
  | "unavailable";
type SourceReport = {
  adapterStats?: {
    adapter?: string;
    adapterFamily?: string;
  };
  candidateCount?: number;
  catalogHealth?: string;
  catalogPageAttemptCount?: number;
  catalogPageAvailableCount?: number;
  error?: string;
  highSignalCandidateCount?: number;
  id: string;
  name: string;
  ownHistoryMatchedCandidateCount?: number;
  priority?: number | null;
  productParseHealth?: ProductParseHealth;
  salePageAvailableCount?: number;
  salePageHealth?: string;
  selectedProductFindCount?: number;
  status: string;
  usableCoverage?: UsableCoverage;
};
type PayloadWithDiagnostics = ArbitrageImportPayload & {
  phase?: string;
  runId?: string;
  sourceReports?: SourceReport[];
  summary?: Record<string, unknown>;
};
type LatestFindsResponse =
  | { fileName: string; payload: PayloadWithDiagnostics; status: "available" }
  | { message: string; status: "empty" };
type LatestFindsErrorResponse = { error: string };

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EVALUATION_CLOCK_INTERVAL_MS = 60 * 1000;

const decisionOptions: Array<{ label: string; value: DecisionFilter }> = [
  { label: "Buy now", value: "BUY" },
  { label: "Needs validation", value: "NEEDS_VALIDATION" },
  { label: "Watch", value: "WATCH" },
  { label: "Reject", value: "REJECT" },
  { label: "Purchased / tracked", value: "TRACKED" },
  { label: "Rejected by me", value: "DISMISSED" },
  { label: "All", value: "ALL" },
];

const outcomeOptions: Array<{ label: string; value: RecordOutcome }> = [
  { label: "Bought", value: "bought" },
  { label: "Listed", value: "listed" },
  { label: "Sold", value: "sold" },
  { label: "Returned", value: "returned" },
  { label: "Not for me", value: "not_for_me" },
  { label: "Too slow", value: "too_slow" },
  { label: "Margin too thin", value: "margin_too_thin" },
  { label: "False positive", value: "false_positive" },
];

const sortableColumns: Array<{ key: SortKey; label: string }> = [
  { key: "priority", label: "Priority" },
  { key: "title", label: "Record" },
  { key: "price", label: "Buy cost" },
  { key: "profit_rate", label: "Profit / 30d" },
  { key: "turn", label: "Est. turn" },
  { key: "velocity", label: "Sales pace" },
  { key: "long_term_supply", label: "Supply" },
  { key: "source", label: "Evidence / source" },
];

export function RetailArbitrage() {
  const [finds, setFinds] = useState<ArbitrageFind[]>(() => loadArbitrageFinds());
  const [settings, setSettings] = useState<ArbitrageSettings>(() => loadArbitrageSettings());
  const [feedback, setFeedback] = useState<ReviewFeedback>(() => loadReviewFeedback());
  const [latestPayload, setLatestPayload] = useState<PayloadWithDiagnostics | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [latestMessage, setLatestMessage] = useState<string | null>(null);
  const [isLoadingLatest, setIsLoadingLatest] = useState(true);
  const [hasAuthoritativeLatest, setHasAuthoritativeLatest] = useState(false);
  const [evaluationNow, setEvaluationNow] = useState(() => Date.now());
  const authoritativeLatestRef = useRef(false);
  const findsRef = useRef(finds);
  const lastResumeRefreshRef = useRef(0);
  const latestRequestRef = useRef(0);

  const scoredFinds = useMemo(
    () =>
      hasAuthoritativeLatest
        ? finds
            .filter(isIndividualRecordFind)
            .map((find) => evaluateOpportunity(find, settings, evaluationNow))
        : [],
    [evaluationNow, finds, hasAuthoritativeLatest, settings],
  );
  const visibleFinds = useMemo(
    () =>
      filterAndSortFinds(
        scoredFinds,
        feedback,
        decisionFilter,
        sourceFilter,
        sortKey,
        sortDirection,
      ),
    [decisionFilter, feedback, scoredFinds, sortDirection, sortKey, sourceFilter],
  );
  const selectedFind =
    visibleFinds.find((find) => find.id === selectedId) ?? visibleFinds[0] ?? null;
  const stats = summarizeFinds(scoredFinds, feedback);
  const coverage = summarizeCoverage(latestPayload);
  const sourceOptions = useMemo(
    () =>
      [...new Map(scoredFinds.map((find) => [find.sourceId, find.sourceName])).entries()].sort((left, right) =>
        left[1].localeCompare(right[1]),
      ),
    [scoredFinds],
  );

  useEffect(() => saveArbitrageFinds(finds), [finds]);
  useEffect(() => saveArbitrageSettings(settings), [settings]);
  useEffect(() => saveReviewFeedback(feedback), [feedback]);
  useEffect(() => {
    lastResumeRefreshRef.current = Date.now();
    void loadLatestFinds();
    const refreshInterval = window.setInterval(() => {
      void loadLatestFinds();
    }, AUTO_REFRESH_INTERVAL_MS);
    const evaluationInterval = window.setInterval(() => {
      setEvaluationNow(Date.now());
    }, EVALUATION_CLOCK_INTERVAL_MS);
    const refreshAfterResume = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      setEvaluationNow(now);
      if (now - lastResumeRefreshRef.current < 1_000) return;
      lastResumeRefreshRef.current = now;
      void loadLatestFinds();
    };
    window.addEventListener("focus", refreshAfterResume);
    document.addEventListener("visibilitychange", refreshAfterResume);
    return () => {
      latestRequestRef.current += 1;
      window.clearInterval(refreshInterval);
      window.clearInterval(evaluationInterval);
      window.removeEventListener("focus", refreshAfterResume);
      document.removeEventListener("visibilitychange", refreshAfterResume);
    };
  }, []);

  function updateSetting<K extends keyof ArbitrageSettings>(key: K, value: ArbitrageSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function dismissFind(findId: string) {
    setFinds((current) => {
      const next = current.map((find) =>
        find.id === findId ? { ...find, dismissedAt: new Date().toISOString() } : find,
      );
      findsRef.current = next;
      return next;
    });
  }

  function restoreFind(findId: string) {
    setFinds((current) => {
      const next = current.map((find) =>
        find.id === findId ? { ...find, dismissedAt: undefined } : find,
      );
      findsRef.current = next;
      return next;
    });
    setFeedback((current) => setRecordOutcome(current, findId, null));
  }

  function recordOutcome(findId: string, outcome: RecordOutcome | null) {
    const find = findsRef.current.find((candidate) => candidate.id === findId);
    setFeedback((current) =>
      setRecordOutcome(
        current,
        findId,
        outcome,
        undefined,
        find ? retailOfferFeedbackKey(find) : undefined,
      ),
    );
  }

  function toggleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(defaultSortDirection(nextSortKey));
  }

  async function loadLatestFinds() {
    const requestId = ++latestRequestRef.current;
    setIsLoadingLatest(true);
    try {
      const response = await fetch(`/api/arbitrage/latest?ts=${Date.now()}`, { cache: "no-store" });
      const payload = await readJsonResponse<LatestFindsErrorResponse | LatestFindsResponse>(
        response,
        "Latest finds endpoint",
      );
      if (requestId !== latestRequestRef.current) return;
      if ("error" in payload) throw new Error(payload.error);
      if (!response.ok) throw new Error("Latest finds load failed.");
      if (payload.status === "empty") {
        authoritativeLatestRef.current = true;
        findsRef.current = [];
        setFinds([]);
        setLatestPayload(null);
        setHasAuthoritativeLatest(true);
        setSelectedId(null);
        setLatestMessage(payload.message);
        return;
      }

      const productFinds = payload.payload.finds.filter(isIndividualRecordFind);
      const nextFinds = replaceWithLatestFinds(findsRef.current, productFinds);
      findsRef.current = nextFinds;
      setFinds(nextFinds);
      setFeedback((current) => pruneStaleRecordFeedback(current, nextFinds));
      setLatestPayload(payload.payload);
      setEvaluationNow(Date.now());
      authoritativeLatestRef.current = true;
      setHasAuthoritativeLatest(true);
      setLatestMessage(
        `Loaded ${productFinds.length} record candidates from ${payload.fileName}. ${statsMessage(productFinds)}`,
      );
    } catch (caught) {
      if (requestId !== latestRequestRef.current) return;
      const message = caught instanceof Error ? caught.message : "Latest finds load failed.";
      if (!authoritativeLatestRef.current) {
        findsRef.current = [];
        setFinds([]);
        setLatestPayload(null);
        setSelectedId(null);
        setHasAuthoritativeLatest(false);
        setLatestMessage(message);
      } else {
        setLatestMessage(`Refresh failed; keeping the last verified publication. ${message}`);
      }
    } finally {
      if (requestId === latestRequestRef.current) setIsLoadingLatest(false);
    }
  }

  return (
    <section className="arbitrage-page">
      <div className="seller-hero panel compact-seller-hero arbitrage-hero">
        <div>
          <span className="eyebrow">Validated retail arbitrage</span>
          <h2>What is actually worth buying?</h2>
          <p>
            BUY requires fresh sold velocity, exact active supply, a confident title/edition match, and
            profit after tax, fees, ads, shipping, packaging, and returns reserve.
          </p>
        </div>
        <div className="seller-actions">
          <button type="button" onClick={loadLatestFinds} disabled={isLoadingLatest}>
            {isLoadingLatest ? "Loading..." : "Reload scan data"}
          </button>
          <button
            type="button"
            onClick={() => downloadFindsJson(visibleFinds)}
            disabled={visibleFinds.length === 0}
          >
            Export visible
          </button>
        </div>
      </div>

      {latestMessage ? <div className="warning-box">{latestMessage}</div> : null}

      <div className="seller-stats compact-seller-stats arbitrage-stats">
        <Stat label="Buy now" value={stats.BUY} tone="buy" />
        <Stat label="Needs validation" value={stats.REVIEW} tone="review" />
        <Stat label="Watch" value={stats.WATCH} />
        <Stat label="Rejected" value={stats.REJECT} />
        <Stat label="Sold evidence" value={`${stats.soldValidated}/${stats.total}`} />
        <Stat label="Exact supply" value={`${stats.activeValidated}/${stats.total}`} />
        <Stat
          label="Sale coverage"
          value={coverage.hasSaleDiagnostics ? `${coverage.saleCapable}/${coverage.attempted}` : "Unavailable"}
        />
        <Stat
          label="Product coverage"
          value={
            coverage.hasProductDiagnostics
              ? `${coverage.productUsable}/${coverage.productAttempted}`
              : "Unavailable"
          }
          tone={coverage.parserEmpty || coverage.productFailed ? "warn" : undefined}
        />
        <Stat label="Blocked" value={coverage.blocked} tone={coverage.blocked ? "warn" : undefined} />
      </div>

      <section className="panel arbitrage-run-strip">
        <div>
          <strong>{latestPayload?.runId ?? "No run loaded"}</strong>
          <span>
            {latestPayload ? `Scanned ${formatAge(latestPayload.createdAt)}` : "Waiting for scan data"}
          </span>
        </div>
        <div>
          <strong>{coverage.healthy} healthy · {coverage.degraded} degraded · {coverage.blocked} blocked</strong>
          <span>
            {coverage.hasProductDiagnostics
              ? `Product yield ${coverage.productUsable}/${coverage.productAttempted}; ${coverage.parserEmpty} parser-empty, ${coverage.productFailed} unavailable. Priority coverage ${coverage.priorityHealthy}/${coverage.priorityTotal}; phase ${latestPayload?.phase ?? "unknown"}`
              : `Legacy coverage report; rerun required for product-yield diagnostics. Phase ${latestPayload?.phase ?? "unknown"}`}
          </span>
        </div>
      </section>

      <SourceCoveragePanel reports={latestPayload?.sourceReports ?? []} />

      <section className="arbitrage-workbench">
        <section className="panel arbitrage-table-panel">
          <div className="section-heading seller-table-heading">
            <div>
              <h2>{filterHeading(decisionFilter)}</h2>
              <span>{visibleFinds.length} visible of {scoredFinds.length} record candidates</span>
            </div>
            <div className="seller-controls">
              <label>
                Queue
                <select
                  value={decisionFilter}
                  onChange={(event) => setDecisionFilter(event.target.value as DecisionFilter)}
                >
                  {decisionOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                  <option value="ALL">All sources</option>
                  {sourceOptions.map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {visibleFinds.length === 0 ? (
            <div className="empty-state arbitrage-empty">
              <h2>
                {!hasAuthoritativeLatest && isLoadingLatest
                  ? "Checking the latest publication"
                  : decisionFilter === "BUY"
                    ? "No validated buys in this run"
                    : decisionFilter === "ALL"
                      ? "No record candidates in this run"
                      : "No records in this view"}
              </h2>
              <p>
                {!hasAuthoritativeLatest && isLoadingLatest
                  ? "Cached recommendations stay hidden until the latest published scan is verified."
                  : decisionFilter === "BUY"
                  ? "Nothing currently clears every demand, supply, freshness, match, currency, and profit gate. Use Needs validation to see records that still require evidence or cost normalization."
                  : "Choose another queue or source."}
              </p>
              {decisionFilter === "BUY" && stats.REVIEW > 0 ? (
                <button type="button" onClick={() => setDecisionFilter("NEEDS_VALIDATION")}>
                  Review {stats.REVIEW} candidates needing validation
                </button>
              ) : null}
            </div>
          ) : (
            <div className="arbitrage-find-list">
              <div className="arbitrage-find-header" role="row">
                {sortableColumns.map((column) => (
                  <button
                    className={`arbitrage-sort ${sortKey === column.key ? "active" : ""}`}
                    type="button"
                    key={column.key}
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.label}
                    {sortKey === column.key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ))}
              </div>
              {visibleFinds.map((find) => {
                const outcome = recordOutcomeForFind(feedback, find);
                return (
                  <button
                    className={`arbitrage-find-row ${find.decision.toLowerCase()} ${
                      find.id === selectedFind?.id ? "selected" : ""
                    }`}
                    type="button"
                    key={find.id}
                    onClick={() => setSelectedId(find.id)}
                  >
                    <span className={`arbitrage-priority-cell band-${find.priorityBand.toLowerCase()}`}>
                      <strong>
                        {outcome ? outcomeLabel(outcome) : `${priorityBandLabel(find)} · ${find.priorityScore}`}
                      </strong>
                      <small>
                        {outcome
                          ? `${priorityBandLabel(find)} · ${find.priorityScore}`
                          : strategyLabel(find.recommendedStrategy) ?? find.decision}
                      </small>
                    </span>
                    <span className="arbitrage-title">
                      <strong>{displayRecordTitle(find)}</strong>
                      <small>{find.sourceListingTitle && find.sourceListingTitle !== find.title ? find.sourceListingTitle : ""}</small>
                    </span>
                    <strong>{sourceMoney(find.purchasePrice, find.sourceCurrency)}</strong>
                    <span className={`arbitrage-metric-cell ${profitClass(find.profitPer30Days)}`}>
                      <strong>{nullableMoney(find.profitPer30Days)}</strong>
                      <small>{nullableMoney(find.expectedNetProfit)} total</small>
                    </span>
                    <span className="arbitrage-metric-cell">
                      <strong>{turnLabel(find.estimatedDaysToSell)}</strong>
                      <small>{strategyLabel(find.recommendedStrategy) ?? "No profile yet"}</small>
                    </span>
                    <span className="arbitrage-metric-cell">
                      <strong>{velocityLabel(find)}</strong>
                      <small>{longTermVelocityLabel(find)} long-term</small>
                    </span>
                    <span className="arbitrage-metric-cell">
                      <strong>{activeListingLabel(find)}</strong>
                      <small>{longTermSupplyLabel(find)} long-term</small>
                    </span>
                    <span className="arbitrage-evidence-cell">
                      <strong>{evidenceStatusLabel(find)}</strong>
                      <small>{find.sourceName}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="panel arbitrage-detail">
          {selectedFind ? (
            <FindDetail
              find={selectedFind}
              outcome={recordOutcomeForFind(feedback, selectedFind)}
              onDismiss={() => dismissFind(selectedFind.id)}
              onOutcome={(outcome) => recordOutcome(selectedFind.id, outcome)}
              onRestore={() => restoreFind(selectedFind.id)}
            />
          ) : (
            <div className="arbitrage-detail-empty">
              <h2>Decision evidence</h2>
              <p className="muted">Select a record to inspect profit, demand, supply, and match gates.</p>
            </div>
          )}
        </aside>
      </section>

      <details className="panel arbitrage-settings">
        <summary>
          <span>
            <strong>Adaptive buy profiles</strong>
            <small>
              Turnover changes the required margin. These advanced settings are saved locally.
            </small>
          </span>
          <span>Advanced</span>
        </summary>
        <div className="arbitrage-profile-settings">
          <ProfileSettings
            description="Accepts a smaller dollar return when exact evidence supports a quick sale."
            label="Fast turn"
          >
            <NumberSetting label="Maximum days to sell" value={settings.fastTurnMaxDaysToSell} step={5} onChange={(value) => updateSetting("fastTurnMaxDaysToSell", value)} />
            <NumberSetting label="Minimum net profit $" value={settings.fastTurnMinNetProfitDollars} step={1} onChange={(value) => updateSetting("fastTurnMinNetProfitDollars", value)} />
            <NumberSetting label="Minimum ROI ratio" value={settings.fastTurnMinRoiRatio} step={0.05} onChange={(value) => updateSetting("fastTurnMinRoiRatio", value)} />
          </ProfileSettings>
          <ProfileSettings
            description="The middle path for records with solid demand and reasonable competition."
            label="Balanced"
          >
            <NumberSetting label="Maximum days to sell" value={settings.balancedMaxDaysToSell} step={5} onChange={(value) => updateSetting("balancedMaxDaysToSell", value)} />
            <NumberSetting label="Minimum net profit $" value={settings.balancedMinNetProfitDollars} step={1} onChange={(value) => updateSetting("balancedMinNetProfitDollars", value)} />
            <NumberSetting label="Minimum ROI ratio" value={settings.balancedMinRoiRatio} step={0.05} onChange={(value) => updateSetting("balancedMinRoiRatio", value)} />
          </ProfileSettings>
          <ProfileSettings
            description="Allows a longer hold only when the extra profit and durable demand justify it."
            label="Higher margin"
          >
            <NumberSetting label="Maximum days to sell" value={settings.highMarginMaxDaysToSell} step={5} onChange={(value) => updateSetting("highMarginMaxDaysToSell", value)} />
            <NumberSetting label="Minimum net profit $" value={settings.highMarginMinNetProfitDollars} step={1} onChange={(value) => updateSetting("highMarginMinNetProfitDollars", value)} />
            <NumberSetting label="Minimum ROI ratio" value={settings.highMarginMinRoiRatio} step={0.05} onChange={(value) => updateSetting("highMarginMinRoiRatio", value)} />
          </ProfileSettings>
        </div>
        <div className="arbitrage-settings-subheading">
          <strong>Evidence and cost guardrails</strong>
          <span>These control data quality and cost assumptions shared by all three profiles.</span>
        </div>
        <div className="arbitrage-settings-grid arbitrage-guardrail-settings">
          <NumberSetting label="90-day units sold" value={settings.minSoldUnits90Days} step={1} onChange={(value) => updateSetting("minSoldUnits90Days", value)} />
          <NumberSetting label="Sales per month" value={settings.minSalesPerMonth} step={0.25} onChange={(value) => updateSetting("minSalesPerMonth", value)} />
          <NumberSetting label="Minimum sell-through" value={settings.minSellThroughRate} step={0.05} onChange={(value) => updateSetting("minSellThroughRate", value)} />
          <NumberSetting label="Maximum supply months" value={settings.maxActiveSupplyMonths} step={0.5} onChange={(value) => updateSetting("maxActiveSupplyMonths", value)} />
          <NumberSetting label="Maximum evidence age days" value={settings.maxEvidenceAgeDays} step={1} onChange={(value) => updateSetting("maxEvidenceAgeDays", value)} />
          <NumberSetting label="Source tax %" value={settings.sourceTaxRatePercent} step={0.1} onChange={(value) => updateSetting("sourceTaxRatePercent", value)} />
          <NumberSetting label="Default inbound shipping $" value={settings.defaultInboundShipping} step={0.5} onChange={(value) => updateSetting("defaultInboundShipping", value)} />
        </div>
      </details>
    </section>
  );
}

function FindDetail({
  find,
  onDismiss,
  onOutcome,
  onRestore,
  outcome,
}: {
  find: ArbitrageScoredFind;
  onDismiss: () => void;
  onOutcome: (outcome: RecordOutcome | null) => void;
  onRestore: () => void;
  outcome?: RecordOutcome;
}) {
  const ledger = find.costLedger;
  const recommendedQuantity = recommendedTestQuantity(find);
  const recommendedOption = find.strategyOptions.find(
    (option) => option.id === find.recommendedStrategy,
  );
  return (
    <>
      <div className="section-heading arbitrage-detail-heading">
        <div>
          <span className="eyebrow">{find.sourceName}</span>
          <h2>{displayRecordTitle(find)}</h2>
        </div>
        <div className="arbitrage-detail-badges">
          <strong className={`arbitrage-priority-badge band-${find.priorityBand.toLowerCase()}`}>
            {priorityBandLabel(find)} · {find.priorityScore}
          </strong>
          <strong className={`arbitrage-decision ${find.decision.toLowerCase()}`}>{find.decision}</strong>
        </div>
      </div>

      <div className="arbitrage-buy-callout">
        <div>
          <span>Estimated turn</span>
          <strong>{turnLabel(find.estimatedDaysToSell)}</strong>
        </div>
        <div>
          <span>Expected net</span>
          <strong>{nullableMoney(find.expectedNetProfit)}</strong>
        </div>
        <div>
          <span>Profit / 30 days</span>
          <strong>{nullableMoney(find.profitPer30Days)}</strong>
        </div>
        <div>
          <span>Expected ROI</span>
          <strong>{percent(find.roiRatio)}</strong>
        </div>
      </div>

      <p className="arbitrage-recommendation-line">
        <strong>{recommendedOption?.label ?? "No automatic buy profile"}</strong>
        {recommendedOption
          ? ` · ${recommendedOption.reason}${recommendedQuantity ? ` Start with ${recommendedQuantity}.` : ""}`
          : " · Review the options below to see whether demand, economics, or evidence is holding it back."}
      </p>

      <section className="arbitrage-detail-section">
        <h3>Buy options</h3>
        <p className="muted">
          The scanner tests three inventory approaches instead of forcing every record through one
          profit minimum.
        </p>
        <div className="arbitrage-strategy-options">
          {find.strategyOptions.map((option) => (
            <article
              className={
                option.eligible
                  ? "eligible"
                  : option.demandQualified || option.economicsQualified
                    ? "partial"
                    : "blocked"
              }
              key={option.id}
            >
              <header>
                <strong>{option.label}</strong>
                <span>{strategyStatus(option)}</span>
              </header>
              <div className="arbitrage-strategy-thresholds">
                <span>Turn ≤ {option.maxDaysToSell}d</span>
                <span>Net ≥ {money(option.minNetProfitDollars)}</span>
                <span>ROI ≥ {percent(option.minRoiRatio)}</span>
              </div>
              <div className="arbitrage-strategy-checks">
                <span className={option.demandQualified ? "passed" : "failed"}>
                  Demand {option.demandQualified ? "passes" : "misses"}
                </span>
                <span className={option.economicsQualified ? "passed" : "failed"}>
                  Economics {option.economicsQualified ? "passes" : "misses"}
                </span>
              </div>
              <p>{option.reason}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="arbitrage-detail-section">
        <h3>Profit ledger</h3>
        {find.currencyConversionRequired ? (
          <div className="warning-box arbitrage-fx-warning">
            Source price: {sourceMoney(find.purchasePrice, find.sourceCurrency)}.{" "}
            {find.reasonCodes.includes("SOURCE_CURRENCY_UNKNOWN")
              ? "Identify the source currency"
              : "Add a fresh dated USD conversion"}{" "}
            before treating cost, profit, ROI, or maximum buy price as actionable.
          </div>
        ) : (
          <dl className="arbitrage-ledger">
            {find.sourceCurrency && find.sourceCurrency.toUpperCase() !== "USD" ? (
              <Metric label="Source purchase" value={sourceMoney(find.purchasePrice, find.sourceCurrency)} />
            ) : null}
            <Metric label="USD purchase" value={money(ledger.purchasePrice)} />
            <Metric label="Sales tax" value={money(ledger.salesTax)} />
            <Metric label="Inbound shipping" value={money(ledger.inboundShipping)} />
            <Metric label="Marketplace fee" value={money(ledger.marketplaceFee)} />
            <Metric label="Promoted listing" value={money(ledger.promotedListingFee)} />
            <Metric label="Outbound + packaging" value={money(ledger.outboundShipping + ledger.packaging)} />
            <Metric label="Returns reserve" value={money(ledger.returnsReserve)} />
            <Metric label="Total cost" value={money(ledger.totalCost)} />
            <Metric label="Conservative resale" value={nullableMoney(ledger.expectedResalePrice)} />
            <Metric label="Expected net" value={nullableMoney(ledger.expectedNetProfit)} />
            <Metric label="Expected ROI" value={percent(find.roiRatio)} />
            <Metric label="Profit / 30 days" value={nullableMoney(find.profitPer30Days)} />
          </dl>
        )}
      </section>

      <section className="arbitrage-detail-section">
        <h3>Demand and supply</h3>
        <dl className="arbitrage-metrics">
          <Metric label="Sold 30 / 90 / 365d" value={`${count(find.soldUnits30Days)} / ${count(find.soldUnits90Days)} / ${count(find.soldUnits365Days)}`} />
          <Metric label="Sold over 3 years" value={count(find.soldUnits1095Days)} />
          <Metric label="Recent velocity" value={velocityLabel(find)} />
          <Metric label="Long-term velocity" value={longTermVelocityLabel(find)} />
          <Metric label="Last sale" value={find.daysSinceLastSale === null || find.daysSinceLastSale === undefined ? "n/a" : `${find.daysSinceLastSale} days ago`} />
          <Metric label="Exact active supply" value={count(find.exactActiveListingCount)} />
          <Metric label="Sell-through" value={percent(find.sellThroughRate)} />
          <Metric label="Recent supply months" value={supplyMonthsLabel(find.activeSupplyMonths)} />
          <Metric label="Long-term supply months" value={supplyMonthsLabel(find.longTermSupplyMonths)} />
          <Metric label="Estimated days to sell" value={turnLabel(find.estimatedDaysToSell)} />
          <Metric label="Sold match" value={confidenceLabel(find.soldEvidence?.matchConfidence ?? find.ebaySoldMatchConfidence)} />
          <Metric label="Active match" value={confidenceLabel(find.activeEvidence?.matchConfidence ?? find.ebayActiveMatchConfidence)} />
        </dl>
      </section>

      <section className="arbitrage-detail-section">
        <h3>Priority score</h3>
        <div className="arbitrage-score-breakdown">
          <ScoreFactor label="Demand durability" maximum={30} value={find.priorityBreakdown.demandDurability} />
          <ScoreFactor label="Economics" maximum={30} value={find.priorityBreakdown.economics} />
          <ScoreFactor label="Competition + supply" maximum={20} value={find.priorityBreakdown.competitionAndSupply} />
          <ScoreFactor label="Evergreen prior" maximum={15} value={find.priorityBreakdown.evergreenPrior} />
          <ScoreFactor label="Evidence quality" maximum={5} value={find.priorityBreakdown.evidenceQuality} />
        </div>
      </section>

      <section className="arbitrage-detail-section">
        <h3>Decision gates</h3>
        <div className="arbitrage-gates">
          {Object.entries(find.gates).map(([gate, passed]) => (
            <span className={passed ? "passed" : "failed"} key={gate}>
              {passed ? "✓" : "•"} {humanize(gate)}
            </span>
          ))}
        </div>
        <ul className="arbitrage-reasons">
          {find.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>

      <div className="seller-detail-actions arbitrage-links">
        <a href={find.sourceUrl} target="_blank" rel="noreferrer">Open source</a>
        <a href={cleanEbayResearchUrl(find)} target="_blank" rel="noreferrer">Open sold research</a>
        {find.ebayActiveSearchUrl ? (
          <a href={find.ebayActiveSearchUrl} target="_blank" rel="noreferrer">Open active search</a>
        ) : null}
        {find.dismissedAt || isNegativeRecordOutcome(outcome) ? (
          <button type="button" onClick={onRestore}>Restore</button>
        ) : (
          <button type="button" className="secondary-button" onClick={onDismiss}>Dismiss</button>
        )}
      </div>

      <section className="arbitrage-detail-section">
        <h3>Outcome feedback</h3>
        <p className="muted">This stays on this browser and lets the queue reflect what happened after review.</p>
        <div className="arbitrage-outcomes">
          {outcomeOptions.map((option) => (
            <button
              className={outcome === option.value ? "active" : ""}
              type="button"
              key={option.value}
              onClick={() => onOutcome(outcome === option.value ? null : option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <details className="arbitrage-research-detail">
        <summary>Research trace</summary>
        <p>{researchKeywordsForFind(find)}</p>
        <p>Sold evidence: {find.ebayResearchStatus ?? "pending"} · active evidence: {find.ebayActiveSearchStatus ?? "pending"}</p>
        {find.ebayResearchKeywordVariants?.length ? (
          <p>Queries: {find.ebayResearchKeywordVariants.join(" | ")}</p>
        ) : null}
        {find.notes?.length ? <ul>{find.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      </details>
    </>
  );
}

function ProfileSettings({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <section className="arbitrage-profile-setting">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div className="arbitrage-profile-setting-inputs">{children}</div>
    </section>
  );
}

function ScoreFactor({
  label,
  maximum,
  value,
}: {
  label: string;
  maximum: number;
  value: number;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {value.toFixed(1)} / {maximum}
      </strong>
    </div>
  );
}

function NumberSetting({
  label,
  onChange,
  step,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="arbitrage-setting-row">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SourceCoveragePanel({ reports }: { reports: SourceReport[] }) {
  if (reports.length === 0) return null;
  const parsed = reports.filter((report) => report.productParseHealth === "productive");
  const empty = reports.filter((report) => report.productParseHealth === "empty");
  const unavailable = reports.filter(
    (report) =>
      report.status === "error" ||
      report.productParseHealth === "failed" ||
      report.usableCoverage === "unavailable",
  );
  const remaining = reports.filter(
    (report) =>
      !parsed.includes(report) &&
      !empty.includes(report) &&
      !unavailable.includes(report),
  );

  return (
    <details className="panel arbitrage-source-coverage" open={reports.length <= 12}>
      <summary>
        <span>
          <strong>What the scanner actually checked</strong>
          <small>Expand this audit before trusting the recommendation queue.</small>
        </span>
        <span>
          {parsed.length} parsed · {empty.length} empty · {unavailable.length} unavailable
        </span>
      </summary>
      <div className="arbitrage-source-coverage-body">
        <SourceCoverageGroup
          title="Parsed record inventory"
          description="The source returned product data the scanner could normalize."
          reports={parsed}
        />
        <SourceCoverageGroup
          title="Page loaded, no usable products"
          description="The request worked, but no qualifying record cards were parsed. These need parser or category review."
          reports={empty}
        />
        <SourceCoverageGroup
          title="Blocked or unavailable"
          description="The scanner could not obtain a usable product response."
          reports={unavailable}
        />
        <SourceCoverageGroup
          title="Not attempted or legacy diagnostics"
          description="These sources did not report current product-parser health."
          reports={remaining}
        />
      </div>
    </details>
  );
}

function SourceCoverageGroup({
  description,
  reports,
  title,
}: {
  description: string;
  reports: SourceReport[];
  title: string;
}) {
  if (reports.length === 0) return null;
  return (
    <section className="arbitrage-source-coverage-group">
      <header>
        <strong>{title}</strong>
        <span>{reports.length}</span>
      </header>
      <p>{description}</p>
      <div className="arbitrage-source-coverage-list">
        {[...reports]
          .sort(
            (left, right) =>
              Number(right.selectedProductFindCount ?? 0) -
                Number(left.selectedProductFindCount ?? 0) ||
              Number(right.highSignalCandidateCount ?? 0) -
                Number(left.highSignalCandidateCount ?? 0) ||
              Number(right.candidateCount ?? 0) - Number(left.candidateCount ?? 0) ||
              left.name.localeCompare(right.name),
          )
          .map((report) => (
            <div className="arbitrage-source-coverage-row" key={report.id}>
              <span>
                <strong>{report.name}</strong>
                <small>{sourceCoverageDetail(report)}</small>
              </span>
              <span>{sourceCoverageAdapter(report)}</span>
            </div>
          ))}
      </div>
    </section>
  );
}

function sourceCoverageDetail(report: SourceReport): string {
  if (report.productParseHealth === "productive") {
    return `${report.candidateCount ?? 0} record candidates · ${report.highSignalCandidateCount ?? 0} high-signal · ${report.selectedProductFindCount ?? 0} selected`;
  }
  if (report.productParseHealth === "empty") {
    return `${report.catalogPageAvailableCount ?? 0}/${report.catalogPageAttemptCount ?? report.catalogPageAvailableCount ?? 0} catalog pages loaded; zero qualifying products parsed`;
  }
  if (report.status === "error" || report.productParseHealth === "failed") {
    return report.error ?? "Product request failed or was blocked.";
  }
  return `Status ${report.status}; product-parser diagnostics unavailable.`;
}

function sourceCoverageAdapter(report: SourceReport): string {
  return report.adapterStats?.adapterFamily ?? report.adapterStats?.adapter ?? report.usableCoverage ?? report.status;
}

function Stat({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "buy" | "review" | "warn";
  value: number | string;
}) {
  return (
    <div className={`seller-stat panel ${tone ? `stat-${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function filterAndSortFinds(
  finds: ArbitrageScoredFind[],
  feedback: ReviewFeedback,
  decisionFilter: DecisionFilter,
  sourceFilter: string,
  sortKey: SortKey,
  sortDirection: SortDirection,
): ArbitrageScoredFind[] {
  return finds
    .filter((find) => {
      if (sourceFilter !== "ALL" && find.sourceId !== sourceFilter) return false;
      const outcome = recordOutcomeForFind(feedback, find);
      const hidden = Boolean(find.dismissedAt) || isNegativeRecordOutcome(outcome);
      const tracked = Boolean(outcome && !isNegativeRecordOutcome(outcome));
      if (decisionFilter === "DISMISSED") return hidden;
      if (decisionFilter === "TRACKED") return tracked;
      if (hidden || tracked) return false;
      if (decisionFilter === "ALL") return true;
      if (decisionFilter === "NEEDS_VALIDATION") return find.decision === "REVIEW";
      return find.decision === decisionFilter;
    })
    .sort((left, right) => compareFinds(left, right, sortKey, sortDirection));
}

function compareFinds(
  left: ArbitrageScoredFind,
  right: ArbitrageScoredFind,
  sortKey: SortKey,
  sortDirection: SortDirection,
): number {
  const leftValue = sortValue(left, sortKey);
  const rightValue = sortValue(right, sortKey);
  const directionMultiplier = sortDirection === "asc" ? 1 : -1;
  const compared =
    typeof leftValue === "string" || typeof rightValue === "string"
      ? String(leftValue).localeCompare(String(rightValue))
      : leftValue - rightValue;
  return compared * directionMultiplier || left.title.localeCompare(right.title);
}

function sortValue(find: ArbitrageScoredFind, sortKey: SortKey): number | string {
  if (sortKey === "priority") return priorityRank(find);
  if (sortKey === "price") return find.purchasePrice;
  if (sortKey === "profit_rate") return find.profitPer30Days ?? Number.NEGATIVE_INFINITY;
  if (sortKey === "turn") return find.estimatedDaysToSell ?? Number.POSITIVE_INFINITY;
  if (sortKey === "velocity") return find.salesPerMonth ?? Number.NEGATIVE_INFINITY;
  if (sortKey === "long_term_supply") {
    return find.longTermSupplyMonths ?? find.activeSupplyMonths ?? Number.POSITIVE_INFINITY;
  }
  if (sortKey === "source") return find.sourceName.toLowerCase();
  if (sortKey === "title") return displayRecordTitle(find).toLowerCase();
  return Number.NEGATIVE_INFINITY;
}

function defaultSortDirection(sortKey: SortKey): SortDirection {
  return sortKey === "price" ||
    sortKey === "source" ||
    sortKey === "long_term_supply" ||
    sortKey === "title" ||
    sortKey === "turn"
    ? "asc"
    : "desc";
}

function priorityRank(find: ArbitrageScoredFind): number {
  const decisionRank =
    find.decision === "BUY" ? 4 : find.decision === "WATCH" ? 3 : find.decision === "REVIEW" ? 2 : 1;
  const bandRank =
    find.priorityBand === "A" ? 4 : find.priorityBand === "B" ? 3 : find.priorityBand === "C" ? 2 : 1;
  return decisionRank * 1_000_000 + bandRank * 1_000 + find.priorityScore;
}

function summarizeFinds(finds: ArbitrageScoredFind[], feedback: ReviewFeedback) {
  return finds.reduce(
    (summary, find) => {
      const outcome = recordOutcomeForFind(feedback, find);
      if (!find.dismissedAt && !outcome) summary[find.decision] += 1;
      summary.soldValidated += find.gates.soldEvidence ? 1 : 0;
      summary.activeValidated += find.gates.activeEvidence ? 1 : 0;
      summary.total += 1;
      return summary;
    },
    { BUY: 0, REVIEW: 0, REJECT: 0, WATCH: 0, activeValidated: 0, soldValidated: 0, total: 0 },
  );
}

function summarizeCoverage(payload: PayloadWithDiagnostics | null) {
  const reports = payload?.sourceReports ?? [];
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
  const hasProductDiagnostics = reports.some(
    (report) =>
      report.productParseHealth !== undefined ||
      report.usableCoverage !== undefined,
  );
  const productReports = reports.filter(
    (report) =>
      report.productParseHealth !== undefined &&
      report.productParseHealth !== "not_attempted",
  );
  const productAttempted = productReports.length;
  const productUsable = productReports.filter(
    (report) =>
      report.usableCoverage === "selected" ||
      report.usableCoverage === "high_signal",
  ).length;
  const parserEmpty = productReports.filter(
    (report) => report.productParseHealth === "empty",
  ).length;
  const productFailed = productReports.filter(
    (report) => report.productParseHealth === "failed",
  ).length;
  const saleCapable = reports.filter(
    (report) =>
      (report.salePageAvailableCount ?? 0) > 0 ||
      report.salePageHealth === "healthy" ||
      report.salePageHealth === "partial",
  ).length;
  const priorityReports = reports.filter((report) => report.priority === 1);
  const priorityHealthy = priorityReports.filter(
    (report) => coverageBucket(report) === "healthy",
  ).length;
  return {
    attempted,
    blocked,
    degraded,
    healthy,
    hasProductDiagnostics,
    hasSaleDiagnostics,
    parserEmpty,
    priorityHealthy,
    priorityTotal: priorityReports.length,
    productAttempted,
    productFailed,
    productUsable,
    saleCapable,
  };
}

function coverageBucket(report: SourceReport): "blocked" | "degraded" | "healthy" {
  if (report.status === "error") return "blocked";
  if (report.productParseHealth === "failed" || report.usableCoverage === "unavailable") {
    return "blocked";
  }
  if (
    report.status === "partial" ||
    report.catalogHealth === "partial" ||
    report.salePageHealth === "partial" ||
    report.productParseHealth === "empty" ||
    report.usableCoverage === "parser_empty" ||
    report.usableCoverage === "raw_candidates"
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

function replaceWithLatestFinds(current: ArbitrageFind[], incoming: ArbitrageFind[]): ArbitrageFind[] {
  const byId = new Map(current.map((find) => [find.id, find]));
  return incoming
    .map((find) => {
      const existing = byId.get(find.id);
      return existing?.dismissedAt &&
        retailOfferFeedbackKey(existing) === retailOfferFeedbackKey(find)
        ? { ...find, dismissedAt: existing.dismissedAt }
        : find;
    })
    .sort(
      (left, right) =>
        new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime(),
    );
}

function isIndividualRecordFind(find: ArbitrageFind): boolean {
  if (find.opportunityType === "sitewide_sale" || find.purchasePrice <= 0) return false;
  const title = `${find.title} ${find.sourceListingTitle ?? ""}`.trim();
  if (!title || isSourceCopyTitle(title)) return false;
  return assessRecordCandidate({
    context: `${find.artist} ${find.sourceListingTitle ?? ""}`,
    source: {
      id: find.sourceId,
      name: find.sourceName,
      url: find.sourceUrl,
    },
    title: find.shopifyVariantTitle || find.sourceListingTitle || displayRecordTitle(find),
    url: find.sourceUrl,
  }).accepted;
}

function isSourceCopyTitle(title: string): boolean {
  return /^(?:cheap|deals?|home|facebook page|filter amazon(?: by price)?|click here|continue shopping|sign up|sign in|order history|premium membership|time|under|\d+% off)$/i.test(
    title.replace(/&nbsp;/g, " ").trim(),
  );
}

function displayRecordTitle(find: ArbitrageFind): string {
  if (!find.artist.trim() || /^unknown artist$/i.test(find.artist.trim())) {
    return find.sourceListingTitle || find.title;
  }
  return `${find.artist} — ${find.title}`;
}

function cleanEbayResearchUrl(find: ArbitrageFind): string {
  if (find.ebayResearchUrl) return find.ebayResearchUrl;
  const parts = researchPartsForFind(find);
  return buildNewVinylResearchUrl(parts.artist, parts.title);
}

function researchKeywordsForFind(find: ArbitrageFind): string {
  if (find.ebayResearchKeyword) return find.ebayResearchKeyword;
  if (find.ebayResearchKeywordVariants?.[0]) return find.ebayResearchKeywordVariants[0];
  const parts = researchPartsForFind(find);
  return buildResearchKeywords(parts.artist, parts.title);
}

function researchPartsForFind(find: ArbitrageFind): { artist: string; title: string } {
  const sourceTitle = find.sourceListingTitle ?? "";
  const match = sourceTitle.match(/^(.{2,80}?)(?:\s+-\s+|\s*:\s+)(.{2,})$/);
  if (match) return { artist: match[1], title: match[2] };
  return { artist: /^unknown artist$/i.test(find.artist) ? "" : find.artist, title: find.title };
}

function evidenceStatusLabel(find: ArbitrageScoredFind): string {
  if (find.currencyConversionRequired) return "FX conversion needed";
  if (find.gates.soldEvidence && find.gates.activeEvidence && find.gates.matchConfidence) return "Validated";
  if (find.ebayResearchStatus === "failed" || find.ebayActiveSearchStatus === "failed") return "Evidence failed";
  if (find.ebayResearchStatus === "no_rows") return "No sold matches";
  if (!find.gates.soldEvidence && !find.gates.activeEvidence) return "Sold + supply needed";
  if (!find.gates.soldEvidence) return "Sold evidence needed";
  if (!find.gates.activeEvidence) return "Exact supply needed";
  return "Match review needed";
}

function velocityLabel(find: ArbitrageFind): string {
  return find.salesPerMonth === null || find.salesPerMonth === undefined
    ? "n/a"
    : `${find.salesPerMonth.toFixed(1)}/mo`;
}

function longTermVelocityLabel(find: ArbitrageFind): string {
  const value =
    find.longTermSalesPerMonth ??
    (find.soldUnits1095Days === null || find.soldUnits1095Days === undefined
      ? null
      : find.soldUnits1095Days / 36);
  return value === null ? "n/a" : `${value.toFixed(2)}/mo`;
}

function activeListingLabel(find: ArbitrageFind): string {
  return find.exactActiveListingCount === null || find.exactActiveListingCount === undefined
    ? "? active"
    : `${find.exactActiveListingCount} active`;
}

function longTermSupplyLabel(find: ArbitrageFind): string {
  return find.longTermSupplyMonths === null || find.longTermSupplyMonths === undefined
    ? "n/a"
    : `${find.longTermSupplyMonths.toFixed(1)} mo`;
}

function supplyMonthsLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `${value.toFixed(1)} months`;
}

function turnLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unknown" : `${Math.round(value)} days`;
}

function priorityBandLabel(find: ArbitrageScoredFind): string {
  return find.priorityBand === "REJECT" ? "Reject" : `Band ${find.priorityBand}`;
}

function strategyLabel(value: ArbitrageScoredFind["recommendedStrategy"]): string | null {
  if (value === "fast_turn") return "Fast turn";
  if (value === "balanced") return "Balanced";
  if (value === "high_margin") return "Higher margin";
  return null;
}

function strategyStatus(option: ArbitrageScoredFind["strategyOptions"][number]): string {
  if (option.eligible) return "Eligible";
  if (option.demandQualified && option.economicsQualified) return "Needs evidence";
  if (option.demandQualified) return "Margin misses";
  if (option.economicsQualified) return "Turn misses";
  return "Does not fit";
}

function recommendedTestQuantity(find: ArbitrageScoredFind): number {
  if (find.decision !== "BUY") return 0;
  if (find.quantityAvailable === 0) return 0;
  let quantity = 1;
  if (
    find.priorityBand === "A" &&
    find.recommendedStrategy === "fast_turn" &&
    (find.estimatedDaysToSell ?? Number.POSITIVE_INFINITY) <= 30
  ) {
    quantity = 2;
  }
  if (
    find.priorityBand === "A" &&
    find.priorityScore >= 90 &&
    (find.salesPerMonth ?? 0) >= 8 &&
    (find.activeSupplyMonths ?? Number.POSITIVE_INFINITY) <= 2
  ) {
    quantity = 3;
  }
  if (find.quantityAvailable !== null && find.quantityAvailable !== undefined) {
    quantity = Math.min(quantity, Math.max(1, Math.floor(find.quantityAvailable)));
  }
  return quantity;
}

function confidenceLabel(value: unknown): string {
  if (typeof value === "number") return `${Math.round(value * 100)}%`;
  if (typeof value === "string" && value) return value.replace(/_/g, " ");
  return "n/a";
}

function filterHeading(filter: DecisionFilter): string {
  return decisionOptions.find((option) => option.value === filter)?.label ?? "Finds";
}

function outcomeLabel(outcome: RecordOutcome): string {
  return outcomeOptions.find((option) => option.value === outcome)?.label ?? humanize(outcome);
}

function isNegativeRecordOutcome(outcome?: RecordOutcome): boolean {
  return (
    outcome === "false_positive" ||
    outcome === "margin_too_thin" ||
    outcome === "not_for_me" ||
    outcome === "too_slow"
  );
}

function profitClass(value: number | null): string {
  if (value === null) return "";
  return value >= 10 ? "positive-value" : value < 0 ? "negative-value" : "";
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function statsMessage(finds: ArbitrageFind[]): string {
  const decisions = finds.reduce(
    (counts, find) => {
      counts[find.status ?? "REVIEW"] += 1;
      return counts;
    },
    { BUY: 0, REVIEW: 0, REJECT: 0, WATCH: 0 },
  );
  return `${decisions.BUY} BUY, ${decisions.REVIEW} need validation, ${decisions.WATCH} WATCH.`;
}

function downloadFindsJson(finds: ArbitrageScoredFind[]) {
  const payload: ArbitrageImportPayload = {
    createdAt: new Date().toISOString(),
    finds,
    source: "record-scanner-retail-arbitrage",
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `retail-arbitrage-finds-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : String(value);
}

function nullableMoney(value: number | null): string {
  return value === null ? "n/a" : money(value);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function sourceMoney(value: number, currency: string | null | undefined): string {
  const normalized = String(currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return `Currency unknown ${value.toFixed(2)}`;
  try {
    return new Intl.NumberFormat(undefined, {
      currency: normalized,
      currencyDisplay: "code",
      style: "currency",
    }).format(value);
  } catch {
    return `${normalized} ${value.toFixed(2)}`;
  }
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `${Math.round(value * 100)}%`;
}
