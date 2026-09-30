export const RETAIL_PUBLICATION_ORIGIN: string;
export const RETAIL_UPLOAD_URL: string;
type PublicationEnvironment = { ARBITRAGE_UPLOAD_URL?: string; ARBITRAGE_UPLOAD_TOKEN?: string };
type PublicationOptions = {
  method?: string;
  body?: unknown;
  env?: PublicationEnvironment;
  fetchImpl?: typeof fetch;
};
export function publicationConfiguration(env?: PublicationEnvironment): { uploadUrl: string; token: string };
export function publicationRequest(path: string, options?: PublicationOptions): Promise<Response>;
export function publicationPreflight(options?: PublicationOptions): Promise<{
  status: "ready";
  destination: string;
  authentication: "automatic";
  writesPerformed: false;
}>;
