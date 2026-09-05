export type LocalSoldMetrics = {
  averageShipping: number;
  averageSoldFor: number;
  averageTotal: number;
  conservativeResalePrice?: number;
  daysSinceLastSale: number | null;
  latestSaleDate: string | null;
  priceP25: number;
  priceP25_90Days?: number;
  salesPerMonth90Days: number;
  transactionCount: number;
  unitsSold: number;
  unitsSold30Days: number;
  unitsSold90Days: number;
  unitsSold365Days: number;
};
export function revalidateCandidateLocalSold<T extends Record<string, any>>(find: T, index: any, referenceAt?: string): T;

export function conditionMatchedSoldMetrics(
  comp: any,
  index: any,
  condition?: string,
  referenceAt?: string,
): LocalSoldMetrics | null;
export function buildLocalSoldEvidence(
  compMatch: { comp: any; matchScore: number } | null,
  index: any,
  options?: { candidate?: any; condition?: string; referenceAt?: string },
): {
  metrics: LocalSoldMetrics | null;
  soldEvidence:
    | {
        albumMatchConfirmed: boolean;
        albumMismatchReasons: string[];
        artistMatchConfirmed: boolean;
        artistMismatchReasons: string[];
        capturedAt: string | null;
        condition: string;
        conservativeResalePrice: number | null;
        daysSinceLastSale: number | null;
        editionMatchConfirmed: boolean;
        editionMismatchReasons: string[];
        latestSaleDate: string | null;
        matchConfidence: number;
        salesPerMonth: number | null;
        source: string;
        status: string;
        supportsMarketplaceSellerRepeatProof: false;
        transactionCount: number | null;
        unitsSold30Days: number | null;
        unitsSold90Days: number | null;
        unitsSold365Days: number | null;
      }
    | undefined;
};
