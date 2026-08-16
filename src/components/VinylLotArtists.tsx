import { type FormEvent, useMemo, useState } from "react";
import {
  createVinylLotArtistPreference,
  isDuplicateVinylLotArtist,
  loadVinylLotArtistPreferences,
  saveVinylLotArtistPreferences,
  VINYL_LOT_ARTIST_GENRES,
  VINYL_LOT_ARTIST_MODE_LABELS,
  vinylLotArtistGenreLabel,
  type VinylLotArtistPreference,
  type VinylLotArtistPreferenceMode,
} from "../lib/vinylLots/artistPreferences";
import type { VinylLotTargetGenre } from "../lib/vinylLots/types";

interface ArtistDraft {
  name: string;
  genre: VinylLotTargetGenre;
  mode: VinylLotArtistPreferenceMode;
}

const EMPTY_DRAFT: ArtistDraft = {
  genre: "classic-rock",
  mode: "priority",
  name: "",
};

export function VinylLotArtists() {
  const [artists, setArtists] = useState(loadVinylLotArtistPreferences);
  const [newArtist, setNewArtist] = useState<ArtistDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<VinylLotArtistPreference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Changes save automatically on this computer.");

  const enabledCount = useMemo(() => artists.filter((artist) => artist.enabled).length, [artists]);

  function persist(nextArtists: VinylLotArtistPreference[], message: string) {
    setArtists(nextArtists);
    const saved = saveVinylLotArtistPreferences(nextArtists);
    setStatus(saved ? message : "The change is active for this page, but this browser could not save it.");
  }

  function addArtist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newArtist.name.trim();
    if (!name) {
      setError("Enter an artist name.");
      return;
    }
    if (isDuplicateVinylLotArtist(artists, { genre: newArtist.genre, name })) {
      setError(`${name} is already in ${vinylLotArtistGenreLabel(newArtist.genre)}.`);
      return;
    }

    const added = createVinylLotArtistPreference({ ...newArtist, name });
    persist([...artists, added], `${added.name} was added and enabled.`);
    setNewArtist(EMPTY_DRAFT);
    setError(null);
  }

  function beginEditing(artist: VinylLotArtistPreference) {
    setEditing({ ...artist });
    setError(null);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setError("Enter an artist name before saving.");
      return;
    }
    if (isDuplicateVinylLotArtist(artists, { genre: editing.genre, name }, editing.id)) {
      setError(`${name} is already in ${vinylLotArtistGenreLabel(editing.genre)}.`);
      return;
    }

    const updated = { ...editing, name };
    persist(artists.map((artist) => artist.id === updated.id ? updated : artist), `${updated.name} was updated.`);
    setEditing(null);
    setError(null);
  }

  function toggleArtist(artist: VinylLotArtistPreference) {
    const enabled = !artist.enabled;
    persist(
      artists.map((candidate) => candidate.id === artist.id ? { ...candidate, enabled } : candidate),
      `${artist.name} is now ${enabled ? "enabled" : "paused"}.`,
    );
  }

  function updateMode(artist: VinylLotArtistPreference, mode: VinylLotArtistPreferenceMode) {
    persist(
      artists.map((candidate) => candidate.id === artist.id ? { ...candidate, mode } : candidate),
      `${artist.name} now uses ${VINYL_LOT_ARTIST_MODE_LABELS[mode].toLocaleLowerCase()}.`,
    );
  }

  function removeArtist(artist: VinylLotArtistPreference) {
    persist(artists.filter((candidate) => candidate.id !== artist.id), `${artist.name} was removed.`);
    if (editing?.id === artist.id) setEditing(null);
    setError(null);
  }

  return (
    <section className="vinyl-lot-page" aria-labelledby="vinyl-lot-artists-heading">
      <section className="vinyl-lot-hero">
        <div className="vinyl-lot-hero-copy">
          <span className="vinyl-lot-kicker">Editable discovery signals</span>
          <h2 id="vinyl-lot-artists-heading">Teach the lot scan which artists deserve attention.</h2>
          <p>
            Keep a local watchlist for hip-hop, classic rock, 1990s rock, and instrumental jazz. Enable the artists
            you want the scanner to recognize, and choose how strongly each name should affect the review queue.
          </p>
          <div className="vinyl-lot-controls" aria-live="polite">
            <span>{enabledCount} of {artists.length} artists enabled</span>
            <span>{status}</span>
          </div>
        </div>
        <div className="vinyl-lot-hero-mark" aria-hidden="true">
          <strong>{enabledCount}</strong>
          <small>enabled</small>
        </div>
      </section>

      <section className="vinyl-lot-notice" aria-label="Artist signal limits">
        <strong>Discovery signal, not a value guarantee.</strong>
        <span>An artist name can keep a plausible lot visible, but it does not establish condition, pressing, demand, or resale value.</span>
        <span>Singles, 7-inch records, and other excluded formats should still be screened separately.</span>
      </section>

      <section className="panel" aria-labelledby="add-vinyl-lot-artist-heading">
        <div className="lookup-heading">
          <h2 id="add-vinyl-lot-artist-heading">Add a priority artist</h2>
          <span>{artists.length} saved locally</span>
        </div>
        <form onSubmit={addArtist}>
          <div className="arbitrage-settings-grid">
            <label className="arbitrage-setting-row" htmlFor="new-vinyl-lot-artist-name">
              Artist name
              <input
                id="new-vinyl-lot-artist-name"
                maxLength={120}
                value={newArtist.name}
                onChange={(event) => setNewArtist({ ...newArtist, name: event.target.value })}
                placeholder="e.g. Miles Davis"
                required
              />
            </label>
            <label className="arbitrage-setting-row" htmlFor="new-vinyl-lot-artist-genre">
              Search lane
              <select
                id="new-vinyl-lot-artist-genre"
                value={newArtist.genre}
                onChange={(event) => setNewArtist({ ...newArtist, genre: event.target.value as VinylLotTargetGenre })}
              >
                {VINYL_LOT_ARTIST_GENRES.map((genre) => <option key={genre} value={genre}>{vinylLotArtistGenreLabel(genre)}</option>)}
              </select>
            </label>
            <label className="arbitrage-setting-row" htmlFor="new-vinyl-lot-artist-mode">
              Review behavior
              <select
                id="new-vinyl-lot-artist-mode"
                value={newArtist.mode}
                onChange={(event) => setNewArtist({ ...newArtist, mode: event.target.value as VinylLotArtistPreferenceMode })}
              >
                <ModeOptions />
              </select>
            </label>
            <button type="submit">Add artist</button>
          </div>
        </form>
        {error && !editing ? <p role="alert">{error}</p> : null}
      </section>

      {VINYL_LOT_ARTIST_GENRES.map((genre) => {
        const genreArtists = artists.filter((artist) => artist.genre === genre);
        const headingId = `vinyl-lot-artist-group-${genre}`;
        return (
          <section className="vinyl-lot-group" key={genre} aria-labelledby={headingId}>
            <header>
              <span>{genreArtists.filter((artist) => artist.enabled).length} enabled</span>
              <h3 id={headingId}>{vinylLotArtistGenreLabel(genre)}</h3>
              <p>{genreDescription(genre)}</p>
            </header>
            {genreArtists.length ? (
              <div className="arbitrage-profile-settings">
                {genreArtists.map((artist) => editing?.id === artist.id ? (
                  <ArtistEditForm
                    artist={editing}
                    error={error}
                    key={artist.id}
                    onCancel={() => {
                      setEditing(null);
                      setError(null);
                    }}
                    onChange={setEditing}
                    onSave={saveEdit}
                  />
                ) : (
                  <ArtistCard
                    artist={artist}
                    key={artist.id}
                    onEdit={() => beginEditing(artist)}
                    onModeChange={(mode) => updateMode(artist, mode)}
                    onRemove={() => removeArtist(artist)}
                    onToggle={() => toggleArtist(artist)}
                  />
                ))}
              </div>
            ) : (
              <section className="vinyl-lot-empty filtered">
                <h3>No artists in this lane yet.</h3>
                <p>Add one above whenever a name repeatedly leads you to useful collections.</p>
              </section>
            )}
          </section>
        );
      })}
    </section>
  );
}

function ArtistCard({
  artist,
  onEdit,
  onModeChange,
  onRemove,
  onToggle,
}: {
  artist: VinylLotArtistPreference;
  onEdit: () => void;
  onModeChange: (mode: VinylLotArtistPreferenceMode) => void;
  onRemove: () => void;
  onToggle: () => void;
}) {
  const headingId = `vinyl-lot-artist-${artist.id}`;
  return (
    <article className="arbitrage-profile-setting" aria-labelledby={headingId}>
      <div>
        <strong id={headingId}>{artist.name}</strong>
        <p>{modeDescription(artist.mode)}</p>
      </div>
      <div className="arbitrage-profile-setting-inputs">
        <label className="speed-toggle">
          <input
            type="checkbox"
            checked={artist.enabled}
            onChange={onToggle}
            aria-label={`${artist.enabled ? "Pause" : "Enable"} ${artist.name}`}
          />
          {artist.enabled ? "Enabled" : "Paused"}
        </label>
        <label className="arbitrage-setting-row" htmlFor={`vinyl-lot-artist-mode-${artist.id}`}>
          Review behavior
          <select
            id={`vinyl-lot-artist-mode-${artist.id}`}
            value={artist.mode}
            onChange={(event) => onModeChange(event.target.value as VinylLotArtistPreferenceMode)}
          >
            <ModeOptions />
          </select>
        </label>
      </div>
      <div className="vinyl-lot-controls">
        <button type="button" onClick={onEdit} aria-label={`Edit ${artist.name}`}>Edit</button>
        <button className="secondary-button" type="button" onClick={onRemove} aria-label={`Remove ${artist.name}`}>Remove</button>
      </div>
    </article>
  );
}

function ArtistEditForm({
  artist,
  error,
  onCancel,
  onChange,
  onSave,
}: {
  artist: VinylLotArtistPreference;
  error: string | null;
  onCancel: () => void;
  onChange: (artist: VinylLotArtistPreference) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const formHeadingId = `edit-vinyl-lot-artist-${artist.id}`;
  return (
    <form className="arbitrage-profile-setting" onSubmit={onSave} aria-labelledby={formHeadingId}>
      <div>
        <strong id={formHeadingId}>Edit {artist.name}</strong>
        <p>Changes take effect in this local watchlist as soon as you save.</p>
      </div>
      <div className="arbitrage-profile-setting-inputs">
        <label className="arbitrage-setting-row" htmlFor={`edit-vinyl-lot-artist-name-${artist.id}`}>
          Artist name
          <input
            id={`edit-vinyl-lot-artist-name-${artist.id}`}
            maxLength={120}
            value={artist.name}
            onChange={(event) => onChange({ ...artist, name: event.target.value })}
            required
          />
        </label>
        <label className="arbitrage-setting-row" htmlFor={`edit-vinyl-lot-artist-genre-${artist.id}`}>
          Search lane
          <select
            id={`edit-vinyl-lot-artist-genre-${artist.id}`}
            value={artist.genre}
            onChange={(event) => onChange({ ...artist, genre: event.target.value as VinylLotTargetGenre })}
          >
            {VINYL_LOT_ARTIST_GENRES.map((genre) => <option key={genre} value={genre}>{vinylLotArtistGenreLabel(genre)}</option>)}
          </select>
        </label>
        <label className="arbitrage-setting-row" htmlFor={`edit-vinyl-lot-artist-mode-${artist.id}`}>
          Review behavior
          <select
            id={`edit-vinyl-lot-artist-mode-${artist.id}`}
            value={artist.mode}
            onChange={(event) => onChange({ ...artist, mode: event.target.value as VinylLotArtistPreferenceMode })}
          >
            <ModeOptions />
          </select>
        </label>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="vinyl-lot-controls">
        <button type="submit">Save changes</button>
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ModeOptions() {
  return (
    <>
      <option value="priority">{VINYL_LOT_ARTIST_MODE_LABELS.priority}</option>
      <option value="always-review">{VINYL_LOT_ARTIST_MODE_LABELS["always-review"]}</option>
    </>
  );
}

function modeDescription(mode: VinylLotArtistPreferenceMode): string {
  if (mode === "always-review") {
    return "Keep a plausible multi-record lot in the review queue when this artist is named; format exclusions still apply.";
  }
  return "Treat this artist as a strong genre clue without overriding missing lot evidence or format exclusions.";
}

function genreDescription(genre: VinylLotTargetGenre): string {
  if (genre === "hip-hop") return "Rap and hip-hop names that can reveal mixed collections hidden behind generic lot titles.";
  if (genre === "classic-rock") return "Established rock names that sellers often mention as shorthand for a broader collection.";
  if (genre === "1990s-rock") return "Alternative, grunge, and related 1990s artists that can surface less obvious LP lots.";
  return "Instrumental jazz leaders and sidemen who can expose focused jazz collections.";
}
