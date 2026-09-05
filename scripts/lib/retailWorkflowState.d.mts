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
