export function retailEligibility(find?: Record<string, any>): {
  eligible: boolean;
  reason: string | null;
};
export function shopifyIdentity(
  product: Record<string, any>,
  variant?: Record<string, any>,
  source?: Record<string, any>,
): {
  physicalFormatConfirmed: boolean;
  artist: string;
  title: string;
  identityStatus: "resolved" | "unresolved";
  identitySource: string;
  recordFormat: string;
  preorder: boolean;
  releaseDate: string | null;
};
export function isVariantDescription(value: unknown): boolean;

export function retailerArtistConflict(
  artist: unknown,
  sourceName: unknown,
): boolean;
