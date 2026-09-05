import { normalizeSaleCampaigns } from "../lib/arbitrage/saleCampaigns";
import type { ArbitrageImportPayload } from "../lib/arbitrage/types";
import { evaluateOpportunity } from "../lib/arbitrage/rules";
import { selectDecisionList } from "../lib/arbitrage/decisionList.mjs";
export function CampaignRecordResults({
  payload,
}: {
  payload: ArbitrageImportPayload | null;
}) {
  const campaigns = normalizeSaleCampaigns(payload?.saleEvents ?? []).campaigns;
  const retailers = [
    ...new Set(campaigns.map((c) => c.sourceId ?? c.sourceName)),
  ];
  if (!campaigns.length) return null;
  const products = (payload?.finds ?? [])
    .filter((f) => f.opportunityType !== "sitewide_sale")
    .map((f) => evaluateOpportunity(f));
  const funnel = payload?.funnel?.byCampaign as
    | Array<{
        campaignId: string;
        retained: number;
        priced: number;
        evidenceCompleted: number;
        economicallyQualified: number;
        displayed: number;
        unresolved: number;
      }>
    | undefined;
  return (
    <section className="panel">
      <h2>Records behind the sales</h2>
      <p>
        Each sale feeds the same record-level price, demand, and profit checks.
        Checkout-only prices stay estimates.
      </p>
      {retailers.map((retailer) => (
        <details key={retailer}>
          <summary>
            {
              campaigns.find((c) => (c.sourceId ?? c.sourceName) === retailer)
                ?.sourceName
            }{" "}
            ·{" "}
            {
              campaigns.filter((c) => (c.sourceId ?? c.sourceName) === retailer)
                .length
            }{" "}
            offers
          </summary>
          {campaigns
            .filter((c) => (c.sourceId ?? c.sourceName) === retailer)
            .map((campaign) => {
              const id = campaign.saleCampaignId ?? campaign.id;
              const rows = products.filter(
                (f) =>
                  f.appliedSaleCampaignId === id ||
                  campaign.mergedCampaignIds.includes(
                    f.appliedSaleCampaignId ?? "",
                  ),
              );
              const best = selectDecisionList(rows, { limit: 3 });
              const counts = funnel?.find((row) => row.campaignId === id);
              return (
                <details key={id} className="campaign-record-results">
                  <summary>
                    {campaign.sourceName} ·{" "}
                    {campaign.saleDiscountPercent
                      ? `${campaign.saleDiscountQualifier === "up_to" ? "Up to " : ""}${campaign.saleDiscountPercent}% offer`
                      : "Basket offer"}{" "}
                    · {best.length} worth considering
                  </summary>
                  <p>
                    {counts?.retained ?? rows.length} eligible offers retained
                    for research · {counts?.priced ?? 0} price verified ·{" "}
                    {counts?.evidenceCompleted ?? 0} evidence complete ·{" "}
                    {counts?.economicallyQualified ?? 0} meet the profit
                    threshold · {counts?.unresolved ?? 0} have unresolved terms
                    or exclusions.
                  </p>
                  <p>
                    {String(
                      campaign.campaignTerms?.dateText ??
                        "No explicit end date confirmed.",
                    )}{" "}
                    {campaign.saleCode ? `Code: ${campaign.saleCode}.` : ""}
                  </p>
                  {best.length ? (
                    <ul>
                      {best.map((find) => (
                        <li key={find.id}>
                          <a
                            href={`#/retail-arbitrage?find=${encodeURIComponent(find.id)}`}
                          >
                            {find.artist} — {find.title}
                          </a>{" "}
                          · estimated net ${find.expectedNetProfit?.toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      No records from this campaign currently clear the
                      decision-list requirements.
                    </p>
                  )}
                  <a
                    href={`#/retail-arbitrage?source=${encodeURIComponent(campaign.sourceId ?? "")}`}
                  >
                    Review this retailer’s research candidates
                  </a>
                  {campaign.basketScenario ? (
                    <p>
                      Illustrative basket: {campaign.basketScenario.quantity}{" "}
                      records, {campaign.basketScenario.currency}{" "}
                      {campaign.basketScenario.total.toFixed(2)} before tax
                      {campaign.basketScenario.freeShipping
                        ? ", advertised free-shipping threshold met"
                        : ", plus inbound shipping"}
                      . Additional stock costs{" "}
                      {campaign.basketScenario.additionalCash.toFixed(2)}.{" "}
                      {campaign.basketScenario.eligible
                        ? "Campaign terms qualify; each record still needs its own resale validation."
                        : `Needs confirmation: ${campaign.basketScenario.reasons.join(", ")}.`}
                    </p>
                  ) : null}
                </details>
              );
            })}
        </details>
      ))}
    </section>
  );
}
