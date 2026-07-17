import type {
  EbayFinancialTransaction,
  EbaySoldOrder,
} from "../../src/server/ebaySoldHistoryApi";

export type EbayApiSoldRecord = {
  conditionBucket: "new_sealed" | "unknown" | "used";
  currency: string;
  ebayAdFees: number;
  ebaySaleFeeCredits: number;
  ebaySaleFees: number;
  ebaySaleFeesGross: number;
  economicsAttribution: Record<string, string>;
  estimatedNetAfterEbayCosts: number;
  financialRefundAmount: number;
  fulfillmentRefundAmount: number;
  itemNumber?: string;
  lineItemId: string;
  normalizedKey: string;
  orderNumber: string;
  otherEbayCharges: number;
  quantity: number;
  recordKey: string;
  refundAmount: number;
  refundRate: number;
  retainedQuantity: number;
  saleDate: string;
  shippingLabelCost: number;
  shippingLabelCredits: number;
  shippingLabelDebits: number;
  shippingPaid: number;
  soldFor: number;
  sourceSheet: "eBay API";
  title: string;
  totalBuyerPaid: number;
  [key: string]: unknown;
};

export type EbaySyncState = {
  appliedFinancialEventDigests: string[];
  financialEventContentDigests: Record<string, string>;
  lastSuccessfulAt?: string;
  lastSuccessfulFrom?: string;
  lastSuccessfulTo?: string;
  lookbackDays: number;
  refreshOverlapDays: number;
  recordsDigest?: string;
  source: "ebay-fulfillment-finances";
  unattributedShippingLabelSamples: Array<{ amount: number; currency: string; date: string }>;
  unattributedTotalsByCurrency: Record<string, Record<string, number>>;
  version: 1;
};

export function ordersToSoldRecords(orders: EbaySoldOrder[]): EbayApiSoldRecord[];
export function mergeApiSoldRecords(
  existingRecords: EbayApiSoldRecord[],
  freshRecords: EbayApiSoldRecord[],
  options?: { replaceFrom?: string; replaceTo?: string },
): EbayApiSoldRecord[];
export function applyFinancialTransactions(
  records: EbayApiSoldRecord[],
  transactions: EbayFinancialTransaction[],
  previousState?: Partial<EbaySyncState>,
): {
  records: EbayApiSoldRecord[];
  state: EbaySyncState;
  stats: { applied: number; duplicate: number; unattributed: number };
};
export function buildEbayEconomicsSummary(
  records: EbayApiSoldRecord[],
  state: Partial<EbaySyncState>,
  options?: { createdAt?: Date | string; from?: string; to?: string },
): Record<string, unknown>;
export function buildApiSoldHistoryIndex(
  records: EbayApiSoldRecord[],
  options?: { asOf?: Date | string; source?: string; sourceSheets?: string[] },
): Record<string, unknown>;
export function mergeSoldHistoryBaseline(
  apiRecords: EbayApiSoldRecord[],
  baselineRecords: Array<Record<string, unknown>>,
): Array<Record<string, unknown>>;
export function normalizeSyncState(value?: Partial<EbaySyncState>): EbaySyncState;
export function hasFinancialEventCorrections(
  transactions: EbayFinancialTransaction[],
  state?: Partial<EbaySyncState>,
): boolean;
export function soldHistoryRecordsDigest(records: EbayApiSoldRecord[]): string;
export function resolveEbaySyncRange(options?: {
  clockSkewSafetyMs?: number;
  from?: Date | string;
  lastSuccessfulTo?: string;
  lookbackDays?: number;
  now?: Date | string;
  refreshOverlapDays?: number;
  to?: Date | string;
}): {
  clockSkewSafetyMs: number;
  from: string;
  lookbackDays: number;
  refreshOverlapDays: number;
  to: string;
};
export function finalizeSyncState(
  state: Partial<EbaySyncState>,
  range: { from: string; lookbackDays: number; refreshOverlapDays: number; to: string },
  completedAt?: Date | string,
): EbaySyncState;
export function assertSanitizedSoldHistoryOutput(value: unknown): void;
