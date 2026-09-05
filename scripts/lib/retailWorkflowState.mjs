import { buildProductResearchPlan, bestEvidenceForEntry, researchCheckpointComplete } from "./productResearchCuration.mjs";

export const WORKFLOW_RESEARCH_LIMIT = 240;

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
  const plans = allPlans.slice(0, WORKFLOW_RESEARCH_LIMIT);
  const byFind = new Map(pool.map((find) => [find.id, find]));
  const entries = new Map((checkpoint.entries ?? []).map((entry) => [entry.findId, entry]));
  const counts = { planned: plans.length, completed: 0, validated: 0, noRows: 0, failed: 0, pending: 0, researchedRows: 0 };
  for (const plan of plans) {
    const entry = entries.get(plan.findId);
    const complete = researchCheckpointComplete(plan, entry);
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
  return { ...counts, limit: WORKFLOW_RESEARCH_LIMIT, outsidePlan, complete, status: !plans.length ? "not_needed" : complete ? "complete" : "incomplete" };
}
