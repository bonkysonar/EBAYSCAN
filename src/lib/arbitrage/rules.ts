import {
  defaultArbitrageSettings as sharedDefaultArbitrageSettings,
  evaluateOpportunity as evaluateSharedOpportunity,
} from "./evaluateOpportunity.mjs";
import type { ArbitrageFind, ArbitrageScoredFind, ArbitrageSettings } from "./types";

export const defaultArbitrageSettings: ArbitrageSettings = sharedDefaultArbitrageSettings;

export function evaluateOpportunity(
  find: ArbitrageFind,
  settings: Partial<ArbitrageSettings> = defaultArbitrageSettings,
  now: Date | string | number = new Date(),
): ArbitrageScoredFind {
  return evaluateSharedOpportunity(find, settings, now);
}

/** @deprecated Use evaluateOpportunity. Retained so existing UI imports share the canonical evaluator. */
export function scoreArbitrageFind(
  find: ArbitrageFind,
  settings: ArbitrageSettings,
  now: Date | string | number = new Date(),
): ArbitrageScoredFind {
  return evaluateOpportunity(find, settings, now);
}
