export type PoliteFetchOptions = {
  baseRetryDelayMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<any>;
  maxConcurrency?: number;
  maxPerHost?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  minHostDelayMs?: number;
  requestTimeoutMs?: number;
  retryStatuses?: Set<number>;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function createPoliteFetcher(
  options?: PoliteFetchOptions,
): (url: string, init?: RequestInit) => Promise<any>;
