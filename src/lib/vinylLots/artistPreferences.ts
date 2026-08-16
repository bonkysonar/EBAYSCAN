import { VINYL_LOT_GENRE_LABELS, type VinylLotTargetGenre } from "./types";

export type VinylLotArtistPreferenceMode = "always-review" | "priority";

export interface VinylLotArtistPreference {
  id: string;
  name: string;
  genre: VinylLotTargetGenre;
  mode: VinylLotArtistPreferenceMode;
  enabled: boolean;
}

export const VINYL_LOT_ARTIST_STORAGE_KEY = "record-scanner-vinyl-lot-artists-v1";
export const VINYL_LOT_ARTIST_PREFERENCES_CHANGED_EVENT = "vinyl-lot-artist-preferences-changed";

export const VINYL_LOT_ARTIST_GENRES: readonly VinylLotTargetGenre[] = [
  "hip-hop",
  "classic-rock",
  "1990s-rock",
  "instrumental-jazz",
];

export const VINYL_LOT_ARTIST_MODE_LABELS: Record<VinylLotArtistPreferenceMode, string> = {
  "always-review": "Always review",
  priority: "Priority signal",
};

const DEFAULT_ARTISTS_BY_GENRE: Record<VinylLotTargetGenre, readonly [string, VinylLotArtistPreferenceMode][]> = {
  "hip-hop": [
    ["2Pac", "always-review"],
    ["The Notorious B.I.G.", "always-review"],
    ["Nas", "always-review"],
    ["Wu-Tang Clan", "always-review"],
    ["A Tribe Called Quest", "priority"],
    ["De La Soul", "priority"],
    ["Outkast", "priority"],
    ["MF DOOM", "always-review"],
    ["Public Enemy", "priority"],
    ["Dr. Dre", "priority"],
    ["Jay-Z", "priority"],
    ["Beastie Boys", "priority"],
  ],
  "classic-rock": [
    ["The Beatles", "always-review"],
    ["Pink Floyd", "always-review"],
    ["Led Zeppelin", "always-review"],
    ["David Bowie", "always-review"],
    ["Black Sabbath", "always-review"],
    ["Queen", "priority"],
    ["Jimi Hendrix", "priority"],
    ["The Doors", "priority"],
    ["Fleetwood Mac", "priority"],
    ["The Rolling Stones", "priority"],
    ["Grateful Dead", "always-review"],
    ["Rush", "priority"],
  ],
  "1990s-rock": [
    ["Nirvana", "always-review"],
    ["Pearl Jam", "always-review"],
    ["Alice in Chains", "always-review"],
    ["Soundgarden", "priority"],
    ["The Smashing Pumpkins", "priority"],
    ["Radiohead", "always-review"],
    ["Weezer", "always-review"],
    ["Tool", "always-review"],
    ["Oasis", "priority"],
    ["Nine Inch Nails", "priority"],
    ["Rage Against the Machine", "priority"],
    ["Beck", "priority"],
  ],
  "instrumental-jazz": [
    ["Miles Davis", "always-review"],
    ["John Coltrane", "always-review"],
    ["Thelonious Monk", "always-review"],
    ["Charles Mingus", "always-review"],
    ["Art Blakey", "priority"],
    ["Herbie Hancock", "priority"],
    ["Wayne Shorter", "priority"],
    ["Sonny Rollins", "priority"],
    ["Bill Evans", "priority"],
    ["Lee Morgan", "always-review"],
    ["Hank Mobley", "always-review"],
    ["Grant Green", "priority"],
  ],
};

export const DEFAULT_VINYL_LOT_ARTIST_PREFERENCES: readonly VinylLotArtistPreference[] =
  VINYL_LOT_ARTIST_GENRES.flatMap((genre) =>
    DEFAULT_ARTISTS_BY_GENRE[genre].map(([name, mode]) => ({
      enabled: true,
      genre,
      id: `${genre}-${slugify(name)}`,
      mode,
      name,
    })),
  );

interface StoredArtistPreferences {
  schemaVersion: 1;
  artists: VinylLotArtistPreference[];
}

export function loadVinylLotArtistPreferences(storage: Storage | null = getBrowserStorage()): VinylLotArtistPreference[] {
  if (!storage) return cloneDefaultArtists();

  try {
    const stored = storage.getItem(VINYL_LOT_ARTIST_STORAGE_KEY);
    if (!stored) return cloneDefaultArtists();

    const parsed = JSON.parse(stored) as unknown;
    const rawArtists = readStoredArtists(parsed);
    if (!rawArtists) return cloneDefaultArtists();

    const artists = rawArtists
      .map((artist, index) => normalizeArtistPreference(artist, index))
      .filter((artist): artist is VinylLotArtistPreference => artist !== null);
    return deduplicateArtists(artists);
  } catch {
    return cloneDefaultArtists();
  }
}

export function saveVinylLotArtistPreferences(
  artists: readonly VinylLotArtistPreference[],
  storage: Storage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;

  try {
    const payload: StoredArtistPreferences = {
      artists: artists.map((artist) => ({ ...artist })),
      schemaVersion: 1,
    };
    storage.setItem(VINYL_LOT_ARTIST_STORAGE_KEY, JSON.stringify(payload));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(VINYL_LOT_ARTIST_PREFERENCES_CHANGED_EVENT, { detail: payload.artists }));
    }
    return true;
  } catch {
    return false;
  }
}

export function createVinylLotArtistPreference(input: {
  name: string;
  genre: VinylLotTargetGenre;
  mode: VinylLotArtistPreferenceMode;
  enabled?: boolean;
}): VinylLotArtistPreference {
  const name = normalizeName(input.name);
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    enabled: input.enabled ?? true,
    genre: input.genre,
    id: `${input.genre}-${slugify(name)}-${suffix}`,
    mode: input.mode,
    name,
  };
}

export function isDuplicateVinylLotArtist(
  artists: readonly VinylLotArtistPreference[],
  candidate: Pick<VinylLotArtistPreference, "genre" | "name">,
  excludingId?: string,
): boolean {
  const normalizedCandidate = normalizeName(candidate.name).toLocaleLowerCase();
  return artists.some((artist) =>
    artist.id !== excludingId
    && artist.genre === candidate.genre
    && normalizeName(artist.name).toLocaleLowerCase() === normalizedCandidate);
}

export function enabledVinylLotArtistPreferences(
  artists: readonly VinylLotArtistPreference[],
): VinylLotArtistPreference[] {
  return artists.filter((artist) => artist.enabled).map((artist) => ({ ...artist }));
}

export function vinylLotArtistGenreLabel(genre: VinylLotTargetGenre): string {
  return VINYL_LOT_GENRE_LABELS[genre];
}

function readStoredArtists(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.artists)) return null;
  return value.artists;
}

function normalizeArtistPreference(value: unknown, index: number): VinylLotArtistPreference | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  if (!isTargetGenre(value.genre) || !isPreferenceMode(value.mode)) return null;
  const name = normalizeName(value.name);
  if (!name) return null;
  const storedId = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    genre: value.genre,
    id: storedId || `${value.genre}-${slugify(name)}-${index}`,
    mode: value.mode,
    name,
  };
}

function deduplicateArtists(artists: readonly VinylLotArtistPreference[]): VinylLotArtistPreference[] {
  const identities = new Set<string>();
  const ids = new Set<string>();
  return artists.filter((artist) => {
    const identity = `${artist.genre}:${artist.name.toLocaleLowerCase()}`;
    if (identities.has(identity) || ids.has(artist.id)) return false;
    identities.add(identity);
    ids.add(artist.id);
    return true;
  });
}

function cloneDefaultArtists(): VinylLotArtistPreference[] {
  return DEFAULT_VINYL_LOT_ARTIST_PREFERENCES.map((artist) => ({ ...artist }));
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 120);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "artist";
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isTargetGenre(value: unknown): value is VinylLotTargetGenre {
  return typeof value === "string" && (VINYL_LOT_ARTIST_GENRES as readonly string[]).includes(value);
}

function isPreferenceMode(value: unknown): value is VinylLotArtistPreferenceMode {
  return value === "always-review" || value === "priority";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
