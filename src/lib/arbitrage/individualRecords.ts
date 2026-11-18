import { assessRecordCandidate } from "../../../scripts/lib/candidatePipeline.mjs";
import { retailEligibility } from "../../../scripts/lib/retailIdentity.mjs";
import { retailOfferFeedbackKey } from "./reviewFeedback";
import type { ArbitrageFind } from "./types";

export function replaceWithLatestFinds(
  current: ArbitrageFind[],
  incoming: ArbitrageFind[],
): ArbitrageFind[] {
  const byId = new Map(current.map((find) => [find.id, find]));
  return incoming
    .map((find) => {
      const existing = byId.get(find.id);
      return existing?.dismissedAt &&
        retailOfferFeedbackKey(existing) === retailOfferFeedbackKey(find)
        ? { ...find, dismissedAt: existing.dismissedAt }
        : find;
    })
    .sort(
      (left, right) =>
        new Date(right.capturedAt).getTime() -
        new Date(left.capturedAt).getTime(),
    );
}

export function isIndividualRecordFind(find: ArbitrageFind): boolean {
  if (find.opportunityType === "sitewide_sale" || find.purchasePrice <= 0)
    return false;
  if (!retailEligibility(find).eligible) return false;
  const title = `${find.title} ${find.sourceListingTitle ?? ""}`.trim();
  if (!title || isSourceCopyTitle(title)) return false;
  return assessRecordCandidate({
    context: `${find.artist} ${find.sourceListingTitle ?? ""}`,
    source: {
      id: find.sourceId,
      name: find.sourceName,
      url: find.sourceUrl,
    },
    title:
      find.shopifyVariantTitle ||
      find.sourceListingTitle ||
      (!find.artist.trim() || /^unknown artist$/i.test(find.artist.trim()) ? find.title : find.artist + " — " + find.title),
    url: find.sourceUrl,
  }).accepted;
}

function isSourceCopyTitle(title: string): boolean {
  return /^(?:cheap|deals?|home|facebook page|filter amazon(?: by price)?|click here|continue shopping|sign up|sign in|order history|premium membership|time|under|\d+% off)$/i.test(
    title.replace(/&nbsp;/g, " ").trim(),
  );
}
