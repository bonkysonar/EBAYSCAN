import { randomUUID } from "node:crypto";

export function createRetailAttempt(now = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid attempt time");
  return { id: randomUUID(), startedAt: new Date(now).toISOString() };
}

// An invocation is newer work on an immutable data run, not a new capture.
export function retailAttemptStatus(context, attempt, state, funnel) {
  return { ...context, status: state, funnel,
    startedAt: attempt.startedAt, attemptId: attempt.id,
    workflowStartedAt: context.startedAt };
}
