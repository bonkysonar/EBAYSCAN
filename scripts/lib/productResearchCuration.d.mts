export type ResearchPlanEntry = {
  artist: string;
  capturedAt: string;
  findId: string;
  sourceId: string;
  sourceListingTitle?: string;
  title: string;
  variants: Array<{ query: string; url: string }>;
};

export function buildProductResearchPlan(
  finds: Array<Record<string, unknown>>,
  options?: { maxEntries?: number },
): ResearchPlanEntry[];
export function buildProductResearchUrl(query: string): string;
export function curateResearchForFind(
  find: Record<string, unknown>,
  rawResearch: unknown,
  now?: Date,
): Record<string, unknown>;
export function parseProductResearchRow(row: unknown): Record<string, unknown>;
export function productResearchRowMatchScore(find: Record<string, unknown>, rowTitle: string): number;
export function researchVariants(find: Record<string, unknown>): string[];
