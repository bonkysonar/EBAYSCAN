import { buildProductResearchPlan } from "./productResearchCuration.mjs";
import { assessSoldCapture, researchQueryKey as queryKey } from "./soldCaptureQuality.mjs";


export function importBrowserSoldResearch(payload, captures, previous = {}, now = new Date()) {
  if (!payload.runId || payload.phase !== "scan") throw new Error("An unpublished scan draft is required.");
  if (previous.runId && previous.runId !== payload.runId) throw new Error("Checkpoint belongs to another scan.");
  const pool = payload.researchCandidates ?? payload.finds ?? [];
  const plan = buildProductResearchPlan(pool);
  const entries = new Map((previous.entries ?? []).map((entry) => [entry.findId,entry]));
  const accepted = [], rejected = [];
  for (const page of [...(captures.pages ?? [])].sort((a,b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))) {
    const assessment = assessSoldCapture(page, now);
    if (captures.captureMethod !== "visible_browser" || !assessment.importable) {
      rejected.push({query:page.query,reason:"unverified_or_incomplete_capture",reasonCodes:assessment.reasonCodes,repairs:assessment.repairs}); continue;
    }
    const matching = plan.filter((entry) => entry.variants.some((variant) => queryKey(variant.query) === queryKey(page.query)));
    if (!matching.length) { rejected.push({query:page.query,reason:"no_exact_artist_album_in_current_draft"}); continue; }
    for (const entry of matching) {
      const run = {...page,captureAssessment:assessment,capturedQuery:page.query,query:entry.variants.find((variant) => queryKey(variant.query) === queryKey(page.query)).query,status:"complete",captureMethod:"visible_browser"};
      const prior = entries.get(entry.findId);
      const verifiedPrior = (prior?.runs ?? []).some(item => item.url === run.url && assessSoldCapture(item, now).windowVerified);
      if (verifiedPrior && !assessment.windowVerified) continue;
      const newer = (prior?.runs ?? []).some(item => item.url === run.url && Date.parse(item.capturedAt) > Date.parse(run.capturedAt));
      if (newer) continue;
      const runs = [...(prior?.runs ?? []).filter((item) => item.url !== run.url),run];
      entries.set(entry.findId,{findId:entry.findId,title:entry.title,runs});
      accepted.push({findId:entry.findId,query:page.query,rowCount:page.rows.length});
    }
  }
  return {runId:payload.runId,entries:[...entries.values()],importedAt:new Date(now).toISOString(),importSummary:{accepted,rejected}};
}
