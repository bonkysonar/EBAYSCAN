import { buildProductResearchPlan } from "./productResearchCuration.mjs";
import { importBrowserSoldResearch } from "./browserSoldResearch.mjs";

/** Resume the oldest unpublished, still-publishable draft before scanning again. */
export function resumableResearchWorkflow(workflows, now = Date.now()) {
  return unfinished(workflows).filter(({ draft }) => {
    const age = Number(new Date(now)) - Date.parse(draft.createdAt);
    return age >= -300000 && age <= 24 * 3600000;
  }).sort((a, b) => Date.parse(a.draft.createdAt) - Date.parse(b.draft.createdAt))[0] ?? null;
}

/** A new scan owns a fresh, bounded acquisition cohort. Historical offers stay
 * in their original drafts; matching research is reused separately below. */
export function carryUnfinishedResearch(draft, workflows, now = new Date()) {
  const pool = [...(draft.researchCandidates ?? (draft.finds ?? []).filter(find => find.opportunityType !== "sitewide_sale"))];
  const ids = new Set(pool.map(find => find.id));
  const deferred = new Map();
  const supersededRunIds = [];
  for (const prior of unfinished(workflows).sort((a,b) => Date.parse(b.draft.createdAt) - Date.parse(a.draft.createdAt))) {
    if (prior.draft.runId === draft.runId) continue;
    supersededRunIds.push(prior.draft.runId);
    const oldPool = prior.draft.researchCandidates ?? prior.draft.finds ?? [];
    const byId = new Map(oldPool.map(find => [find.id, find]));
    for (const plan of buildProductResearchPlan(oldPool)) {
      if (ids.has(plan.findId) || deferred.has(plan.findId)) continue;
      const offer = byId.get(plan.findId);
      const age = Number(new Date(now)) - Date.parse(offer.capturedAt);
      deferred.set(plan.findId, { findId: plan.findId, previousRunId: prior.draft.runId,
        reason: !Number.isFinite(age) || age < -300000 || age > 2 * 86400000 ? "offer_stale" : "not_rediscovered" });
    }
  }
  return { ...draft, researchCandidates: pool, researchBacklog: {
    policy: "current_scan_only", carriedCount: 0, carried: [],
    deferredCount: deferred.size, staleOfferCount: [...deferred.values()].filter(row => row.reason === "offer_stale").length,
    deferred: [...deferred.values()], supersededRunIds,
  } };
}

/** Re-import observed runs by query into the new cohort. Never relabel an old
 * checkpoint as current or depend on the separate browser capture file surviving. */
export function carryResearchCheckpoint(draft, workflows, now = new Date()) {
  const pages = unfinished(workflows).flatMap(({checkpoint}) =>
    (checkpoint?.entries ?? []).flatMap(entry => entry.runs ?? []))
    .filter(run => run.captureMethod === 'visible_browser');
  return importBrowserSoldResearch(draft,{captureMethod:'visible_browser',pages},{},now);
}

function unfinished(workflows) {
  return workflows.filter(({ context, draft, checkpoint }) => context && draft &&
    !context.publishedAt && !context.supersededByRunId && !["published", "partial"].includes(context.status) &&
    draft.phase === "scan" && context.runId === draft.runId &&
    Number.isFinite(Date.parse(draft.createdAt)) &&
    (!checkpoint?.runId || checkpoint.runId === draft.runId));
}
