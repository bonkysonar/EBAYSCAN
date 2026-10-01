import { buildSoldResearchQueryVariants } from "../../src/lib/arbitrage/soldResearchLinks.mjs";
import { curateResearchForFind } from "./productResearchCuration.mjs";
import { assessSoldCapture, researchQueryKey } from "./soldCaptureQuality.mjs";
import { mergeResearchSoldEvidence } from "./soldResearchWindow.mjs";

/** Match already-observed exact sales before a retail offer is filtered out of research. */
export function createCapturedSoldIndex(captures = {}, now = new Date()) {
  const groups = new Map();
  if (captures.captureMethod === "visible_browser") for (const page of captures.pages ?? []) {
    if (!assessSoldCapture(page, new Date(now)).windowVerified) continue;
    const key = researchQueryKey(page.query), rows = groups.get(key) ?? [];
    rows.push({ ...page, status: "complete" }); groups.set(key, rows);
  }
  return { enrich(find) {
    const query = buildSoldResearchQueryVariants(find)[0]?.query;
    const runs = groups.get(researchQueryKey(query));
    if (!runs) return find;
    const research = curateResearchForFind(find, { entries: [{ findId: find.id, runs }] }, new Date(now));
    if (research.status !== "validated" || research.velocityStatus !== "verified_window_totals") return find;
    return { ...find, averageSoldPrice: research.averageSoldPrice, averageSoldShipping: research.averageSoldShipping,
      totalSoldCount: research.totalSoldCount, ebayResearchRows: research.rows, ebayResearchStatus: "validated", ebayResearchUpdatedAt: research.capturedAt,
      soldEvidence: mergeResearchSoldEvidence(find.soldEvidence, research, research.capturedAt),
      soldDiscoveryBasis: "exact_captured_market_sales" };
  } };
}
