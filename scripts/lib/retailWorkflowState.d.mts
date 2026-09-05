export type ResearchProgress = {
  planned: number;
  completed: number;
  validated: number;
  noRows: number;
  failed: number;
  pending: number;
  researchedRows: number;
  limit: number;
  outsidePlan: number;
  complete: boolean;
  status: "not_needed" | "complete" | "incomplete";
};
export function admittedSourceIds(payload: { sourceReports?: Array<Record<string, unknown>> }): string[];
export function researchProgress(draft: any, checkpoint?: any, now?: Date): ResearchProgress;
export function browserRecoveryScan(input: { observations: any; observationsPath: string; previousScan: any; previousScanPath: string; now?: Date | number | string }): { mode: "refresh"; previousRunId: string; sourceIds: string[]; scanArgs: string[] };
export function scannerOutputPath(stdout: string): string;
export function freshWorkflowDraftSummary(draft: any, context: { startedAt: string; previousRunId?: string }): { runId: string; sourceCount: number };
