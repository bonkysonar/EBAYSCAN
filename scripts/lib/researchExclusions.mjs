import { createHash } from "node:crypto";

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
