import type { ScoringSettings } from "../scoring/types";
import { defaultScoringSettings } from "../scoring/types";

const STORAGE_KEY = "record-scanner-settings";

type StoredSettings = Partial<ScoringSettings> & {
  minimumResultsForGreen?: number;
  minimumConfidenceForGreen?: number;
};

export function loadSettings(): ScoringSettings {
  if (typeof localStorage === "undefined") return defaultScoringSettings;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultScoringSettings;

    const parsed = JSON.parse(stored) as StoredSettings;
    return {
      ...defaultScoringSettings,
      ...parsed,
      minimumResultsForSkip: parsed.minimumResultsForSkip ?? parsed.minimumResultsForGreen ?? defaultScoringSettings.minimumResultsForSkip,
      minimumConfidenceForSkip:
        parsed.minimumConfidenceForSkip ?? parsed.minimumConfidenceForGreen ?? defaultScoringSettings.minimumConfidenceForSkip,
    };
  } catch {
    return defaultScoringSettings;
  }
}

export function saveSettings(settings: ScoringSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
