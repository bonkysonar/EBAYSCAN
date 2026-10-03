/** Summary of the products actually in a merged report, not just its latest refresh. */
export function publishedResearchProgress(finds, now = Date.now()) {
  const products = finds.filter(find => find.opportunityType !== "sitewide_sale");
  const counts = { planned: products.length, completed: 0, validated: 0, noRows: 0, failed: 0, pending: 0, researchedRows: 0 };
  for (const find of products) {
    const age = Number(new Date(now)) - Date.parse(find.ebayResearchUpdatedAt);
    const complete = find.ebayResearchCompletionVersion === 2 && find.ebayResearchSearchComplete === true &&
      age >= -300000 && age <= 7 * 86400000;
    if (!complete) {
      counts[find.ebayResearchStatus === "failed" ? "failed" : "pending"]++;
      continue;
    }
    counts.completed++;
    if (find.ebayResearchStatus === "validated") {
      counts.validated++;
      counts.researchedRows += find.ebayResearchRows?.length ?? 0;
    } else if (find.ebayResearchStatus === "no_rows") counts.noRows++;
    else counts[find.ebayResearchStatus === "failed" ? "failed" : "pending"]++;
  }
  const complete = products.length > 0 && counts.completed === products.length && !counts.failed && !counts.pending;
  return { ...counts, scope: "visible_report", limit: products.length, outsidePlan: 0, complete,
    status: !products.length ? "not_needed" : complete ? "complete" : "incomplete" };
}
