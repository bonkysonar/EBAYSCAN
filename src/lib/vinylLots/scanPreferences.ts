import {
  DEFAULT_VINYL_LOT_SCAN_REQUEST,
  normalizeVinylLotScanRequest,
  type VinylLotScanRequest,
} from "./scanOptions";
import type { VinylLotTargetGenre } from "./types";

export const VINYL_LOT_SCAN_PREFERENCES_KEY = "record-scanner-vinyl-lot-scan-options-v2";

export type VinylLotScanPreferences = {
  customQueries: Partial<Record<VinylLotTargetGenre, string>>;
  excludeSinglesAndFortyFives: boolean;
  genres: VinylLotTargetGenre[];
  includeUnknownCount: boolean;
  minimumRecords: number;
  resultsPerGenre: number;
};

export function loadVinylLotScanPreferences(storage: Storage | null = browserStorage()): VinylLotScanPreferences {
  if (!storage) return defaultPreferences();
  try {
    const raw = storage.getItem(VINYL_LOT_SCAN_PREFERENCES_KEY);
    if (!raw) return defaultPreferences();
    return preferencesFromRequest(normalizeVinylLotScanRequest(JSON.parse(raw) as unknown));
  } catch {
    return defaultPreferences();
  }
}

export function saveVinylLotScanPreferences(
  preferences: VinylLotScanPreferences,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VINYL_LOT_SCAN_PREFERENCES_KEY, JSON.stringify(preferencesFromRequest(normalizeVinylLotScanRequest(preferences))));
    return true;
  } catch {
    return false;
  }
}

export function scanRequestFromPreferences(preferences: VinylLotScanPreferences): VinylLotScanRequest {
  return preferencesFromRequest(normalizeVinylLotScanRequest(preferences));
}

function preferencesFromRequest(request: ReturnType<typeof normalizeVinylLotScanRequest>): VinylLotScanPreferences {
  return {
    customQueries: { ...request.customQueries },
    excludeSinglesAndFortyFives: request.excludeSinglesAndFortyFives,
    genres: [...request.genres],
    includeUnknownCount: request.includeUnknownCount,
    minimumRecords: request.minimumRecords,
    resultsPerGenre: request.resultsPerGenre,
  };
}

function defaultPreferences(): VinylLotScanPreferences {
  return preferencesFromRequest(DEFAULT_VINYL_LOT_SCAN_REQUEST);
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
