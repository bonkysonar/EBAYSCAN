import { createHash } from "node:crypto";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const REVIEW_OUTCOMES = [
  "bought",
  "listed",
  "sold",
  "returned",
  "not_for_me",
  "too_slow",
  "margin_too_thin",
  "false_positive",
  "bad_identity",
  "wrong_format",
  "stale_offer",
  "worth_opening",
];
export function learningIdentity(find) {
  return {
    key: hash([
      find.sourceId,
      find.barcode ||
        find.sku || [find.artist, find.title, find.shopifyVariantTitle],
    ]),
    observation: hash([
      find.purchasePrice,
      find.sourceCurrency,
      find.available !== false,
      find.artist,
      find.title,
      find.barcode,
      find.appliedSaleCampaignId,
      find.learningEvidenceRevision ?? null,
    ]),
  };
}
export function applyRetailLearning(finds, entries = [], now = Date.now()) {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return finds.map((find) => {
    const identity = learningIdentity(find),
      entry = byKey.get(identity.key);
    const suppressed =
      entry &&
      entry.observation === identity.observation &&
      now - Date.parse(entry.updatedAt) < 14 * 86400000 &&
      [
        "not_for_me",
        "too_slow",
        "margin_too_thin",
        "false_positive",
        "bad_identity",
        "wrong_format",
        "stale_offer",
      ].includes(entry.outcome);
    return { ...find, learningSuppressed: Boolean(suppressed) };
  });
}
