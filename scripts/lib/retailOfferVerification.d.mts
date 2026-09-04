export function verifyRetailOffer<T>(
  find: T,
  fetchJson: (url: string) => Promise<any>,
  now?: string,
): Promise<T>;
export function verifyRetailOffers<T>(
  finds: T[],
  fetchJson: (url: string) => Promise<any>,
  options?: { concurrency?: number; now?: string },
): Promise<T[]>;
