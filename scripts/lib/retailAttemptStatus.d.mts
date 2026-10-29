export interface RetailAttempt { id: string; startedAt: string }
export function createRetailAttempt(now?: string): RetailAttempt;
export function retailAttemptStatus<T extends { startedAt: string }>(
  context: T, attempt: RetailAttempt, state: string, funnel?: unknown
): T & { status: string; funnel: unknown; startedAt: string; attemptId: string; workflowStartedAt: string };
