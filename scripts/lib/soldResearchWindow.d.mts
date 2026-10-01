export function verifiedWindowSales(rows: Array<Record<string, unknown>>, run: Record<string, unknown>, now?: Date): Record<string, unknown> | null;
export function verifiedResearchFilters(run: Record<string, any>, url: URL): boolean;
export function verifiedResearchWindow(run: Record<string, any>, now?: Date, allowedPeriods?: number[]): {start: number; end: number; duration: number; observedWindow: {startDate: string; endDate: string}} | null;
export function mergeResearchSoldEvidence(existing: Record<string, unknown> | null | undefined, research: Record<string, unknown>, capturedAt: string): Record<string, unknown>;
