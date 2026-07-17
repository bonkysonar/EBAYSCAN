import type {
  EbayDateRangeOptions,
  EbayFinancialTransaction,
  EbaySoldHistoryEnv,
  EbaySoldOrder,
} from "../src/server/ebaySoldHistoryApi";
import type { EbayApiSoldRecord, EbaySyncState } from "./lib/ebaySoldHistorySync.mjs";

export type EbaySoldHistorySyncOptions = Omit<EbayDateRangeOptions, "now"> & {
  api?: {
    fetchEbayFinancialTransactions(
      env: EbaySoldHistoryEnv,
      options: EbayDateRangeOptions,
    ): Promise<EbayFinancialTransaction[]>;
    fetchEbayOrders(env: EbaySoldHistoryEnv, options: EbayDateRangeOptions): Promise<EbaySoldOrder[]>;
  };
  cwd?: string;
  dryRun?: boolean;
  env?: EbaySoldHistoryEnv;
  fullRebuild?: boolean;
  now?: Date | string;
  outputDir?: string;
  refreshOverlapDays?: number;
};

export function syncEbaySoldHistory(options?: EbaySoldHistorySyncOptions): Promise<{
  dryRun: boolean;
  economics: Record<string, unknown>;
  financialTransactionCount: number;
  index: Record<string, unknown>;
  orderCount: number;
  outputDir: string;
  range: { from: string; lookbackDays: number; refreshOverlapDays: number; to: string };
  recordCount: number;
  records: EbayApiSoldRecord[];
  state: EbaySyncState;
  stats: { applied: number; duplicate: number; unattributed: number };
}>;

export function parseSyncCli(argv: string[]): Record<string, unknown>;
