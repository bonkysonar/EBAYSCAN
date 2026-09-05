export type AlbumDemand = {
  version: 1;
  status: "observed";
  source: "local-own-sales-history" | "ebay-product-research";
  scope: "album_across_conditions_and_editions";
  artistMatchConfirmed: true;
  albumMatchConfirmed: true;
  capturedAt: string | null;
  latestSaleDate: string;
  transactionCount: number | null;
  unitsSold: number;
  unitsSold90Days: number | null;
  unitsSold365Days: number | null;
};
export type ResearchDemand = {
  observed: boolean;
  source:
    | "album_own_sales"
    | "exact_own_sales"
    | "marketplace_sold"
    | "unproven";
  units: number;
  recentUnits: number;
  latestSaleDate: string | null;
};
export function createAlbumDemandIndex(
  index?: {
    createdAt?: string;
    comps?: Array<{ records?: Array<Record<string, unknown>> }>;
  },
  options?: { now?: string | number | Date },
): {
  matchingComps(candidate?: { artist?: string | null; title?: string | null }): Array<{ records?: Array<Record<string, unknown>> }>;
  match(candidate?: {
    artist?: string | null;
    title?: string | null;
    identityStatus?: string | null;
  }): AlbumDemand | undefined;
};
export function researchDemand(
  candidate?: Record<string, unknown>,
): ResearchDemand;
export function ownSaleMatchesAlbum(
  candidate?: { artist?: string | null; title?: string | null },
  record?: { title?: string | null },
): boolean;
