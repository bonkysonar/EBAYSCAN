import type { ArbitrageFind, ArbitrageMatchConfidence } from "./types";

export type ActiveEditionIdentity = {
  colors: string[];
  format: string | null;
  key: string;
  retailerExclusive: string | null;
  signals: string[];
};

export type ActiveSearchProfile = {
  artist: string;
  edition: ActiveEditionIdentity;
  excludedItemIdentityTokens: string[];
  key: string;
  primary: string;
  title: string;
  variants: string[];
};

export type ActiveListingMatch = {
  confidence: ArbitrageMatchConfidence;
  editionSignals: string[];
  matched: boolean;
  reasons: string[];
  score: number;
};

export function activeSearchKey(find: ArbitrageFind): string | null;
export function buildActiveSearchProfile(find: ArbitrageFind): ActiveSearchProfile | null;
export function cleanActiveSearchText(value: unknown): string;
export function ebayItemIdentityTokens(...values: unknown[]): string[];
export function extractEditionIdentity(value: unknown, releaseTitle?: string): ActiveEditionIdentity;
export function isExcludedEbayActiveListing(item: unknown, profile: ActiveSearchProfile): boolean;
export function matchActiveListing(title: string, profile: ActiveSearchProfile): ActiveListingMatch;
