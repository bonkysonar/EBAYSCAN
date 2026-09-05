import { buildProductResearchPlan } from "./productResearchCuration.mjs";

const queryKey = (value) => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

export function importBrowserSoldResearch(payload, captures, previous = {}, now = new Date()) {
  if (!payload.runId || payload.phase !== "scan") throw new Error("An unpublished scan draft is required.");
  if (previous.runId && previous.runId !== payload.runId) throw new Error("Checkpoint belongs to another scan.");
  const pool = payload.researchCandidates ?? payload.finds ?? [];
  const plan = buildProductResearchPlan(pool);
  const entries = new Map((previous.entries ?? []).map((entry) => [entry.findId,entry]));
  const accepted = [], rejected = [];
  for (const page of captures.pages ?? []) {
    let valid = false;
    try {
      const url = new URL(page.url);
      const age = Number(now) - Date.parse(page.capturedAt);
      valid = captures.captureMethod === "visible_browser" &&
        url.hostname === "www.ebay.com" && url.pathname === "/sh/research" &&
        url.searchParams.get("conditionId") === "1000" && url.searchParams.get("categoryId") === "176985" &&
        url.searchParams.get("tabName") === "SOLD" &&
        queryKey(url.searchParams.get("keywords")) === queryKey(page.query) &&
        age >= -300000 && age <= 7 * 86400000 &&
        page.complete === true && page.condition === "New" && page.category === "Vinyl Records" &&
        Array.isArray(page.rows) && page.rows.length <= 1000;
    } catch { valid = false; }
    if (!valid) { rejected.push({query:page.query,reason:"unverified_or_incomplete_capture"}); continue; }
    const matching = plan.filter((entry) => entry.variants.some((variant) => queryKey(variant.query) === queryKey(page.query)));
    if (!matching.length) { rejected.push({query:page.query,reason:"no_exact_artist_album_in_current_draft"}); continue; }
    for (const entry of matching) {
      const run = {...page,capturedQuery:page.query,query:entry.variants.find((variant) => queryKey(variant.query) === queryKey(page.query)).query,status:"complete",captureMethod:"visible_browser"};
      const prior = entries.get(entry.findId);
      const runs = [...(prior?.runs ?? []).filter((item) => item.url !== run.url),run];
      entries.set(entry.findId,{findId:entry.findId,title:entry.title,runs});
      accepted.push({findId:entry.findId,query:page.query,rowCount:page.rows.length});
    }
  }
  return {runId:payload.runId,entries:[...entries.values()],importedAt:new Date(now).toISOString(),importSummary:{accepted,rejected}};
}
