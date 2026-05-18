import type { ScoringSettings } from "../lib/scoring/types";

type Props = {
  settings: ScoringSettings;
  onChange: (settings: ScoringSettings) => void;
};

export function SettingsPanel({ settings, onChange }: Props) {
  function updateNumber(key: keyof ScoringSettings, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    onChange({ ...settings, [key]: parsed });
  }

  return (
    <section className="settings-panel">
      <h2>Settings</h2>
      <label>
        Threshold ($)
        <input type="number" min="0" step="0.5" value={settings.threshold} onChange={(event) => updateNumber("threshold", event.target.value)} />
      </label>
      <label>
        Min results for RED skip
        <input type="number" min="1" step="1" value={settings.minimumResultsForSkip} onChange={(event) => updateNumber("minimumResultsForSkip", event.target.value)} />
      </label>
      <label>
        Min RED skip confidence
        <input type="number" min="0" max="1" step="0.05" value={settings.minimumConfidenceForSkip} onChange={(event) => updateNumber("minimumConfidenceForSkip", event.target.value)} />
      </label>
    </section>
  );
}
