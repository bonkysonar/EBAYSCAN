export const VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY = "record-scanner-vinyl-lot-scan-access-v1";

const MIN_ACCESS_KEY_LENGTH = 8;
const MAX_ACCESS_KEY_LENGTH = 256;

export function loadVinylLotScanAccessKey(storage: Storage | null = browserStorage()): string {
  if (!storage) return "";
  try {
    return normalizeAccessKey(storage.getItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function saveVinylLotScanAccessKey(
  accessKey: string,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const normalized = normalizeAccessKey(accessKey);
  if (!normalized) return false;
  try {
    storage.setItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function clearVinylLotScanAccessKey(storage: Storage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(VINYL_LOT_SCAN_ACCESS_KEY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function normalizeAccessKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (normalized.length < MIN_ACCESS_KEY_LENGTH || normalized.length > MAX_ACCESS_KEY_LENGTH) return "";
  return normalized;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
