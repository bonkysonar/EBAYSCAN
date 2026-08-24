import { useEffect, useMemo, useState } from "react";
import type { VinylLotDiscoveryResult, VinylLotListingObservation } from "../server/vinylLotDiscoveryApi";
import {
  enabledVinylLotArtistPreferences,
  loadVinylLotArtistPreferences,
  VINYL_LOT_ARTIST_PREFERENCES_CHANGED_EVENT,
} from "../lib/vinylLots/artistPreferences";
import {
  VINYL_LOT_FEEDBACK_REASON_LABELS,
  type VinylLotFeedbackReasonTag,
  type VinylLotFeedbackSaveResult,
  type VinylLotFeedbackSubmission,
} from "../lib/vinylLots/feedback";
import {
  submitVinylLotFeedback,
  usesBrowserLocalVinylLotFeedback,
} from "../lib/vinylLots/browserFeedback";
import {
  loadVinylLotScanPreferences,
  saveVinylLotScanPreferences,
  scanRequestFromPreferences,
  type VinylLotScanPreferences,
} from "../lib/vinylLots/scanPreferences";
import {
  clearVinylLotScanAccessKey,
  loadVinylLotScanAccessKey,
  saveVinylLotScanAccessKey,
} from "../lib/vinylLots/scanAccess";
import { VINYL_LOT_COVERAGE_TARGET, VINYL_LOT_RESULT_TTL_MS } from "../lib/vinylLots/scanOptions";
import { VINYL_LOT_GENRE_LABELS, type VinylLotTargetGenre } from "../lib/vinylLots/types";
import { readJsonResponse } from "../lib/http/jsonResponse";

type GenreFilter = "all" | VinylLotTargetGenre;

type ListingFeedbackDraft = {
  note: string;
  reasonTag: VinylLotFeedbackReasonTag | "";
  score: number | null;
};

const EMPTY_LISTING_FEEDBACK: ListingFeedbackDraft = { note: "", reasonTag: "", score: null };

export function VinylLotFinder() {
  const browserLocalFeedback = usesBrowserLocalVinylLotFeedback(globalThis.location?.hostname ?? "");
  const [accessKey, setAccessKey] = useState(loadVinylLotScanAccessKey);
  const [accessPanelOpen, setAccessPanelOpen] = useState(() => browserLocalFeedback && !accessKey);
  const [artistRevision, setArtistRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, ListingFeedbackDraft>>({});
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSave, setFeedbackSave] = useState<VinylLotFeedbackSaveResult | null>(null);
  const [filter, setFilter] = useState<GenreFilter>("all");
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [options, setOptions] = useState<VinylLotScanPreferences>(loadVinylLotScanPreferences);
  const [overallNote, setOverallNote] = useState("");
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [rememberAccessKey, setRememberAccessKey] = useState(() => Boolean(accessKey));
  const [scan, setScan] = useState<VinylLotDiscoveryResult | null>(null);
  const scanExpiresAt = scan?.expiresAt ?? null;

  useEffect(() => {
    saveVinylLotScanPreferences(options);
  }, [options]);

  useEffect(() => {
    const refreshArtists = () => setArtistRevision((revision) => revision + 1);
    window.addEventListener(VINYL_LOT_ARTIST_PREFERENCES_CHANGED_EVENT, refreshArtists);
    return () => window.removeEventListener(VINYL_LOT_ARTIST_PREFERENCES_CHANGED_EVENT, refreshArtists);
  }, []);

  useEffect(() => {
    if (!scanExpiresAt) return;
    const remainingMs = Date.parse(scanExpiresAt) - Date.now();
    const expireScan = () => {
      setScan(null);
      setFilter("all");
      setFeedbackDrafts({});
      setFeedbackSave(null);
      setOverallNote("");
      setOverallScore(null);
      setError("The previous eBay results expired after six hours. Run a fresh scan to continue reviewing.");
    };
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      expireScan();
      return;
    }
    const timeout = window.setTimeout(expireScan, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [scanExpiresAt]);

  const priorityArtists = useMemo(
    () => enabledVinylLotArtistPreferences(loadVinylLotArtistPreferences()),
    [artistRevision],
  );
  const visibleListings = useMemo(
    () => (scan?.listings ?? []).filter((listing) => listingMatchesFilter(listing, filter)),
    [filter, scan],
  );
  const qualifying = visibleListings.filter((listing) => listing.classification.status === "qualifying");
  const nearMatches = visibleListings.filter((listing) => listing.classification.status === "near-match");
  const needsReview = visibleListings.filter((listing) => listing.classification.status === "review");
  const ratedListingCount = scan?.listings.filter((listing) => feedbackComplete(feedbackDrafts[listing.itemId])).length ?? 0;
  const feedbackReady = Boolean(
    scan?.listings.length
    && ratedListingCount === scan.listings.length
    && overallScore
    && overallNote.trim().length >= 3,
  );

  async function runScan() {
    const normalizedAccessKey = accessKey.trim();
    if (browserLocalFeedback && !normalizedAccessKey) {
      setAccessPanelOpen(true);
      setError("Enter the hosted scan access key, then try again.");
      return;
    }
    setIsScanning(true);
    setError(null);
    setFeedbackError(null);
    setFeedbackSave(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (normalizedAccessKey) headers.Authorization = `Bearer ${normalizedAccessKey}`;
      const scanRequest = {
        ...scanRequestFromPreferences(options),
        priorityArtists: priorityArtists.map(({ genre, mode, name }) => ({ genre, mode, name })),
      };
      const response = await fetch("/api/vinyl-lots/scan", {
        body: JSON.stringify(scanRequest),
        headers,
        method: "POST",
      });
      const payload = await readJsonResponse<VinylLotDiscoveryResult & { error?: string }>(response, "Vinyl lot scan");
      if (!response.ok) {
        if (response.status === 401) {
          clearVinylLotScanAccessKey();
          setAccessKey("");
          setRememberAccessKey(false);
          setAccessPanelOpen(true);
          throw new Error("The hosted scan access key was rejected. Enter the current key and try again.");
        }
        throw new Error(payload.error ?? "The vinyl lot scan failed.");
      }
      assertDisplayableVinylLotScan(payload);
      if (browserLocalFeedback && normalizedAccessKey) {
        if (rememberAccessKey) saveVinylLotScanAccessKey(normalizedAccessKey);
        else clearVinylLotScanAccessKey();
      }
      setScan(payload);
      setFilter("all");
      setFeedbackDrafts({});
      setOverallNote("");
      setOverallScore(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The vinyl lot scan failed.");
    } finally {
      setIsScanning(false);
    }
  }

  async function saveFeedback() {
    if (!scan || !feedbackReady) return;
    setIsSavingFeedback(true);
    setFeedbackError(null);
    setFeedbackSave(null);
    try {
      const submission = buildFeedbackSubmission(scan, feedbackDrafts, overallScore as number, overallNote);
      const payload = await submitVinylLotFeedback(submission, {
        fetcher: fetch,
        hostname: globalThis.location?.hostname ?? "",
      });
      setFeedbackSave(payload);
      await copyText(payload.codexPrompt);
      window.open(payload.codexUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setFeedbackError(caught instanceof Error ? caught.message : "The feedback could not be saved.");
    } finally {
      setIsSavingFeedback(false);
    }
  }

  function updateOptions(next: Partial<VinylLotScanPreferences>) {
    setOptions((current) => ({ ...current, ...next }));
  }

  function toggleGenre(genre: VinylLotTargetGenre) {
    setOptions((current) => {
      const selected = current.genres.includes(genre);
      if (selected && current.genres.length === 1) return current;
      return {
        ...current,
        genres: selected ? current.genres.filter((candidate) => candidate !== genre) : [...current.genres, genre],
      };
    });
  }

  function updateListingFeedback(itemId: string, draft: ListingFeedbackDraft) {
    setFeedbackDrafts((current) => ({ ...current, [itemId]: draft }));
    setFeedbackSave(null);
  }

  return (
    <section className="vinyl-lot-page" aria-labelledby="vinyl-lot-heading">
      <section className="vinyl-lot-hero">
        <div className="vinyl-lot-hero-copy">
          <span className="vinyl-lot-kicker">Fresh eBay collection discovery</span>
          <h2 id="vinyl-lot-heading">Find broad record collections, not just lots labeled "20."</h2>
          <p>
            Each genre starts with broad collection searches. If fewer than {VINYL_LOT_COVERAGE_TARGET} plausible lots survive,
            the scan expands with a fallback and enabled artist searches before it reports a coverage shortfall.
          </p>
          <div className="vinyl-lot-controls">
            <button type="button" onClick={runScan} disabled={isScanning}>
              {isScanning ? "Scanning and checking coverage..." : scan ? "Scan again" : "Scan now"}
            </button>
            {scan ? <span>Observed {formatDateTime(scan.observedAt)}</span> : <span>Defaults to 12+ records and keeps unknown-count collections for review.</span>}
          </div>
        </div>
        <div className="vinyl-lot-hero-mark" aria-hidden="true">
          <span className="vinyl-lot-record-groove" />
          <strong>{VINYL_LOT_COVERAGE_TARGET}</strong>
          <small>minimum per lane</small>
        </div>
      </section>

      <section className="vinyl-lot-notice" aria-label="Evidence limits">
        <strong>Review queue, not a valuation.</strong>
        <span>Active eBay listings only. No sold-comparable data or custom price ranking is included.</span>
        <span>{scan ? `This view expires ${formatDateTime(scan.expiresAt)}.` : "Every result expires within six hours."}</span>
      </section>

      <ScanOptions
        artistCount={priorityArtists.length}
        options={options}
        onChange={updateOptions}
        onToggleGenre={toggleGenre}
      />

      <details
        className="vinyl-lot-access"
        open={accessPanelOpen}
        onToggle={(event) => setAccessPanelOpen(event.currentTarget.open)}
      >
        <summary>Hosted scan access</summary>
        <label htmlFor="vinyl-lot-access-key">
          Scan access key
          <input
            id="vinyl-lot-access-key"
            type="password"
            autoComplete="off"
            value={accessKey}
            onChange={(event) => {
              setAccessKey(event.target.value);
              if (error?.toLowerCase().includes("access key")) setError(null);
            }}
            placeholder="Only needed on the hosted app"
          />
        </label>
        <label className="vinyl-lot-access-remember">
          <input
            id="vinyl-lot-remember-access-key"
            type="checkbox"
            checked={rememberAccessKey}
            onChange={(event) => {
              setRememberAccessKey(event.target.checked);
              if (!event.target.checked) clearVinylLotScanAccessKey();
            }}
          />
          Remember this key on this device after a successful scan
        </label>
        <div className="vinyl-lot-access-actions">
          <p>
            The key is sent only when you scan. Remembering it stores the key in this browser, so use that option only on a private computer.
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              clearVinylLotScanAccessKey();
              setAccessKey("");
              setRememberAccessKey(false);
              setError(null);
            }}
          >
            Forget saved key
          </button>
        </div>
      </details>

      {error ? (
        <section className="vinyl-lot-error" role="alert">
          <strong>Scan could not finish.</strong>
          <span>{error}</span>
          <button type="button" onClick={runScan}>Try again</button>
        </section>
      ) : null}

      {isScanning ? (
        <section className="vinyl-lot-loading" aria-live="polite">
          <span className="vinyl-lot-loading-disc" aria-hidden="true" />
          <div>
            <strong>Finding collections and checking every lane</strong>
            <p>Singles and 45s are removed after eBay returns the broadest useful candidate set.</p>
          </div>
        </section>
      ) : null}

      {!scan && !isScanning && !error ? (
        <section className="vinyl-lot-empty">
          <span>Ready when you are</span>
          <h3>Start a configurable collection scan.</h3>
          <p>Stated 12+ record lots lead the page. Plausible collections with no count remain visible for human review.</p>
        </section>
      ) : null}

      {scan && !isScanning ? (
        <>
          <section className="vinyl-lot-summary" aria-label="Scan summary">
            <SummaryStat label={`${scan.scanOptions.minimumRecords}+ record leads`} value={scan.diagnostics.classificationCounts.qualifying} tone="lead" />
            <SummaryStat label="Smaller review floor" value={scan.diagnostics.classificationCounts["near-match"]} tone="near" />
            <SummaryStat label="Needs evidence" value={scan.diagnostics.classificationCounts.review} tone="review" />
            <SummaryStat label="Singles / noise removed" value={scan.diagnostics.classificationCounts.rejected} tone="muted" />
          </section>

          <CoveragePanel scan={scan} />

          <div className="vinyl-lot-filter-bar" aria-label="Filter lot results">
            {(["all", ...scan.scanOptions.genres] as GenreFilter[]).map((genre) => (
              <button
                className={filter === genre ? "active" : ""}
                key={genre}
                type="button"
                aria-pressed={filter === genre}
                onClick={() => setFilter(genre)}
              >
                {genre === "all" ? "All lanes" : VINYL_LOT_GENRE_LABELS[genre]}
              </button>
            ))}
          </div>

          <LotGroup
            className="qualifying"
            description={`Stated at ${scan.scanOptions.minimumRecords}+ records with target-genre evidence. Condition still requires inspection.`}
            feedbackDrafts={feedbackDrafts}
            listings={qualifying}
            onFeedbackChange={updateListingFeedback}
            title="Review first"
          />
          <LotGroup
            className="near-match"
            description="At least 12 records, retained below a higher custom size target because the genre evidence is relevant."
            feedbackDrafts={feedbackDrafts}
            listings={nearMatches}
            onFeedbackChange={updateListingFeedback}
            title="Smaller near-matches"
          />
          <LotGroup
            className="needs-review"
            description="Plausible multi-record collections with a missing count, unclear genre, or unsupported condition."
            feedbackDrafts={feedbackDrafts}
            listings={needsReview}
            onFeedbackChange={updateListingFeedback}
            title="Needs more evidence"
          />

          {visibleListings.length === 0 ? (
            <section className="vinyl-lot-empty filtered">
              <h3>No retained collections are in this lane.</h3>
              <p>The coverage panel above shows whether the search itself fell short.</p>
            </section>
          ) : null}

          {scan.listings.length > 0 ? (
            <ScanFeedbackPanel
              browserLocalFeedback={browserLocalFeedback}
              feedbackError={feedbackError}
              feedbackReady={feedbackReady}
              feedbackSave={feedbackSave}
              isSaving={isSavingFeedback}
              listingCount={scan.listings.length}
              onCopyPrompt={() => feedbackSave ? copyText(feedbackSave.codexPrompt) : Promise.resolve()}
              onNoteChange={(value) => {
                setOverallNote(value);
                setFeedbackSave(null);
              }}
              onSave={saveFeedback}
              onScoreChange={(value) => {
                setOverallScore(value);
                setFeedbackSave(null);
              }}
              overallNote={overallNote}
              overallScore={overallScore}
              ratedListingCount={ratedListingCount}
            />
          ) : null}

          <details className="vinyl-lot-coverage">
            <summary>Search calls and source status</summary>
            <div>
              {scan.diagnostics.families.map((family) => (
                <article key={family.id} className={family.status}>
                  <strong>{family.label}</strong>
                  <span>{family.phase} · {family.status === "available" ? `${family.returnedCount} returned by eBay` : "Search unavailable"}</span>
                  <small>{family.query}</small>
                  {family.error ? <small>{family.error}</small> : null}
                </article>
              ))}
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}

function ScanOptions({
  artistCount,
  onChange,
  onToggleGenre,
  options,
}: {
  artistCount: number;
  onChange: (next: Partial<VinylLotScanPreferences>) => void;
  onToggleGenre: (genre: VinylLotTargetGenre) => void;
  options: VinylLotScanPreferences;
}) {
  return (
    <details className="vinyl-lot-options" open>
      <summary>Customize this scan</summary>
      <div className="vinyl-lot-option-grid">
        <label>
          Minimum stated records
          <input
            aria-label="Minimum stated records"
            type="number"
            min={12}
            max={100}
            value={options.minimumRecords}
            onChange={(event) => onChange({ minimumRecords: clampNumber(event.target.value, 12, 100, 12) })}
          />
          <small>Known counts below 12 are always removed.</small>
        </label>
        <label>
          Results to keep per category
          <input
            aria-label="Results to keep per category"
            type="number"
            min={10}
            max={25}
            value={options.resultsPerGenre}
            onChange={(event) => onChange({ resultsPerGenre: clampNumber(event.target.value, 10, 25, 12) })}
          />
          <small>Fewer than 10 retained candidates is flagged as a shortfall.</small>
        </label>
        <label className="vinyl-lot-check-option">
          <input
            type="checkbox"
            checked={options.excludeSinglesAndFortyFives}
            onChange={(event) => onChange({ excludeSinglesAndFortyFives: event.target.checked })}
          />
          Exclude singles, 7-inch records, and 45 RPM lots
        </label>
        <label className="vinyl-lot-check-option">
          <input
            type="checkbox"
            checked={options.includeUnknownCount}
            onChange={(event) => onChange({ includeUnknownCount: event.target.checked })}
          />
          Keep plausible collections when the count is missing
        </label>
      </div>

      <fieldset className="vinyl-lot-genre-options">
        <legend>Search categories and optional fallback phrases</legend>
        {Object.keys(VINYL_LOT_GENRE_LABELS).map((value) => {
          const genre = value as VinylLotTargetGenre;
          const selected = options.genres.includes(genre);
          return (
            <div key={genre}>
              <label className="vinyl-lot-check-option">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={selected && options.genres.length === 1}
                  onChange={() => onToggleGenre(genre)}
                />
                {VINYL_LOT_GENRE_LABELS[genre]}
              </label>
              <label>
                Custom fallback phrase
                <input
                  maxLength={100}
                  disabled={!selected}
                  value={options.customQueries[genre] ?? ""}
                  onChange={(event) => onChange({
                    customQueries: { ...options.customQueries, [genre]: event.target.value },
                  })}
                  placeholder={customQueryPlaceholder(genre)}
                />
              </label>
            </div>
          );
        })}
      </fieldset>

      <div className="vinyl-lot-artist-link">
        <div>
          <strong>{artistCount} artist signals enabled</strong>
          <span>Short categories use enabled names until coverage passes or the 20-call scan budget is reached.</span>
        </div>
        <a href="#/vinyl-lot-artists">Edit priority artists</a>
      </div>
    </details>
  );
}

function CoveragePanel({ scan }: { scan: VinylLotDiscoveryResult }) {
  const shortfalls = scan.diagnostics.genreCoverage.filter((coverage) => coverage.status === "shortfall");
  return (
    <section className={`vinyl-lot-coverage-panel ${shortfalls.length ? "has-shortfall" : "complete"}`} aria-label="Per-category coverage">
      <header>
        <div>
          <span>{shortfalls.length ? "Coverage needs attention" : "Coverage check passed"}</span>
          <h3>{shortfalls.length ? `${shortfalls.length} ${shortfalls.length === 1 ? "category is" : "categories are"} under 10 results.` : "Every selected category returned at least 10 retained collections."}</h3>
        </div>
      </header>
      <div>
        {scan.diagnostics.genreCoverage.map((coverage) => (
          <article className={coverage.status} key={coverage.genre}>
            <strong>{coverage.label}</strong>
            <span>{coverage.retainedCount} retained · {coverage.displayedCount} shown</span>
            <small>{coverage.rawUniqueCount} unique eBay matches before the collection screen</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function SummaryStat({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className={`vinyl-lot-stat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function LotGroup({
  className,
  description,
  feedbackDrafts,
  listings,
  onFeedbackChange,
  title,
}: {
  className: string;
  description: string;
  feedbackDrafts: Record<string, ListingFeedbackDraft>;
  listings: VinylLotListingObservation[];
  onFeedbackChange: (itemId: string, draft: ListingFeedbackDraft) => void;
  title: string;
}) {
  if (listings.length === 0) return null;
  return (
    <section className={`vinyl-lot-group ${className}`}>
      <header>
        <div>
          <span>{listings.length} current {listings.length === 1 ? "listing" : "listings"}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      <div className="vinyl-lot-grid">
        {listings.map((listing) => (
          <VinylLotCard
            feedback={feedbackDrafts[listing.itemId] ?? EMPTY_LISTING_FEEDBACK}
            key={listing.itemId}
            listing={listing}
            onFeedbackChange={(draft) => onFeedbackChange(listing.itemId, draft)}
          />
        ))}
      </div>
    </section>
  );
}

function VinylLotCard({
  feedback,
  listing,
  onFeedbackChange,
}: {
  feedback: ListingFeedbackDraft;
  listing: VinylLotListingObservation;
  onFeedbackChange: (draft: ListingFeedbackDraft) => void;
}) {
  const classification = listing.classification;
  const genre = classification.genre.primary;
  const reasons = classification.reviewReasons.slice(0, 2);
  return (
    <article className={`vinyl-lot-card status-${classification.status}`}>
      <div className="vinyl-lot-card-image">
        {listing.imageUrl ? <img src={listing.imageUrl} alt="" loading="lazy" /> : <span>No listing image</span>}
        <span className="vinyl-lot-status-chip">{statusLabel(classification.status)}</span>
      </div>
      <div className="vinyl-lot-card-body">
        <div className="vinyl-lot-card-eyebrow">
          <span>{genre ? VINYL_LOT_GENRE_LABELS[genre] : listing.matchedGenres.map((item) => VINYL_LOT_GENRE_LABELS[item]).join(" / ")}</span>
          <span>{formatListedAge(listing.itemCreationDate)}</span>
        </div>
        <h4>{listing.title}</h4>
        <div className="vinyl-lot-price-line">
          <strong>{formatMoney(listing.price)}</strong>
          <span>{listing.shippingCost ? `+ ${formatMoney(listing.shippingCost)} quoted shipping` : "Shipping not quoted"}</span>
        </div>
        <dl className="vinyl-lot-card-facts">
          <div>
            <dt>Stated count</dt>
            <dd>{classification.quantity.count ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Collection evidence</dt>
            <dd>{classification.collection.evidence ?? "Plausible from listing text"}</dd>
          </div>
          <div>
            <dt>Condition evidence</dt>
            <dd>{conditionLabel(classification.condition.level, classification.condition.evidence)}</dd>
          </div>
          <div>
            <dt>Seller feedback</dt>
            <dd>{feedbackLabel(listing)}</dd>
          </div>
        </dl>
        {classification.priorityArtistMatches.length ? (
          <div className="vinyl-lot-priority-artists">
            <strong>Priority artist:</strong> {classification.priorityArtistMatches.join(", ")}
          </div>
        ) : null}
        {classification.flags.length ? (
          <div className="vinyl-lot-flags" aria-label="Review flags">
            {classification.flags.slice(0, 5).map((flag) => <span key={flag}>{humanize(flag)}</span>)}
          </div>
        ) : null}
        {reasons.length ? (
          <ul className="vinyl-lot-reasons">
            {reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}
          </ul>
        ) : null}
        {listing.itemWebUrl ? (
          <a href={listing.itemWebUrl} target="_blank" rel="nofollow noreferrer">View current listing on eBay</a>
        ) : <span className="vinyl-lot-link-missing">Listing link unavailable</span>}

        <ListingFeedbackEditor feedback={feedback} listing={listing} onChange={onFeedbackChange} />
      </div>
    </article>
  );
}

function ListingFeedbackEditor({
  feedback,
  listing,
  onChange,
}: {
  feedback: ListingFeedbackDraft;
  listing: VinylLotListingObservation;
  onChange: (draft: ListingFeedbackDraft) => void;
}) {
  return (
    <details className={`vinyl-lot-feedback-card ${feedbackComplete(feedback) ? "complete" : ""}`}>
      <summary>{feedbackComplete(feedback) ? `Rated ${feedback.score}/10` : "Rate this result"}</summary>
      <div>
        <label>
          Score from 1 to 10
          <select
            aria-label={`Score ${listing.title}`}
            value={feedback.score ?? ""}
            onChange={(event) => onChange({ ...feedback, score: event.target.value ? Number(event.target.value) : null })}
          >
            <option value="">Choose</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score}</option>)}
          </select>
        </label>
        <label>
          Main reason
          <select
            aria-label={`Reason ${listing.title}`}
            value={feedback.reasonTag}
            onChange={(event) => onChange({ ...feedback, reasonTag: event.target.value as VinylLotFeedbackReasonTag | "" })}
          >
            <option value="">Choose a reason (optional)</option>
            {Object.entries(VINYL_LOT_FEEDBACK_REASON_LABELS).map(([tag, label]) => <option key={tag} value={tag}>{label}</option>)}
          </select>
        </label>
        <label>
          Why was this useful or bad?
          <textarea
            aria-label={`Explanation ${listing.title}`}
            maxLength={1000}
            value={feedback.note}
            onChange={(event) => onChange({ ...feedback, note: event.target.value })}
            placeholder="Briefly explain what the scanner got right or wrong."
          />
        </label>
      </div>
    </details>
  );
}

function ScanFeedbackPanel({
  browserLocalFeedback,
  feedbackError,
  feedbackReady,
  feedbackSave,
  isSaving,
  listingCount,
  onCopyPrompt,
  onNoteChange,
  onSave,
  onScoreChange,
  overallNote,
  overallScore,
  ratedListingCount,
}: {
  browserLocalFeedback: boolean;
  feedbackError: string | null;
  feedbackReady: boolean;
  feedbackSave: VinylLotFeedbackSaveResult | null;
  isSaving: boolean;
  listingCount: number;
  onCopyPrompt: () => Promise<void>;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onScoreChange: (value: number | null) => void;
  overallNote: string;
  overallScore: number | null;
  ratedListingCount: number;
}) {
  return (
    <section className="vinyl-lot-feedback-panel" aria-labelledby="vinyl-lot-feedback-heading">
      <header>
        <div>
          <span>{browserLocalFeedback ? "Hosted fallback · browser-local learning" : "Local learning loop"}</span>
          <h3 id="vinyl-lot-feedback-heading">Grade this scan for Codex.</h3>
          <p>{ratedListingCount} of {listingCount} results have a score and explanation.</p>
        </div>
      </header>
      <div className="vinyl-lot-feedback-overall">
        <label>
          Overall scan score
          <select value={overallScore ?? ""} onChange={(event) => onScoreChange(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Choose 1-10</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score}</option>)}
          </select>
        </label>
        <label>
          Overall explanation
          <textarea
            maxLength={1000}
            value={overallNote}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="What made this scan strong or weak overall?"
          />
        </label>
      </div>
      <div className="vinyl-lot-feedback-actions">
        <button type="button" disabled={!feedbackReady || isSaving} onClick={onSave}>
          {isSaving ? "Saving feedback..." : browserLocalFeedback ? "Save in browser & open Codex" : "Save & open in Codex"}
        </button>
        <span>
          {browserLocalFeedback
            ? "Hosted fallback: a sanitized packet stays in this browser. The full request is copied when allowed; paste if prompted, then press Send in Codex."
            : "Feedback is saved only on this computer. Codex opens with a prepared request; you still press Send."}
        </span>
      </div>
      {feedbackError ? <p className="vinyl-lot-feedback-error" role="alert">{feedbackError}</p> : null}
      {feedbackSave ? (
        <div className="vinyl-lot-feedback-saved" role="status">
          <strong>{feedbackSave.storage === "browser-local" ? "Saved in this browser." : "Saved locally."}</strong>
          <span>{feedbackSave.message}</span>
          <a href={feedbackSave.codexUrl}>Open the prepared Codex task</a>
          <button className="secondary-button" type="button" onClick={onCopyPrompt}>Copy Codex request</button>
          <small>Only your ratings, explanations, scan settings, and derived flags were saved. eBay listing content was not retained.</small>
        </div>
      ) : null}
    </section>
  );
}

function buildFeedbackSubmission(
  scan: VinylLotDiscoveryResult,
  drafts: Record<string, ListingFeedbackDraft>,
  overallScore: number,
  overallNote: string,
): VinylLotFeedbackSubmission {
  return {
    expectedListingCount: scan.listings.length,
    expiresAt: scan.expiresAt,
    laneCoverage: scan.diagnostics.genreCoverage.map(({ displayedCount, genre, retainedCount, status }) => ({
      displayedCount,
      genre,
      retainedCount,
      status,
    })),
    listings: scan.listings.map((listing) => {
      const draft = drafts[listing.itemId] ?? EMPTY_LISTING_FEEDBACK;
      return {
        classificationFlags: listing.classification.flags,
        classificationStatus: listing.classification.status,
        conditionLevel: listing.classification.condition.level,
        genre: listing.classification.genre.primary,
        itemId: listing.itemId,
        note: draft.note.trim(),
        priorityArtistMatched: listing.classification.priorityArtistMatches.length > 0,
        quantityBucket: quantityBucket(listing.classification.quantity.count),
        reasonTags: draft.reasonTag ? [draft.reasonTag] : [],
        score: draft.score as number,
      };
    }),
    overall: { note: overallNote.trim(), score: overallScore },
    scanObservedAt: scan.observedAt,
    scanOptions: scan.scanOptions,
    scanSchemaVersion: scan.schemaVersion,
    schemaVersion: 1,
  };
}

function listingMatchesFilter(listing: VinylLotListingObservation, filter: GenreFilter): boolean {
  if (filter === "all") return true;
  return listing.matchedGenres.includes(filter);
}

function feedbackComplete(feedback: ListingFeedbackDraft | undefined): boolean {
  return Boolean(feedback?.score && feedback.note.trim().length >= 3);
}

function quantityBucket(count: number | null): "12-19" | "20-plus" | "unknown" {
  if (count === null) return "unknown";
  return count >= 20 ? "20-plus" : "12-19";
}

function statusLabel(status: VinylLotListingObservation["classification"]["status"]): string {
  if (status === "qualifying") return "12+ record lead";
  if (status === "near-match") return "Size near-match";
  return "Needs evidence";
}

function conditionLabel(level: VinylLotListingObservation["classification"]["condition"]["level"], evidence: string | null): string {
  if (level === "supported-vg-plus") return evidence ? `${evidence} stated` : "VG+ supported";
  if (level === "below-target") return evidence ? `${evidence} - below target` : "Below target";
  return "Not verified";
}

function feedbackLabel(listing: VinylLotListingObservation): string {
  if (!listing.seller || listing.seller.feedbackScore === null) return "Not returned";
  const percentage = listing.seller.feedbackPercentage ? ` · ${listing.seller.feedbackPercentage}%` : "";
  return `${listing.seller.feedbackScore.toLocaleString()}${percentage}`;
}

function customQueryPlaceholder(genre: VinylLotTargetGenre): string {
  if (genre === "hip-hop") return "hip hop record collection estate";
  if (genre === "classic-rock") return "vintage rock record collection";
  if (genre === "1990s-rock") return "1990s indie rock records collection";
  return "Blue Note Prestige jazz collection";
}

function clampNumber(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function formatMoney(money: VinylLotListingObservation["price"]): string {
  if (!money) return "Price unavailable";
  const value = Number(money.value);
  if (!Number.isFinite(value)) return `${money.value} ${money.currency}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency }).format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "time unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatListedAge(value: string | null): string {
  if (!value) return "Listed time unavailable";
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Newly listed";
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Listed less than 1h ago";
  if (hours < 24) return `Listed ${hours}h ago`;
  return `Listed ${Math.floor(hours / 24)}d ago`;
}

function humanize(value: string): string {
  return value.replace(/-/g, " ");
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // The prepared Codex link remains visible as the fallback.
  }
}

function assertDisplayableVinylLotScan(scan: VinylLotDiscoveryResult): void {
  if (
    scan.schemaVersion !== 2
    || scan.source !== "ebay-browse"
    || scan.evidenceScope !== "active_ebay_listings_only"
    || scan.soldDataIncluded !== false
    || scan.storage !== "transient-no-persistence"
    || !Array.isArray(scan.listings)
    || !Array.isArray(scan.diagnostics?.genreCoverage)
    || !Array.isArray(scan.diagnostics?.families)
  ) {
    throw new Error("The scan response crossed the eBay-only discovery boundary and was not displayed.");
  }
  const observedAt = Date.parse(scan.observedAt);
  const expiresAt = Date.parse(scan.expiresAt);
  if (
    !Number.isFinite(observedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= observedAt
    || expiresAt - observedAt > VINYL_LOT_RESULT_TTL_MS
  ) {
    throw new Error("The scan response did not contain a valid six-hour expiry window.");
  }
  if (expiresAt <= Date.now()) {
    throw new Error("The eBay results have already expired. Run a fresh scan to continue reviewing.");
  }
}
