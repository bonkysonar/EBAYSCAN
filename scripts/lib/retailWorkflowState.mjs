import { buildProductResearchPlan, bestEvidenceForEntry, researchCheckpointComplete } from "./productResearchCuration.mjs";

export const WORKFLOW_RESEARCH_LIMIT = 240;

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
