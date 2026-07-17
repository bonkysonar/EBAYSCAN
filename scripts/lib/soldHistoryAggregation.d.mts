export type ApiSoldHistoryRecord = {
  conditionBucket?: "new_sealed" | "unknown" | "used";
  customLabel?: string;
  inferredArtist?: string;
  inferredReleaseTitle?: string;
  mediaGrade?: string;
  normalizedKey?: string;
  quantity: number;
  saleDate?: string;
  shippingPaid: number;
  sleeveGrade?: string;
  soldFor: number;
  title: string;
  totalBuyerPaid: number;
  [key: string]: unknown;
};

export function buildSoldHistoryIndex(
  records: ApiSoldHistoryRecord[],
  options?: { asOf?: Date | string; source?: string; sourceSheets?: string[] },
): Record<string, unknown>;
export function buildArtistAggregates(
  records: ApiSoldHistoryRecord[],
  asOfValue?: Date | string,
): Array<Record<string, unknown>>;
export function enrichSoldRecordIdentity<T extends ApiSoldHistoryRecord>(
  record: T,
): T & Required<Pick<ApiSoldHistoryRecord, "conditionBucket" | "normalizedKey">>;
export function inferSoldCondition(title: string, customLabel?: string): "new_sealed" | "unknown" | "used";
export function extractMediaSleeveGrades(title: string): { mediaGrade?: string; sleeveGrade?: string };
export function inferArtistAndRelease(title: string): { artist?: string; releaseTitle?: string };
export function soldHistoryKey(title: string): string;
export function normalizeSoldText(value: string): string;
export function summarizeRecords(records: ApiSoldHistoryRecord[], asOfValue?: Date | string): Record<string, unknown>;
