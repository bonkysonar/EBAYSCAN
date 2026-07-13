import { defaultArbitrageSettings } from "./rules";
import type { ArbitrageFind, ArbitrageSettings } from "./types";

const FINDS_STORAGE_KEY = "record-scanner-arbitrage-finds-v1";
const SETTINGS_STORAGE_KEY = "record-scanner-arbitrage-settings-v1";

export function loadArbitrageFinds(): ArbitrageFind[] {
  try {
    const raw = localStorage.getItem(FINDS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ArbitrageFind[]) : [];
  } catch {
    return [];
  }
}

export function saveArbitrageFinds(finds: ArbitrageFind[]) {
  try {
    localStorage.setItem(FINDS_STORAGE_KEY, JSON.stringify(finds));
  } catch {
    // Keep in-memory state if browser storage is unavailable.
  }
}

export function loadArbitrageSettings(): ArbitrageSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? { ...defaultArbitrageSettings, ...(JSON.parse(raw) as Partial<ArbitrageSettings>) } : defaultArbitrageSettings;
  } catch {
    return defaultArbitrageSettings;
  }
}

export function saveArbitrageSettings(settings: ArbitrageSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep in-memory state if browser storage is unavailable.
  }
}
