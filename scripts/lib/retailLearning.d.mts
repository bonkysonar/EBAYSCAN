import type { ArbitrageFind } from "../../src/lib/arbitrage/types";
export const REVIEW_OUTCOMES: string[];
export function learningIdentity(find: ArbitrageFind): {
  key: string;
  observation: string;
};
export function applyRetailLearning<T extends ArbitrageFind>(
  finds: T[],
  entries?: Array<{
    key: string;
    observation: string;
    updatedAt: string;
    outcome: string;
  }>,
  now?: number,
): T[];
