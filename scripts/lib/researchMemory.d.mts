import type { ArbitrageFind } from "../../src/lib/arbitrage/types";
type MemoryEntry = {
  observation: string;
  status: "no_rows";
  checkedAt: string;
};
export function deferredResearch(
  find: ArbitrageFind,
  memory?: Record<string, MemoryEntry>,
  now?: number,
): MemoryEntry | null;
export function rememberResearch(
  finds: ArbitrageFind[],
  memory?: Record<string, MemoryEntry>,
  now?: number,
): Record<string, MemoryEntry>;
