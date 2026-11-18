import { createHash } from "node:crypto";
import { learningIdentity } from "./retailLearning.mjs";

// An exclusion is an explicit abstention, NEVER a completed capture or zero demand.
export function candidateIdentity(find) {
  return createHash("sha256").update(JSON.stringify([find.id, find.sourceId, find.sourceUrl, find.artist, find.title, find.barcode, find.catalogNumber, find.retailEditionText, find.purchasePrice])).digest("hex");
}
export function researchSelection(payload) {
  const pool = payload.researchCandidates ?? payload.finds ?? [];
  const ledger = payload.researchExclusions ?? [];
  if (!Array.isArray(ledger)) throw new Error("Invalid research exclusion ledger");
  const ids = new Set();
  for (const row of ledger) {
    const find = pool.find(f => f.id === row.findId);
    if (!find || find.opportunityType === "sitewide_sale" || ids.has(row.findId) || row.runId !== payload.runId ||
        row.reason !== "unverifiable_sold_controls" || row.outcome !== "excluded_unpriceable" ||
        row.candidateIdentity !== candidateIdentity(find) || !Number.isFinite(Date.parse(row.reviewedAt)) ||
        row.recoveryAttempted !== true || row.evidenceVerified !== false)
      throw new Error("Research exclusion does not match this exact candidate and run");
    ids.add(row.findId);
  }
  return { included: pool.filter(f => !ids.has(f.id)), excluded: ledger, ids };
}

// Scheduling hint only. A later run still requires its own sold research or
// explicit review, including when there are too few alternatives to defer.
export function recentUnpriceableOffers(previous, now) {
  const offers = new Map();
  if (!previous?.researchExclusions?.length || !previous.researchCandidates) return offers;
  const { excluded } = researchSelection(previous);
  const byId = new Map(previous.researchCandidates.map(find => [find.id, find]));
  for (const row of excluded) {
    const age = Number(new Date(now)) - Date.parse(row.reviewedAt);
    if (age >= 0 && age < 48 * 3600000)
      offers.set(row.findId, { identity: row.candidateIdentity, observation: learningIdentity(byId.get(row.findId)).observation });
  }
  return offers;
}

export function unchangedUnpriceableOffer(find, offers) {
  const prior = offers?.get(find.id);
  return Boolean(prior && prior.identity === candidateIdentity(find) &&
    prior.observation === learningIdentity(find).observation);
}
