import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSoldText } from "../lib/soldHistory/normalize.js";
import type { SoldHistoryIndex, SoldHistorySearchResult } from "../lib/soldHistory/types";

export const SOLD_HISTORY_INDEX_PATH = "exports/sold-history/sold-comps-index.json";

export type SoldHistoryResponse =
  | {
      index: SoldHistoryIndex;
      status: "available";
    }
  | {
      message: string;
      status: "empty";
    };

export function readSoldHistoryIndex(cwd: string): SoldHistoryResponse {
  const path = join(cwd, SOLD_HISTORY_INDEX_PATH);
  if (!existsSync(path)) {
    return {
      message: `No ${SOLD_HISTORY_INDEX_PATH} file exists yet.`,
      status: "empty",
    };
  }

  return {
    index: JSON.parse(readFileSync(path, "utf8")) as SoldHistoryIndex,
    status: "available",
  };
}

export function searchSoldHistory(cwd: string, query: string, limit = 10): SoldHistorySearchResult[] {
  const response = readSoldHistoryIndex(cwd);
  if (response.status === "empty") return [];

  const queryTokens = new Set(normalizeSoldText(query).split(" ").filter(Boolean));
  if (queryTokens.size === 0) return [];

  return response.index.comps
    .map((comp) => ({ comp, matchScore: scoreComp(comp.normalizedKey, queryTokens) }))
    .filter((result) => result.matchScore > 0)
    .sort((left, right) => right.matchScore - left.matchScore || right.comp.count - left.comp.count)
    .slice(0, limit);
}

function scoreComp(normalizedKey: string, queryTokens: Set<string>): number {
  const compTokens = new Set(normalizedKey.replace(/::/g, " ").split(/\s+/).filter(Boolean));
  let overlap = 0;

  for (const token of queryTokens) {
    if (compTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(queryTokens.size, compTokens.size);
}
