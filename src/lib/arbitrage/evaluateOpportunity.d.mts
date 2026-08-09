import type {
  ArbitrageCostInputs,
  ArbitrageCostLedger,
  ArbitrageCandidateTier,
  ArbitrageFind,
  ArbitrageScoredFind,
  ArbitrageSettings,
} from "./types";

export const EVALUATION_VERSION: number;
export const defaultArbitrageSettings: ArbitrageSettings;

export function buildCostLedger(
  purchasePrice: number,
  expectedResalePrice: number | null,
  costs?: ArbitrageCostInputs,
  settings?: Partial<ArbitrageSettings>,
): ArbitrageCostLedger;

export function evaluateOpportunity(
  find: ArbitrageFind,
  settings?: Partial<ArbitrageSettings>,
  now?: Date | string | number,
): ArbitrageScoredFind;

export function assessCandidateOpportunity(find: Partial<ArbitrageScoredFind> & ArbitrageFind): {
  candidateReasons: string[];
  candidateScore: number;
  candidateTier: ArbitrageCandidateTier;
};

export function candidateTierRank(value: ArbitrageCandidateTier | null | undefined): number;
