export type SaleCampaignStatus = "changed" | "ended" | "evergreen" | "new" | "ongoing" | "unknown";

export type SaleCampaign = Record<string, unknown> & {
  capturedAt: string;
  endedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  reopenedAt: string | null;
  saleCampaignId: string;
  saleConsecutiveSeenCount: number;
  saleContentHash: string;
  saleEvidenceHash: string;
  saleFailureCount: number;
  saleFingerprint: string;
  saleLastCheckedAt: string;
  saleMissCount: number;
  saleObservationCount: number;
  saleObservationPageCount: number;
  saleObservationUrls: string[];
  saleObservedThisRun: boolean;
  saleScanCount: number;
  saleStatus: SaleCampaignStatus;
  sourceId: string;
  sourceUrl: string;
};

export type SaleCampaignHistoryEntry = {
  at: string;
  campaignId: string;
  contentHash: string;
  evidenceHash: string;
  fromStatus: SaleCampaignStatus | null;
  id: string;
  reason: string;
  runId: string;
  sourceId: string;
  toStatus: SaleCampaignStatus;
};

export type SaleCampaignLedger = {
  campaigns: SaleCampaign[];
  history: SaleCampaignHistoryEntry[];
  runId: string;
  schemaVersion: 1;
  updatedAt: string;
};

export const SALE_CAMPAIGN_LEDGER_SCHEMA_VERSION: 1;

export function reconcileSaleCampaigns(input: {
  observedAt: string;
  options?: {
    endAfterMisses?: number;
    evergreenAfterScans?: number;
    maxHistoryEntries?: number;
  };
  previousLedger?: SaleCampaignLedger | null;
  runId: string;
  saleEvents?: Array<Record<string, unknown>>;
  sourceReports?: Array<Record<string, unknown>>;
}): {
  activeSaleEvents: SaleCampaign[];
  historyEvents: SaleCampaignHistoryEntry[];
  ledger: SaleCampaignLedger;
  summary: {
    active: number;
    byStatus: Record<SaleCampaignStatus, number>;
    total: number;
  };
};

export function saleCampaignLedgerFromPayload(payload: Record<string, unknown> | null | undefined): SaleCampaignLedger;
export function priorSaleRecheckUrlsForSource(
  ledger: SaleCampaignLedger | null | undefined,
  source: { id?: string; url?: string },
  limit?: number,
): string[];
export function saleCampaignIdFor(event: Record<string, unknown>): string;
export function hashSaleContent(event: Record<string, unknown>): string;
export function hashSaleEvidence(event: Record<string, unknown>): string;
export function sourceSaleObservationHealth(report: Record<string, unknown> | null | undefined): "success" | "unknown";
