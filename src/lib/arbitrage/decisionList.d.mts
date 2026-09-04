import type { ArbitrageFind } from "./types";
export function consideration(
  find: ArbitrageFind,
  now?: number,
): { qualifies: boolean; remainingChecks: string[] };
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
