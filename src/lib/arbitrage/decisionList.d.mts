import type { ArbitrageFind } from "./types";
export function consideration(
  find: ArbitrageFind,
  now?: number,
): { qualifies: boolean; remainingChecks: string[]; exclusionReason?: string };
export const decisionListBlockerLabels: Record<string, string>;
export function decisionListDiagnostics(finds: ArbitrageFind[], now?: number): {
  products: number; qualified: number; blockers: Record<string, number>;
};
export function releaseGroupKey(find: ArbitrageFind): string;
export function selectDecisionList<T extends ArbitrageFind>(
  finds: T[],
  options?: { limit?: number; now?: number },
): T[];
export function scannerFunnel(
  finds: ArbitrageFind[],
  reports?: Array<Record<string, unknown>>,
  now?: number,
): Record<string, unknown>;
