export const EBAY_RESEARCH_NEW_CONDITION_ID: "1000";
export const EBAY_RESEARCH_VINYL_CATEGORY_ID: "176985";

export type SoldResearchCandidate = {
  artist?: string | null;
  barcode?: string | null;
  ebayActiveEditionIdentity?: {
    colors?: string[];
    format?: string | null;
    retailerExclusive?: string | null;
    signals?: string[];
  } | null;
  sourceListingTitle?: string | null;
  title?: string | null;
};

export type SoldResearchQueryKind = "exact" | "barcode" | "base";

export type SoldResearchQueryVariant = {
  identitySignals: string[];
  kind: SoldResearchQueryKind;
  query: string;
};

export type SoldResearchLink = SoldResearchQueryVariant & {
  productResearchUrl: string;
  productWindowDays: number;
  publicSoldUrl: string;
  publicWindowDays: number;
};

export function buildBaseResearchQuery(artist?: string | null, title?: string | null): string;
export function buildEbayProductResearchUrl(
  query: string,
  options?: { dayRange?: number; timeZone?: string },
): string;
export function buildEbayPublicSoldUrl(query: string): string;
export function buildSoldResearchLinks(
  candidate?: SoldResearchCandidate,
  options?: { productResearchDayRange?: number; publicWindowDays?: number; timeZone?: string },
): SoldResearchLink[];
export function buildSoldResearchQueryVariants(candidate?: SoldResearchCandidate): SoldResearchQueryVariant[];
export function normalizeResearchArtist(rawArtist?: string | null): string;
export function normalizeResearchTitle(rawTitle?: string | null): string;
