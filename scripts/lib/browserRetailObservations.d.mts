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
export function validateBrowserRetailObservations(
  payload: unknown,
  sources: Array<Record<string, any>>,
  now?: string,
): BrowserRetailObservation[];
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
