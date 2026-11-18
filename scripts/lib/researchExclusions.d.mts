export function candidateIdentity(find: any): string;
type PriorExclusions = Map<string, { identity: string; observation: string }>;
export function recentUnpriceableOffers(previous: any, now: string | number | Date): PriorExclusions;
export function unchangedUnpriceableOffer(find: any, offers: PriorExclusions): boolean;
export function researchSelection(payload: any): {included: any[]; excluded: any[]; ids: Set<string>};
