import type {
  ArbitrageCostInputs,
  ArbitrageCostLedger,
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
