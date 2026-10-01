import {
  retailEligibility,
  isVariantDescription,
} from "../../../scripts/lib/retailIdentity.mjs";

// This list has no fill quota. Aggregate demand may justify one timing check,
// but cannot establish dated velocity or an automatic BUY.
export function consideration(find, now = Date.now()) {
  const remainingChecks = [];
  const exclude = (exclusionReason) => ({ qualifies: false, remainingChecks, exclusionReason });
  const age = (Number(now) - Date.parse(find.capturedAt)) / 86400000;
  if (
    find.opportunityType === "sitewide_sale" ||
    !retailEligibility(find).eligible ||
    find.identityStatus === "unresolved" ||
    /unknown artist/i.test(find.artist ?? "") ||
    find.learningSuppressed ||
    (find.decision === "REJECT" && !find.reasonCodes?.includes("ECONOMICS_HARD_FAIL"))
  )
    return exclude("ineligible_or_rejected");
  if (!(age >= -0.004 && age <= 1)) return exclude("offer_needs_refresh");
  if (find.decision === "BUY") return { qualifies: true, remainingChecks };
  if (find.currencyConversionRequired) return exclude("currency_unverified");
  if (find.expectedNetProfit == null || find.roiRatio == null) return exclude("resale_evidence_missing");
  if (!(find.expectedNetProfit >= 7 && find.roiRatio >= 0.3)) return exclude("margin_too_thin");
  if (
    !find.gates?.evidenceFreshness ||
    !find.gates?.activeEvidence ||
    find.retailVerification?.status === "failed" ||
    find.retailVerification?.status === "unavailable"
  )
    return exclude("verification_incomplete");
  const dated = find.gates?.soldEvidence && find.soldUnits90Days >= 3;
  const aggregate =
    find.ebayResearchStatus === "validated" &&
    find.totalSoldCount >= 5 &&
    ["high", "medium"].includes(find.ebaySoldMatchConfidence) &&
    Number.isFinite(find.daysSinceLastSale) &&
    find.daysSinceLastSale <= 90;
  if (!dated && !aggregate) return exclude("insufficient_recent_demand");
  if (!dated)
    remainingChecks.push(
      "Confirm recent sales pace; aggregate research does not establish turnover.",
    );
  if (!find.gates?.purchaseOffer)
    remainingChecks.push(
      find.shippingScenario ? find.shippingScenario.condition : find.appliedSaleCampaignId
        ? "Confirm the campaign price for this exact variant at checkout."
        : "Confirm current stock and price for the exact retailer variant.",
    );
  if (
    dated &&
    (!find.gates?.demand || !find.gates?.supply || !find.gates?.matchConfidence)
  )
    return exclude("demand_supply_or_match_failed");
  // The evidence/economics gates above define this review list. A second
  // heuristic tier cutoff hid otherwise qualified small, slower opportunities.
  if (remainingChecks.length > 1) return exclude("multiple_remaining_checks");
  return { qualifies: true, remainingChecks };
}

export const decisionListBlockerLabels = {
  ineligible_or_rejected: "ineligible or rejected by verified evidence",
  offer_needs_refresh: "retailer offer needs a fresh check",
  currency_unverified: "currency conversion unverified",
  resale_evidence_missing: "no usable sold-price evidence",
  margin_too_thin: "profit or ROI below the consideration floor",
  verification_incomplete: "market or retailer verification incomplete",
  insufficient_recent_demand: "insufficient recent sold demand",
  demand_supply_or_match_failed: "demand, competition, or pressing match fails",
  multiple_remaining_checks: "more than one unresolved check",
};

/** One first blocker per product; counts reconcile rather than double counting. */
export function decisionListDiagnostics(finds, now = Date.now()) {
  const products = finds.filter(f => f.opportunityType !== "sitewide_sale");
  const blockers = {};
  let qualified = 0;
  for (const find of products) {
    const result = consideration(find, now);
    if (result.qualifies) qualified++;
    else blockers[result.exclusionReason] = (blockers[result.exclusionReason] ?? 0) + 1;
  }
  return { products: products.length, qualified, blockers };
}

export function releaseGroupKey(find) {
  const parts = String(find.title ?? "").split(/\s+[-–—]\s+/);
  const title = parts
    .filter((part, index) => index === 0 || !isVariantDescription(part))
    .join(" ")
    .replace(/\([^)]*(?:vinyl|splatter|colou?r|\blp\b)[^)]*\)/gi, "");
  return `${find.artist}|${title}|${find.recordFormat ?? "LP"}`
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, "");
}

export function selectDecisionList(
  finds,
  { limit = 15, now = Date.now() } = {},
) {
  const groups = new Set();
  return finds
    .filter((find) => consideration(find, now).qualifies)
    .sort(
      (a, b) =>
        Number(b.decision === "BUY") - Number(a.decision === "BUY") ||
        (b.expectedNetProfit ?? 0) - (a.expectedNetProfit ?? 0) ||
        (b.roiRatio ?? 0) - (a.roiRatio ?? 0),
    )
    .filter((find) => {
      const key = releaseGroupKey(find);
      if (groups.has(key)) return false;
      groups.add(key);
      return true;
    })
    .slice(0, limit);
}

export function scannerFunnel(finds, reports = [], now = Date.now()) {
  const products = finds.filter(
    (find) => find.opportunityType !== "sitewide_sale",
  );
  const displayed = new Set(
    selectDecisionList(products, { now }).map((find) => find.id),
  );
  const summarize = (rows) => ({
    eligible: rows.filter((f) => retailEligibility(f).eligible).length,
    identityResolved: rows.filter(
      (f) =>
        f.identityStatus !== "unresolved" && !/unknown artist/i.test(f.artist),
    ).length,
    priced: rows.filter((f) => f.gates?.purchaseOffer).length,
    evidenceCompleted: rows.filter(
      (f) => f.ebayResearchStatus === "validated" || f.gates?.soldEvidence,
    ).length,
    economicallyQualified: rows.filter(
      (f) => f.expectedNetProfit >= 7 && f.roiRatio >= 0.3,
    ).length,
    displayed: rows.filter((f) => displayed.has(f.id)).length,
    retained: rows.length,
  });
  return {
    version: 1,
    measuredAt: new Date(now).toISOString(),
    ...summarize(products),
    decisionList: decisionListDiagnostics(products, now),
    bySource: reports.map((report) => ({
      sourceId: report.id,
      discovered: report.candidateCount ?? 0,
      ...summarize(products.filter((f) => f.sourceId === report.id)),
    })),
    byCampaign: finds
      .filter((f) => f.opportunityType === "sitewide_sale")
      .map((c) => ({
        campaignId: c.saleCampaignId ?? c.id,
        sourceId: c.sourceId,
        ...summarize(
          products.filter(
            (f) => f.appliedSaleCampaignId === (c.saleCampaignId ?? c.id),
          ),
        ),
        unresolved: products.filter((f) =>
          f.campaignChecks?.some(
            (check) =>
              check.campaignId === (c.saleCampaignId ?? c.id) &&
              check.reasons.length,
          ),
        ).length,
      })),
  };
}
