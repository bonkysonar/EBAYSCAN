import {
  retailEligibility,
  isVariantDescription,
} from "../../../scripts/lib/retailIdentity.mjs";

// This list has no fill quota. Aggregate demand may justify one timing check,
// but cannot establish dated velocity or an automatic BUY.
export function consideration(find, now = Date.now()) {
  const remainingChecks = [];
  const age = (Number(now) - Date.parse(find.capturedAt)) / 86400000;
  if (
    find.opportunityType === "sitewide_sale" ||
    !retailEligibility(find).eligible ||
    find.identityStatus === "unresolved" ||
    /unknown artist/i.test(find.artist ?? "") ||
    !(age >= -0.004 && age <= 1) ||
    find.learningSuppressed ||
    !["A", "B"].includes(find.candidateTier) ||
    find.decision === "REJECT"
  )
    return { qualifies: false, remainingChecks };
  if (find.decision === "BUY") return { qualifies: true, remainingChecks };
  if (
    !(find.expectedNetProfit >= 7 && find.roiRatio >= 0.3) ||
    !find.gates?.evidenceFreshness ||
    !find.gates?.activeEvidence ||
    find.currencyConversionRequired ||
    find.retailVerification?.status === "failed" ||
    find.retailVerification?.status === "unavailable"
  )
    return { qualifies: false, remainingChecks };
  const dated = find.gates?.soldEvidence && find.soldUnits90Days >= 3;
  const aggregate =
    find.ebayResearchStatus === "validated" &&
    find.totalSoldCount >= 5 &&
    ["high", "medium"].includes(find.ebaySoldMatchConfidence) &&
    Number.isFinite(find.daysSinceLastSale) &&
    find.daysSinceLastSale <= 90;
  if (!dated && !aggregate) return { qualifies: false, remainingChecks };
  if (!dated)
    remainingChecks.push(
      "Confirm recent sales pace; aggregate research does not establish turnover.",
    );
  if (!find.gates?.purchaseOffer)
    remainingChecks.push(
      find.appliedSaleCampaignId
        ? "Confirm the campaign price for this exact variant at checkout."
        : "Confirm current stock and price for the exact retailer variant.",
    );
  if (
    dated &&
    (!find.gates?.demand || !find.gates?.supply || !find.gates?.matchConfidence)
  )
    return { qualifies: false, remainingChecks };
  return { qualifies: remainingChecks.length <= 1, remainingChecks };
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
