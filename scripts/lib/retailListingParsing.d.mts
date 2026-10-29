export function decodeHtmlEntities(value: unknown): string;
export function parseRetailProductPrices(value: unknown): number[];
export function inferRetailArtist(value: unknown): string;
export function inferRetailTitle(value: unknown): string;
export function parseAcousticSoundsListingIdentity(value: unknown, source?: { sourceId?: string; sourceUrl?: string; id?: string; url?: string; baseUrl?: string }): { artist: string; title: string; retailEditionText: string; identityStatus: "resolved"; identitySource: "acoustic_sounds_listing" } | null;
