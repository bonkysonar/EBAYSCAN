import type { ArbitrageFind } from "./types";

export type RecordOutcome =
  | "bought"
  | "false_positive"
  | "listed"
  | "margin_too_thin"
  | "not_for_me"
  | "returned"
  | "sold"
  | "too_slow";
export type SaleReviewOutcome = "confirmed" | "expired" | "false_positive" | "wrong_scope";

type FeedbackEntry<Status extends string> = {
  observationKey?: string;
  status: Status;
  updatedAt: string;
};

export type ReviewFeedback = {
  recordOutcomes: Record<string, FeedbackEntry<RecordOutcome>>;
  saleOutcomes: Record<string, FeedbackEntry<SaleReviewOutcome>>;
};

const STORAGE_KEY = "record-scanner-arbitrage-review-feedback-v1";

export function loadReviewFeedback(): ReviewFeedback {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ReviewFeedback>;
    return {
      recordOutcomes: parsed.recordOutcomes ?? {},
      saleOutcomes: parsed.saleOutcomes ?? {},
    };
  } catch {
    return emptyFeedback();
  }
}

export function saveReviewFeedback(feedback: ReviewFeedback): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(feedback));
  } catch {
    // Keep the current in-memory review state when browser storage is unavailable.
  }
}

export function setRecordOutcome(
  feedback: ReviewFeedback,
  findId: string,
  status: RecordOutcome | null,
  updatedAt = new Date().toISOString(),
  observationKey?: string,
): ReviewFeedback {
  const recordOutcomes = { ...feedback.recordOutcomes };
  if (status) {
    recordOutcomes[findId] = observationKey
      ? { observationKey, status, updatedAt }
      : { status, updatedAt };
  }
  else delete recordOutcomes[findId];
  return { ...feedback, recordOutcomes };
}

export function setSaleOutcome(
  feedback: ReviewFeedback,
  campaignId: string,
  status: SaleReviewOutcome | null,
  updatedAt = new Date().toISOString(),
  observationKey?: string,
): ReviewFeedback {
  const saleOutcomes = { ...feedback.saleOutcomes };
  if (status) {
    saleOutcomes[campaignId] = observationKey
      ? { observationKey, status, updatedAt }
      : { status, updatedAt };
  }
  else delete saleOutcomes[campaignId];
  return { ...feedback, saleOutcomes };
}

export function recordOutcomeForFind(
  feedback: ReviewFeedback,
  find: ArbitrageFind,
): RecordOutcome | undefined {
  const entry = feedback.recordOutcomes[find.id];
  return entry?.observationKey === retailOfferFeedbackKey(find) ? entry.status : undefined;
}

export function saleOutcomeForCampaign(
  feedback: ReviewFeedback,
  sale: ArbitrageFind,
): SaleReviewOutcome | undefined {
  const entry = feedback.saleOutcomes[saleFeedbackKey(sale)];
  return entry?.observationKey === saleCampaignObservationKey(sale) ? entry.status : undefined;
}

export function pruneStaleRecordFeedback(
  feedback: ReviewFeedback,
  finds: ArbitrageFind[],
): ReviewFeedback {
  const recordOutcomes = { ...feedback.recordOutcomes };
  let changed = false;
  for (const find of finds) {
    const entry = recordOutcomes[find.id];
    if (entry && entry.observationKey !== retailOfferFeedbackKey(find)) {
      delete recordOutcomes[find.id];
      changed = true;
    }
  }
  return changed ? { ...feedback, recordOutcomes } : feedback;
}

export function pruneStaleSaleFeedback(
  feedback: ReviewFeedback,
  campaigns: ArbitrageFind[],
): ReviewFeedback {
  const saleOutcomes = { ...feedback.saleOutcomes };
  let changed = false;
  for (const campaign of campaigns) {
    const key = saleFeedbackKey(campaign);
    const entry = saleOutcomes[key];
    if (entry && entry.observationKey !== saleCampaignObservationKey(campaign)) {
      delete saleOutcomes[key];
      changed = true;
    }
  }
  return changed ? { ...feedback, saleOutcomes } : feedback;
}

export function retailOfferFeedbackKey(find: ArbitrageFind): string {
  return JSON.stringify([
    normalizedText(find.sourceUrl),
    normalizedText(find.discoveryUrl),
    normalizedText(find.sourceListingTitle ?? find.title),
    normalizedText(find.condition),
    normalizedText(find.sourceCurrency),
    normalizedText(find.sourcePublishedAt),
    finiteNumber(find.purchasePrice),
    finiteNumber(find.sourceOriginalPrice),
    finiteNumber(find.sourceDiscountPercent),
    finiteNumber(find.quantityAvailable),
  ]);
}

export function saleCampaignObservationKey(sale: ArbitrageFind): string {
  return JSON.stringify([
    normalizedText(sale.saleContentHash ?? sale.saleFingerprint),
    normalizedText(sale.reopenedAt),
    saleLifecycleObservationBucket(sale),
    normalizedText(sale.saleSignal),
    normalizedText(sale.saleEvidence),
    normalizedText(sale.saleScope),
    finiteNumber(sale.saleDiscountPercent),
    normalizedText(sale.sourceUrl),
  ]);
}

export function saleFeedbackKey(sale: {
  id: string;
  saleCampaignId?: string;
  saleFingerprint?: string;
}): string {
  return sale.saleCampaignId || sale.saleFingerprint || sale.id;
}

function emptyFeedback(): ReviewFeedback {
  return { recordOutcomes: {}, saleOutcomes: {} };
}

function finiteNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizedText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function saleLifecycleObservationBucket(sale: ArbitrageFind): "ended" | "observed" | "unknown" {
  if (sale.saleStatus === "unknown") return "unknown";
  if (sale.saleStatus === "ended") return "ended";
  return "observed";
}
