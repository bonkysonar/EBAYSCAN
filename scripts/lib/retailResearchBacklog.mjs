import { buildProductResearchPlan } from "./productResearchCuration.mjs";
import { importBrowserSoldResearch } from "./browserSoldResearch.mjs";

/** Resume the oldest unpublished, still-publishable draft before scanning again. */
export function resumableResearchWorkflow(workflows, now = Date.now()) {
  return unfinished(workflows).filter(({ draft }) => {
    const age = Number(new Date(now)) - Date.parse(draft.createdAt);
    return age >= -300000 && age <= 24 * 3600000;
  }).sort((a, b) => Date.parse(a.draft.createdAt) - Date.parse(b.draft.createdAt))[0] ?? null;
}

/** Carry unpublished offers without refreshing prices or times. Base research
 * completion cannot discard an annual follow-up or an unpublished decision. */
export function carryUnfinishedResearch(draft, workflows, now = new Date()) {
  const pool = [...(draft.researchCandidates ?? (draft.finds ?? []).filter(find => find.opportunityType !== "sitewide_sale"))];
  const ids = new Set(pool.map(find => find.id));
  const carried = [];
  const supersededRunIds = [];
  for (const prior of unfinished(workflows).sort((a,b) => Date.parse(b.draft.createdAt) - Date.parse(a.draft.createdAt))) {
    if (prior.draft.runId === draft.runId) continue;
    supersededRunIds.push(prior.draft.runId);
    const oldPool = prior.draft.researchCandidates ?? prior.draft.finds ?? [];
    const byId = new Map(oldPool.map(find => [find.id, find]));
    for (const plan of buildProductResearchPlan(oldPool)) {
      if (ids.has(plan.findId)) continue;
      ids.add(plan.findId);
      pool.push(byId.get(plan.findId));
      carried.push({ findId: plan.findId, previousRunId: prior.draft.runId });
    }
  }
  return { ...draft, researchCandidates: pool, researchBacklog: { carriedCount: carried.length, carried, supersededRunIds } };
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
