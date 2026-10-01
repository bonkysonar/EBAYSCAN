import type { ArbitrageFind } from "../../src/lib/arbitrage/types.js";

export type ReviewedRetailPage = {
  sourceId: string;
  artist: string;
  title: string;
  capturedAt: string;
  url: string;
  text: string;
  shippingPolicy?: { capturedAt: string; url: string; text: string };
};

export function reviewedRetailOffers(document: unknown, now?: string): Array<ArbitrageFind & {
  reviewedRetailEvidence: ReviewedRetailPage & { textHash: string };
}>;
export function refreshReviewedRetailOffer<T extends ArbitrageFind>(find: T, now?: string): T;
export function reviewedRetailOfferIsCurrent(find: unknown, report: unknown, now?: string): boolean;
