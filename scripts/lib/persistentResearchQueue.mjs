import { createHash } from "node:crypto";
import { buildProductResearchPlan, curateResearchForFind } from "./productResearchCuration.mjs";
import { importBrowserSoldResearch } from "./browserSoldResearch.mjs";
import { assessSoldCapture, researchQueryKey } from "./soldCaptureQuality.mjs";
import { buildEbayProductResearchUrl } from "../../src/lib/arbitrage/soldResearchLinks.mjs";
import { evaluateOpportunity } from "../../src/lib/arbitrage/evaluateOpportunity.mjs";
import { mergeResearchSoldEvidence } from "./soldResearchWindow.mjs";

const DAY = 86400000;
const hash = value => createHash("sha256").update(value).digest("hex");
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Persistent state contains only opaque identities, times, counters and reason codes.
 * Queries, offers and captured sales stay in the separately generated local plan/capture files.
 */
export function buildPersistentResearchQueue(payload, { captures = {}, checkpoint = {}, state = {}, now = new Date(), maxEntries = 240 } = {}) {
  const timestamp = new Date(now).toISOString();
  const imported = importBrowserSoldResearch(payload, captures, checkpoint, new Date(now));
  const pool = payload.researchCandidates ?? payload.finds ?? [];
  const byId = new Map(pool.map(find => [find.id, find]));
  const groups = new Map();
  for (const plan of buildProductResearchPlan(pool)) {
    for (const variant of plan.variants) {
      const key = researchQueryKey(variant.query);
      const group = groups.get(key) ?? { query: variant.query, order: groups.size, lane: plan.discoveryLane || "exploration", targets: [] };
      group.targets.push(byId.get(plan.findId));
      groups.set(key, group);
    }
  }
  const pagesByQuery = new Map();
  const savedPages = captures.captureMethod === "visible_browser" ? captures.pages ?? [] : [];
  const availablePages = [...savedPages, ...imported.entries.flatMap(entry => entry.runs ?? [])];
  const seenPages = new Set();
  for (const page of availablePages) {
    // Pagination resumes retain the original observation timestamp. A saved
    // partial page must not hide the completed capture with the same URL/time.
    const identity = `${page.query}:${page.url}:${page.capturedAt}:${page.complete}:${page.completePagination}:${page.rows?.length}`;
    if (seenPages.has(identity)) continue;
    seenPages.add(identity);
    const key = researchQueryKey(page.query), pages = pagesByQuery.get(key) ?? [];
    pages.push({ page, quality: assessSoldCapture(page, new Date(now)) });
    pagesByQuery.set(key, pages);
  }
  const nextState = {};
  for (const [key, entry] of Object.entries(state.entries ?? {})) {
    if (/^[a-f0-9]{64}$/.test(key) && Number(now) - Date.parse(entry.lastSeenAt) <= 30 * DAY) nextState[key] = safeState(entry);
  }
  const editionReviewOutcomes = Object.fromEntries(Object.entries(state.editionReviewOutcomes ?? {}).filter(([key, value]) =>
    /^[a-f0-9]{64}$/.test(key) && ["unconfirmed_unpriced", "incompatible_unpriced"].includes(value?.outcome) &&
    Number(now) - Date.parse(value.reviewedAt) >= 0 && Number(now) - Date.parse(value.reviewedAt) <= 30 * DAY)
    .map(([key, value]) => [key, { outcome: value.outcome, reviewedAt: iso(value.reviewedAt) }]));
  const tasks = [], editionReviews = [], reviewedEditions = [], sourcing = [];
  for (const group of groups.values()) {
    const pages = pagesByQuery.get(researchQueryKey(group.query)) ?? [];
    const evidence = group.targets.map(find => {
      const research = curateResearchForFind(find, imported, new Date(now));
      const priced = research.status === "validated" ? evaluateOpportunity({
        ...find, averageSoldPrice: research.averageSoldPrice, averageSoldShipping: research.averageSoldShipping,
        totalSoldCount: research.totalSoldCount, ebayResearchRows: research.rows,
        soldEvidence: mergeResearchSoldEvidence(find.soldEvidence, research, research.capturedAt),
      }, {}, timestamp) : null;
      const result = { find, research, priced };
      if (research.status === "no_rows" && pages.some(({ page, quality }) => quality.windowVerified && page.rows.length)) {
        // A review applies only to this offer identity and this observed evidence.
        // New retailer identity or fresh captures require a new review.
        const reviewId = hash(JSON.stringify([find.id, find.artist, find.title, find.sourceListingTitle, find.barcode, find.catalogNumber,
          find.variant, find.releaseIdentity, pages.filter(({ quality }) => quality.windowVerified).map(({ page }) => [page.capturedAt, page.rows])]));
        const review = { reviewId, findId: find.id, query: group.query, sourceId: find.sourceId, reason: "no_confirmed_edition_match", action: "Compare retailer barcode/catalog number and pressing details with the captured listings; do not borrow another edition's price." };
        if (editionReviewOutcomes[reviewId]) reviewedEditions.push({ ...review, ...editionReviewOutcomes[reviewId] });
        else editionReviews.push(review);
      }
      if (priced && priced.recommendedMaxPurchasePrice > 0 && research.velocityStatus === "verified_window_totals") {
        sourcing.push({ findId: find.id, query: group.query, sourceId: find.sourceId, sourceUrl: find.sourceUrl,
          purchasePrice: find.purchasePrice, maximumPurchasePrice: priced.recommendedMaxPurchasePrice,
          expectedNetProfit: priced.expectedNetProfit, roiRatio: priced.roiRatio,
          exactUnits90Days: research.sales90Days, exactUnits365Days: research.sales365Days,
          priceVerified: priced.gates?.purchaseOffer === true, capturedAt: research.capturedAt,
          status: priced.decision, reasonCodes: priced.reasonCodes });
      }
      return result;
    });
    addTask(group, pages, evidence, 90);
    const annualTargets = evidence.filter(({ research, priced }) => research.sales90Days > 0 && research.sales90Days < 6 && priced?.expectedNetProfit >= 12 && priced?.roiRatio >= .5);
    if (annualTargets.length) addTask({ ...group, targets: annualTargets.map(row => row.find) }, pages, annualTargets, 365);
  }
  const actionable = tasks.filter(task => task.status !== "complete" && !task.retryAfter);
  const lanes = [actionable.filter(task => task.lane !== "exploration"), actionable.filter(task => task.lane === "exploration")];
  for (const lane of lanes) lane.sort((a,b) => Date.parse(a.lastAttemptAt ?? a.firstSeenAt) - Date.parse(b.lastAttemptAt ?? b.firstSeenAt) || a.order - b.order);
  const interleaved = [];
  for (let i = 0; i < Math.max(...lanes.map(lane => lane.length)); i++) for (const lane of lanes) if (lane[i]) interleaved.push(lane[i]);
  const entries = interleaved.slice(0, maxEntries);
  const summary = {
    offers: pool.filter(find => byId.has(find.id) && !String(find.id).startsWith("campaign-")).length,
    distinctQueries: groups.size, tasks: tasks.length, reused: tasks.filter(task => task.status === "complete").length,
    repair: tasks.filter(task => task.status === "repair").length,
    refresh: tasks.filter(task => task.status === "refresh").length,
    pending: tasks.filter(task => task.status === "pending").length,
    completeWithRedactedRows: tasks.filter(task => task.status === "complete" && task.evidenceIncomplete).length,
    retryLater: tasks.filter(task => task.retryAfter).length, scheduled: entries.length,
    deferred: Math.max(0, actionable.length - entries.length), editionReviews: editionReviews.length, reviewedEditions: reviewedEditions.length,
  };
  const intervalHours = Math.max(0, (Number(now) - Date.parse(state.updatedAt)) / 3600000) || null;
  const newlyCollected = tasks.reduce((count, task) => count + Math.max(0, (nextState[task.taskId].collectionCount ?? 0) - (state.entries?.[task.taskId]?.collectionCount ?? 0)), 0);
  const freshnessLosses = tasks.filter(task => task.status !== "complete" && state.entries?.[task.taskId]?.status === "complete").length;
  const rate = intervalHours >= 1 / 60 ? newlyCollected / intervalHours : null;
  const metrics = { intervalHours, newlyCollected, freshnessLosses, completedWindowsPerHour: rate,
    // Wall-clock interval rate includes downtime; this is not an active-collector benchmark.
    estimatedHoursRemaining: rate > 0 ? (summary.pending + summary.repair + summary.refresh) / rate : null,
    collectionHistoryCount: tasks.filter(task => nextState[task.taskId].lastCollectedAt).length,
    oldestPendingAt: tasks.filter(task => task.status !== "complete").map(task => task.firstSeenAt).sort()[0] ?? null,
    freshnessOutpacingCollection: intervalHours !== null && freshnessLosses > newlyCollected };
  return { checkpoint: imported, state: { version: 1, updatedAt: timestamp, entries: nextState, editionReviewOutcomes },
    plan: { version: 2, runId: payload.runId, createdAt: timestamp, entries, completed: tasks.filter(task => task.status === "complete"), retryLater: tasks.filter(task => task.retryAfter), editionReviews, reviewedEditions, sourcing, summary, metrics, status: "ready" } };

  function addTask(group, pages, evidence, periodDays) {
    const taskId = hash(`${researchQueryKey(group.query)}:${periodDays}`);
    const prior = nextState[taskId] ?? {};
    const relevant = pages.filter(({ quality }) => quality.periodDays === periodDays || !quality.periodDays)
      .sort((a,b) => Date.parse(b.page.capturedAt) - Date.parse(a.page.capturedAt));
    const accepted = relevant.find(({ quality }) => quality.searchComplete && quality.periodDays === periodDays);
    const latest = relevant[0];
    const status = accepted ? "complete" : latest?.quality.reasonCodes.includes("capture_stale") ? "refresh" : latest ? "repair" : "pending";
    const reasonCodes = accepted ? [] : latest?.quality.reasonCodes ?? [];
    const revision = latest ? hash(`${latest.page.url}:${latest.page.capturedAt}:${latest.quality.reasonCodes.join(",")}`) : prior.lastAttemptRevision;
    const attemptCount = (prior.attemptCount ?? 0) + (revision && revision !== prior.lastAttemptRevision ? 1 : 0);
    const lastAttemptAt = iso(latest?.page.capturedAt) ?? prior.lastAttemptAt ?? null;
    const retryAt = status === "repair" && reasonCodes.includes("capture_failed") && lastAttemptAt
      ? Date.parse(lastAttemptAt) + Math.min(360, 10 * 2 ** Math.min(6, Math.max(0, attemptCount - 1))) * 60000 : null;
    const retryAfter = retryAt > Number(now) ? new Date(retryAt).toISOString() : null;
    nextState[taskId] = { firstSeenAt: prior.firstSeenAt ?? timestamp, lastSeenAt: timestamp,
      lastAttemptAt, lastAttemptRevision: revision ?? null, attemptCount, status, reasonCodes,
      lastAcceptedAt: iso(accepted?.page.capturedAt), periodDays,
      lastCollectedAt: iso(accepted?.page.capturedAt) ?? prior.lastCollectedAt ?? null,
      collectionCount: (prior.collectionCount ?? 0) + (accepted && iso(accepted.page.capturedAt) !== prior.lastCollectedAt ? 1 : 0) };
    const url = buildEbayProductResearchUrl(group.query, { dayRange: periodDays });
    tasks.push({ taskId, query: group.query, periodDays, url, status, reasonCodes,
      repairs: accepted ? [] : latest?.quality.repairs ?? [], retryAfter, lane: group.lane, order: group.order,
      evidenceIncomplete: accepted ? !accepted.quality.windowVerified : true,
      evidenceReasonCodes: accepted?.quality.reasonCodes ?? reasonCodes,
      firstSeenAt: nextState[taskId].firstSeenAt, lastAttemptAt,
      findId: group.targets[0].id, findIds: group.targets.map(find => find.id),
      artist: group.targets[0].artist, title: group.targets[0].title,
      variants: [{ kind: "base", query: group.query, url, periodDays }],
      targets: evidence.map(({ find, research, priced }) => ({ findId: find.id, sourceId: find.sourceId,
        sourceUrl: find.sourceUrl, title: find.sourceListingTitle ?? find.title, purchasePrice: find.purchasePrice,
        evidence: { matchedRows: research.rows?.length ?? 0, exactPrice: research.averageSoldPrice ?? null,
          velocity: research.velocityStatus ?? "pending", units90Days: research.sales90Days ?? null, units365Days: research.sales365Days ?? null },
        expectedNetProfit: priced?.expectedNetProfit ?? null, roiRatio: priced?.roiRatio ?? null,
      })),
    });
  }
}

function safeState(entry) {
  return { firstSeenAt: iso(entry.firstSeenAt), lastSeenAt: iso(entry.lastSeenAt), lastAttemptAt: iso(entry.lastAttemptAt),
    lastAttemptRevision: /^[a-f0-9]{64}$/.test(entry.lastAttemptRevision) ? entry.lastAttemptRevision : null,
    attemptCount: Math.max(0, Math.min(10000, Number(entry.attemptCount) || 0)),
    lastAcceptedAt: iso(entry.lastAcceptedAt), lastCollectedAt: iso(entry.lastCollectedAt ?? entry.lastAcceptedAt),
    collectionCount: Math.max(0, Number(entry.collectionCount) || 0),
    status: ["complete", "pending", "repair", "refresh"].includes(entry.status) ? entry.status : null,
    periodDays: [90,365].includes(entry.periodDays) ? entry.periodDays : 90 };
}
