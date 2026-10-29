export type BrowserRetailObservation = Record<string, any> & {
  sourceId: string;
  url: string;
  title: string;
  visibleText: string;
  capturedAt: string;
  outcome: "available" | "not_found";
  links: Array<{ url: string; text: string }>;
};
export function browserObservationUrl(value: string): string;
export function browserProductEditionText(page: Record<string, any>): string | undefined;
export function browserProductRecordFormatSupported(format: unknown, visibleText: unknown): boolean;
export function validateBrowserRetailObservations(
  payload: unknown,
  sources: Array<Record<string, any>>,
  now?: string,
): BrowserRetailObservation[];
export function assessBrowserRetailObservations(
  payload: unknown, sources: Array<Record<string, any>>, now?: string,
): { pages: BrowserRetailObservation[]; diagnostics: Array<{ index: number; sourceId: string | null; reason: string; detail?: string }>; summary: { total: number; accepted: number; expired: number; rejected: number } };
export function browserObservationPage(page: BrowserRetailObservation): {
  html: string;
  url: string;
  status: number;
  setCookies: string[];
  observationMethod: string;
  observedAt: string;
  browserOutcome: string;
};
export function browserSourceDiagnostics(
  pages: Array<Record<string, any>>,
  sourceId: string,
): Record<string, any>;
export function browserProductCandidates(
  pages: BrowserRetailObservation[],
  source: Record<string, any>,
  stableId: (...args: string[]) => string,
): Array<Record<string, any>>;
export function preferObservedSkuCandidates(
  candidates: Array<Record<string, any>>,
): Array<Record<string, any>>;
