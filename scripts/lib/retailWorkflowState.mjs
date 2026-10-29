import { buildProductResearchPlan, bestEvidenceForEntry, researchCheckpointComplete } from "./productResearchCuration.mjs";

// Size of a work batch, never a ceiling on which offers must be completed.
export const WORKFLOW_RESEARCH_LIMIT = 240;

/** Research cannot keep an acquisition snapshot alive indefinitely. The next
 * scan may reuse valid sales evidence, but must observe current retail offers. */
export function assertWorkflowDraftFresh(draft, now = Date.now()) {
  const age = Number(new Date(now)) - Date.parse(draft?.createdAt);
  if (!Number.isFinite(age) || age < -300000 || age > 24 * 3600000)
    throw new Error("This retail draft is expired or has an invalid observation time. Start a fresh scan; fresh saved research can be reused for rediscovered offers without refreshing its timestamps.");
}

/** Persist actionable failure categories, never raw child output, URLs,
 * credentials, marketplace content or a command's argument values. */
export function workflowFailure(error, state = "unknown") {
  const text = String(error?.message ?? "");
  const rules = [
    [/edition reviews/i, "edition_review_pending", "Exact edition reviews still need explicit unpriced or verified outcomes."],
    [/Research incomplete/i, "research_incomplete", "Selected research still has pending, failed, deferred, or expired checks."],
    [/expired|stale|invalid observation time/i, "evidence_expired", "The acquisition draft or required evidence expired; start a fresh scan."],
    [/lease|mutex|writer busy/i, "research_ownership", "The research session needs valid ownership before this step can write."],
    [/401|403|unauthoriz|credential|token/i, "access_denied", "A service denied access or required credentials are unavailable."],
    [/429|rate.limit/i, "rate_limited", "A service rate limit stopped this step; retain progress and retry later."],
    [/timeout|timed out|deadline|ETIMEDOUT/i, "request_timeout", "A request exceeded its time limit; coverage remains unverified."],
    [/network|ENOTFOUND|ECONN|fetch failed/i, "network_failure", "A service request failed; retain the last verified publication."],
    [/another scan|wrong run|wrong-run|mismatch|does not identify/i, "run_mismatch", "The context, draft, or checkpoint does not identify the same run."],
    [/validat|publishable|coverage/i, "validation_failed", "The final artifact did not pass the required publication validation."],
  ];
  const [, code, message] = rules.find(([pattern]) => pattern.test(text)) ??
    [null, "workflow_step_failed", "A workflow step failed. Inspect the local command output before retrying."];
  const step = /^scripts\/[A-Za-z0-9_-]+\.mjs$/.test(error?.workflowStep ?? "") ? error.workflowStep : null;
  return { code, message, stage: step ?? (["running", "research", "validated", "published", "partial"].includes(state) ? state : "unknown") };
}

/** A browser recovery is a new bounded refresh, never a resumed or broad scan. */
export function browserRecoveryScan({ observations, observationsPath, previousScan, previousScanPath, now = Date.now() }) {
  if (!observationsPath || !previousScanPath) throw new Error("Browser recovery requires --browserObservations and --previousScan paths.");
  if (!previousScan?.runId || !["scan", "final"].includes(previousScan.phase) || !Array.isArray(previousScan.sourceReports) || !Number.isFinite(Date.parse(previousScan.createdAt)))
    throw new Error("--previousScan must identify an exact scan draft or final artifact.");
  if (observations?.version !== 1 || observations.captureMethod !== "visible_browser" || !Array.isArray(observations.pages))
    throw new Error("Unsupported browser observation document.");
  const sourceIds = [...new Set(observations.pages.filter((page) => {
    const age = Number(new Date(now)) - Date.parse(page.capturedAt);
    return typeof page.sourceId === "string" && /^[a-z0-9][a-z0-9-]*$/.test(page.sourceId) && age >= -300000 && age <= 6 * 3600000;
  }).map((page) => page.sourceId))];
  if (!sourceIds.length) throw new Error("Browser recovery has no fresh source observations; capture current pages before starting a new run.");
  // The scanner still validates every page against its configured source, URL,
  // visible evidence and format contracts. IDs here only bound the requested work.
  return {
    mode: "refresh", previousRunId: previousScan.runId, sourceIds,
    scanArgs: ["scripts/runRetailArbitrageScan.mjs", "--skipUpload", "--skipEbaySync", "--browserOnly", "--browserObservations=" + observationsPath, "--previousScan=" + previousScanPath, "--sources=" + sourceIds.join(",")],
  };
}

export function scannerOutputPath(stdout) {
  const text = String(stdout).trim();
  const summary = JSON.parse(text.slice(text.lastIndexOf("\n{") + 1));
  if (typeof summary.outputPath !== "string" || !summary.outputPath) throw new Error("The scanner did not return an exact output path.");
  return summary.outputPath;
}

export function freshWorkflowDraftSummary(draft, { startedAt, previousRunId } = {}) {
  if (draft?.phase !== "scan" || !draft.runId || draft.runId === previousRunId || !(Date.parse(draft.createdAt) >= Date.parse(startedAt)) || !Array.isArray(draft.sourceReports))
    throw new Error("The scanner output must be a new unpublished draft for this workflow.");
  return { runId: draft.runId, sourceCount: new Set(draft.sourceReports.map((report) => report.id).filter(Boolean)).size };
}

/** Mirror the source-update admission contract, rather than counting every reachable page. */
export function admittedSourceIds(payload) {
  return [...new Set((payload.sourceReports ?? []).filter((report) =>
    (Number(report.catalogPageAvailableCount) > 0 && ["healthy", "partial"].includes(report.catalogHealth) && report.productParseHealth === "productive") ||
    (Number(report.salePageAvailableCount) > 0 && ["healthy", "partial"].includes(report.salePageHealth)),
  ).map((report) => report.id).filter(Boolean))];
}

export function researchProgress(draft, checkpoint = {}, now = new Date()) {
  if (checkpoint.runId && checkpoint.runId !== draft.runId) throw new Error("Research checkpoint belongs to another scan.");
  const pool = draft.researchCandidates ?? draft.finds ?? [];
  const allPlans = buildProductResearchPlan(pool);
  const plans = allPlans;
  const byFind = new Map(pool.map((find) => [find.id, find]));
  const entries = new Map((checkpoint.entries ?? []).map((entry) => [entry.findId, entry]));
  const counts = { planned: plans.length, completed: 0, validated: 0, noRows: 0, failed: 0, pending: 0, researchedRows: 0 };
  for (const plan of plans) {
    const entry = entries.get(plan.findId);
    // Collection completion and per-pressing sold validation are separate.
    // Require fresh observed controls, dates and pagination for every query.
    const complete = researchCheckpointComplete(plan, entry, now);
    if (complete) counts.completed++;
    if (!complete) {
      const failed = (entry?.runs ?? []).some((run) => run.error || ["failed", "blocked", "unavailable"].includes(run.status));
      counts[failed ? "failed" : "pending"]++;
      continue;
    }
    const evidence = bestEvidenceForEntry(byFind.get(plan.findId), entry, now, { exactEntry: true });
    if (evidence.status === "validated") {
      counts.validated++;
      counts.researchedRows += evidence.rows.length;
    } else if (evidence.status === "no_rows") counts.noRows++;
    else if (evidence.status === "failed") counts.failed++;
    else counts.pending++;
  }
  const outsidePlan = Math.max(0, allPlans.length - plans.length);
  const complete = plans.length > 0 && counts.completed === plans.length && counts.failed === 0 && counts.pending === 0 && outsidePlan === 0;
  return { ...counts, limit: plans.length, outsidePlan, complete, status: !plans.length ? "not_needed" : complete ? "complete" : "incomplete" };
}

export function assertResearchReady(progress, queue = {}) {
  if (Number(queue.editionReviews ?? 0) > 0) throw new Error(`Research incomplete: ${queue.editionReviews} edition reviews need explicit outcomes; unconfirmed editions remain unpriced.`);
  if (progress.status === "not_needed" && !(queue.tasks > 0)) return;
  const unfinished = Number(queue.pending ?? 0) + Number(queue.repair ?? 0) + Number(queue.refresh ?? 0);
  if (!progress.complete || unfinished || Number(queue.deferred ?? 0) > 0) {
    throw new Error(`Research incomplete: ${progress.completed}/${progress.planned} offers have verified completed searches; ${unfinished} query windows remain. Resume the saved context and checkpoint before publication.`);
  }
}
