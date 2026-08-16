import {
  type VinylLotPriorityArtistInput,
  type VinylLotTargetGenre,
} from "./types";

export const VINYL_LOT_ALL_GENRES: readonly VinylLotTargetGenre[] = [
  "hip-hop",
  "classic-rock",
  "1990s-rock",
  "instrumental-jazz",
];

export const VINYL_LOT_COVERAGE_TARGET = 10;
export const VINYL_LOT_DEFAULT_RESULTS_PER_GENRE = 12;
export const VINYL_LOT_MAX_RESULTS_PER_GENRE = 25;
export const VINYL_LOT_RESULT_TTL_MS = 6 * 60 * 60 * 1_000;

export type VinylLotScanRequest = {
  customQueries?: Partial<Record<VinylLotTargetGenre, string>>;
  excludeSinglesAndFortyFives?: boolean;
  genres?: VinylLotTargetGenre[];
  includeUnknownCount?: boolean;
  minimumRecords?: number;
  priorityArtists?: VinylLotPriorityArtistInput[];
  resultsPerGenre?: number;
};

export type NormalizedVinylLotScanRequest = {
  customQueries: Partial<Record<VinylLotTargetGenre, string>>;
  excludeSinglesAndFortyFives: boolean;
  genres: VinylLotTargetGenre[];
  includeUnknownCount: boolean;
  minimumRecords: number;
  priorityArtists: VinylLotPriorityArtistInput[];
  resultsPerGenre: number;
};

export const DEFAULT_VINYL_LOT_SCAN_REQUEST: NormalizedVinylLotScanRequest = Object.freeze({
  customQueries: Object.freeze({}),
  excludeSinglesAndFortyFives: true,
  genres: [...VINYL_LOT_ALL_GENRES],
  includeUnknownCount: true,
  minimumRecords: 12,
  priorityArtists: [],
  resultsPerGenre: VINYL_LOT_DEFAULT_RESULTS_PER_GENRE,
});

export function normalizeVinylLotScanRequest(input: unknown): NormalizedVinylLotScanRequest {
  const source = isObject(input) ? input : {};
  const genres = normalizeGenres(source.genres);
  const minimumRecords = boundedInteger(source.minimumRecords, 12, 12, 100);
  const resultsPerGenre = boundedInteger(
    source.resultsPerGenre,
    VINYL_LOT_DEFAULT_RESULTS_PER_GENRE,
    VINYL_LOT_COVERAGE_TARGET,
    VINYL_LOT_MAX_RESULTS_PER_GENRE,
  );
  return {
    customQueries: normalizeCustomQueries(source.customQueries, genres),
    excludeSinglesAndFortyFives: source.excludeSinglesAndFortyFives !== false,
    genres,
    includeUnknownCount: source.includeUnknownCount !== false,
    minimumRecords,
    priorityArtists: normalizePriorityArtists(source.priorityArtists, genres),
    resultsPerGenre,
  };
}

function normalizeGenres(value: unknown): VinylLotTargetGenre[] {
  if (!Array.isArray(value)) return [...VINYL_LOT_ALL_GENRES];
  const genres = [...new Set(value.filter(isVinylLotGenre))];
  return genres.length > 0 ? genres : [...VINYL_LOT_ALL_GENRES];
}

function normalizeCustomQueries(
  value: unknown,
  genres: VinylLotTargetGenre[],
): Partial<Record<VinylLotTargetGenre, string>> {
  if (!isObject(value)) return {};
  return Object.fromEntries(genres.flatMap((genre) => {
    const query = cleanText(value[genre]).slice(0, 100);
    return query ? [[genre, query]] : [];
  })) as Partial<Record<VinylLotTargetGenre, string>>;
}

function normalizePriorityArtists(value: unknown, genres: VinylLotTargetGenre[]): VinylLotPriorityArtistInput[] {
  if (!Array.isArray(value)) return [];
  const selectedGenres = new Set(genres);
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!isObject(entry) || !isVinylLotGenre(entry.genre) || !selectedGenres.has(entry.genre)) return [];
    const name = cleanText(entry.name).slice(0, 80);
    const mode: VinylLotPriorityArtistInput["mode"] | null =
      entry.mode === "always-review" ? "always-review" : entry.mode === "priority" ? "priority" : null;
    if (!name || !mode) return [];
    const key = `${entry.genre}:${name.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ genre: entry.genre, mode, name }];
  }).slice(0, 100);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === "number" ? Math.floor(value) : Number.NaN;
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function isVinylLotGenre(value: unknown): value is VinylLotTargetGenre {
  return typeof value === "string" && (VINYL_LOT_ALL_GENRES as readonly string[]).includes(value);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
