import { defaultScoringSettings, type ScoringSettings } from "../scoring/types";

const STORAGE_KEY = "record-scanner-settings";

export function loadSettings(): ScoringSettings {
  if (typeof localStorage === "undefined") return defaultScoringSettings;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaultScoringSettings, ...JSON.parse(stored) } : defaultScoringSettings;
  } catch {
    return defaultScoringSettings;
  }
}

export function saveSettings(settings: ScoringSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
