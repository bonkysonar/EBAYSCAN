# Record Scanner

Local-first record triage MVP for deciding whether vinyl records are probably below a resale processing threshold, worth keeping for manual processing, or ambiguous enough to inspect manually.

## Local Setup

```powershell
npm install
npm run dev
```

Then open the Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

## Hosting Status

The app is deployed on Vercel from `main`:

- Production app: `https://ebayscan.vercel.app`
- Chrome helper download: `https://ebayscan.vercel.app/downloads/record-scanner-discogs-helper.zip`

See `HOSTING.md` for required environment variables and deployment notes.

## Delivery Ownership and Purchase Boundary

When the repository owner asks Codex to implement, merge, publish, or deploy a Record Scanner change, Codex owns the complete routine delivery workflow. That includes isolating the requested changes from unrelated work, using the configured Git, GitHub, and Vercel credentials or connected tools, testing, staging, committing, pushing, merging into `main`, deploying production, and verifying the live result. Codex must not hand routine command-line or authentication work back to the owner; it must first exhaust the available credential manager, authenticated CLIs, connected services, and clean-worktree options. Owner involvement is reserved for an external service that truly requires an inaccessible credential or interactive approval.

Record Scanner and Codex are discovery and decision-support tools only. They must never bid, purchase, submit checkout, initiate payment, or otherwise commit to acquiring inventory. The repository owner alone decides what to buy and completes every purchase.

## Hosted Retail Arbitrage Uploads

The Retail Arbitrage and Site-wide Sales pages load the newest daily scan from `GET /api/arbitrage/latest`. In production, that endpoint reads from Vercel Blob when `BLOB_READ_WRITE_TOKEN` is configured, so the Vercel site stays usable even when local dev servers are closed.

Production setup:

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_store_token
ARBITRAGE_UPLOAD_TOKEN=shared_secret_for_daily_scan_uploads
```

Daily automation setup on the machine that runs the scan:

```env
ARBITRAGE_UPLOAD_URL=https://ebayscan.vercel.app/api/arbitrage/upload
ARBITRAGE_UPLOAD_TOKEN=same_shared_secret_as_production
```

The scanner writes a timestamped draft in `exports/arbitrage-finds/`; drafts are never publishable. The daily workflow builds the Product Research plan, curates one final artifact, validates that exact file, and uploads it once. The server rejects low-coverage or targeted/partial new runs instead of replacing the latest trustworthy publication.

Retail Arbitrage is candidate-first. Its default queue shows source-linked Tier A/B/C records even when no row clears every automatic `BUY` gate: A is fully verified, B is promising product-level evidence with at least one proof gap, and C is a research lead rather than a value claim. Each selected record has both a three-year Seller Hub Product Research link and a public eBay Sold/Completed fallback.

The **Sold value** column also shows provisional album benchmarks from observed Seller Hub sales of New vinyl over three years. These ranges allow different pressings and colors of the same artist and album, exclude unrelated formats and album bundles, and use matching listings' average item prices before shipping. More than 10 observed copies meets the owner's comparison threshold; smaller samples still show a range labeled thin. Partial page captures show counts as “at least.” An album benchmark does not establish an exact pressing match or automatically qualify an offer for `BUY`.

Saved browser research is reused by the normal import and curation workflow. To add newly captured ranges to the existing live offers without rescanning retailers, save the current `/api/arbitrage/latest` response locally, then run `node scripts/prepareAlbumBenchmarkUpdate.mjs <saved-latest-response.json>`. Upload the exact generated final file with the command below. This evidence update requires the current publication's run ID, creates a new immutable publication, and preserves acquisition prices, observation timestamps, source reports, and exact sold evidence. If another scan publishes first, fetch the new latest response and prepare a new update.

Useful commands:

```powershell
npm run arbitrage:scan
npm run arbitrage:research-plan -- <draft-json>
node scripts/curateRetailArbitrageRun.mjs <draft-json> <research-json|--pending>
npm run arbitrage:upload -- --file=<final-json>
```

See `RETAIL_ARBITRAGE.md` for the evidence and publication workflow and `RETAIL_SOURCE_COVERAGE.md` for the current source-by-source audit.

## Color Semantics

- GREEN: likely worth processing/listing because prices cluster above the threshold.
- YELLOW: ambiguous or needs manual review.
- RED: likely safe to skip or move to bulk because prices cluster at/below the threshold.

## Real eBay Setup

Real eBay Browse API lookup is optional for local development and required for real hosted lookups. Create `.env.local` for local dev with:

```env
EBAY_ENV=production
EBAY_CLIENT_ID=your_production_app_id_here
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_CLIENT_SECRET=your_production_cert_id_here
EBAY_DELIVERY_POSTAL_CODE=your_destination_zip_here
```

Do not commit `.env.local`. For hosted Vercel, set the same values in the project environment variable dashboard. The client secret is used only server-side and is not bundled into browser code.

The destination ZIP is required for destination-specific landed shipping and verified eBay acquisition evidence. Without it, exact active-listing identity and supply counts can still be collected, but landed prices are labeled destination-unverified and eBay purchase results remain discovery leads that cannot become `BUY`.

The server mints and caches short-lived eBay application tokens automatically. If eBay rejects a real request, normal searches show a YELLOW no-results warning instead of misleading mock matches. Only explicit demo inputs use mock fallback.

## Useful Demo Inputs

- Real manual search: `fleetwood mac rumours`
- Real catalog search: `60296-1`
- Mock barcode-style fallback: `012345LOW`
- Mock barcode-style fallback: `999999RARE`
- Mock/manual ambiguous fallback: `mixed ambiguous vinyl`
- Image placeholder: upload any image to exercise the image input path against mocks.

## Speed Mode

Speed Mode is a barcode-only workflow for scanner sessions. Turning it on focuses the barcode input immediately, disables catalog/manual/image inputs, and returns focus to the barcode input after each lookup finishes so David can scan, glance at the result, then scan the next record.

## Bulk Buy Scanner

Bulk Buy is a separate page at `#/bulk-buy`, available from the top navigation. The default scanner stays in normal triage mode and does not add records to a Bulk Buy batch.

The Bulk Buy page uses the same lookup workflow as the scanner, but each scan/search also adds a row to the Bulk Buy ledger with:

- Stable scan order.
- Album/title.
- New/used condition.
- Low-end bulk / sellable / high-end category.
- Recommended buy amount.
- Best-case sale amount.
- Estimated profit after fees, advertising, shipping supplies, and self-employment tax.

Bulk Buy math uses the lower of Discogs sales/market median and eBay average cheapest-10 active price as the reference price. If the reference price is under `$5`, the buy recommendation is a flat `$0.50`; otherwise it is `40%` of the reference. Money values are rounded down to the nearest `$0.50`.

The ledger supports sortable columns, adjustable column widths, row deletion, row click-to-review, running totals, average buy per record, CSV download, reset, and named local saved batches. Saved batches are stored in browser localStorage.

## Vinyl Lot Finder

Vinyl Lot Finder is a separate page at `#/vinyl-lots`. It starts with two broad official eBay Browse searches for each selected genre, then uses a fallback and enabled artist searches only when a category has fewer than 10 retained collection candidates. Every scan has a hard ceiling of 20 Browse calls.

The hosted scan route has a 60-second Vercel function limit and a 50-second internal runtime budget. Each eBay request remains capped at eight seconds. If the overall budget expires, in-flight requests are aborted, queued searches are skipped, and the response is marked incomplete instead of running into Vercel's hard termination window.

The default known-count floor is 12 records. The page removes obvious single LPs, choice/per-record listings, known groups under 12, singles, 7-inch/45 RPM lots, empty-sleeve lots, and non-vinyl formats. Plausible collections without a trustworthy count stay in a separate human-review queue. Results are transient, expire within six hours, and are not published to Vercel Blob.

Hosted Vinyl Lots scans use the server-side `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` pair to mint short-lived eBay application tokens automatically. Client credentials take precedence over any static Browse token, so normal operation does not require recurring eBay sign-in or manual token rotation.

Scan size, retained results per category, enabled genres, unknown-count handling, singles/45 filtering, and per-genre fallback phrases are customizable and saved on this computer. `#/vinyl-lot-artists` contains an editable local list of priority artists. Artist names are discovery and inclusion signals only, never value guarantees or custom ranking inputs.

Each displayed result and the overall scan can be rated from 1 to 10 with an explanation. On loopback development, **Save & open in Codex** stores the sanitized packet under `%LOCALAPPDATA%\RecordScanner\vinyl-lot-feedback\inbox`. On the hosted site, **Save in browser & open Codex** stores the same whitelisted fields in browser-local storage and copies the complete request before opening Codex. Both paths exclude eBay listing content and raw item IDs, and both require the user to press **Send**. `VINYL_LOT_LEARNING.md` is the durable, reviewable product memory; Codex native memory is optional recall, not the product database.

This page intentionally does not calculate value, profit, ROI, maximum offers, seller type, or sold-market comparisons. Those capabilities remain disabled pending explicit eBay approval for the use case.

Hosted scans require a server-side operator key:

```env
VINYL_LOT_SCAN_TOKEN=private_scan_access_key
```

Enter the same key under Hosted scan access on the page. On a private computer, **Remember this key on this device** saves it in browser-local storage only after a successful authenticated scan; **Forget saved key** removes it. Missing keys are stopped before a request is sent, and rejected saved keys are cleared automatically. Local development permits scans without the key; production fails closed when it is absent.

## Seller Price Analyzer

The Seller Price Analyzer is a separate page at `#/seller-prices`. It does not change the scanner workflow and it does not mutate eBay listings.

Optional setup:

```env
EBAY_USER_REFRESH_TOKEN=your_user_oauth_refresh_token_here
```

The analyzer pulls active store listings read-only through eBay Trading API `GetMyeBaySelling` via a local/hosted `POST /api/ebay/seller-listings` action, then runs each listing title through the existing active eBay lookup. With `EBAY_USER_REFRESH_TOKEN`, the server mints and caches short-lived user access tokens automatically. `EBAY_USER_ACCESS_TOKEN` is still accepted as a short-lived fallback, but it will expire quickly and should not be the durable production setup. Recommendations compare your current asking price against the active eBay cheapest-10 average:

- More than 25% above cheapest-10 average: priced high.
- More than 20% below cheapest-10 average: possible underpricing.
- 50+ active comps: crowded.
- 150+ active comps: very crowded.

The analyzer saves its queue, completed analytics, and tagged change notes in browser localStorage so leaving and returning to `#/seller-prices` does not require reloading active listings. Rows use a compact spreadsheet-style layout; clicking a row opens an analytics panel with comparable active listings, eBay links, and fields to tag proposed price changes. CSV exports include both `sku` and `custom_label`; `sku` falls back to `custom_label` when eBay does not return a separate SKU.

If a long browser analysis has already been exported, use Import Snapshot CSV to restore those analyzed rows without making new eBay Browse calls. Imports support the browser snapshot columns `title`, `item_url`, `meta`, `your_price`, `cheapest_10_average`, `delta`, `active_comps`, `recommendation`, and `reason`. SKU/custom label metadata is preserved when the current browser cache already has matching active listings by item ID or title.

Seller analysis uses a lighter eBay Browse profile than the scanner: it requests the lowest-price active comps first, caps each row at 50 returned comps, skips Discogs, processes 25 rows per run, waits between rows, and auto-pauses on eBay `429 Too many requests`.

Active seller listings are loaded from Trading API in hosted-safe chunks of five eBay pages per request. This keeps Vercel functions under their timeout while still letting the browser assemble the full active inventory before analysis.

## eBay Product Research Link

Each result includes an Open eBay sold research link. It uses eBay Seller Hub Product Research with `tabName=SOLD`, `dayRange=90`, `categoryId=176985`, `limit=50`, and the best query available. For barcode/catalog searches, the link prefers the expanded artist/title query over the raw identifier.

## Discogs Setup

Optional Discogs marketplace stats are available when `.env.local` or Vercel environment variables include:

```env
DISCOGS_USER_TOKEN=your_discogs_personal_token_here
```

The app searches Discogs releases in parallel with eBay and displays the matched release, current lowest price, number for sale, have/want counts, and match confidence. It also attempts Discogs' authenticated price-suggestions endpoint and prefers the conservative Very Good (VG) suggestion when the token's account can access it. The guide is labeled separately from historical median because the two values are not interchangeable.

## Discogs Sales Stats Pull / Import

Discogs release pages show useful historical statistics such as Last Sold, Low, Median, and High. Those exact page-history values are separate from the API's current-lowest response and condition-based price guide. Vercel's server-side page pull may receive a 403 browser challenge, so helper v0.3 automatically sends each matched release to one persistent, visible Chrome window instead. Complete Discogs' browser check normally the first time; the same window and browser session are reused for later scans.

Discogs may block the automatic pull with a browser challenge; when that happens, the app shows the blocker and the paste/file import box remains the fallback. Do not use this as a batch data-mining feature.

## Discogs Browser Helper

The companion Chrome extension is required for automatic page-visible historical statistics. Version 0.3 keeps one real Discogs window open for the scanning session instead of creating and closing a hidden tab per record. The packaged extension is available from the app header as Download Chrome Extension, or directly at:

```text
https://ebayscan.vercel.app/downloads/record-scanner-discogs-helper.zip
```

For local development, the unpacked source lives in `browser-extension/discogs-stats-helper`:

1. Open Chrome and go to `chrome://extensions`.
2. Turn on Developer mode.
3. Download and unzip the hosted helper, or use the local folder above. Replace any older helper folder.
4. Click Load unpacked and choose the unzipped helper folder. If it was already installed, click Reload and confirm the card shows version 0.3.0.
5. In Record Scanner, scan/search a record with a Discogs match.
6. The first match opens the real Discogs helper window. Complete any browser challenge or login shown there.
7. Leave that window open. Later scans navigate the same window automatically and return focus to Record Scanner after stats are read.

The helper reads the visible Last Sold / Low / Median / High stats from the real browser session and sends them back to Record Scanner. If Discogs presents another challenge later, the helper brings its window forward again. The Reconnect Discogs Window button retries the current record without creating another helper window.

The helper does not bypass Discogs verification. Challenge clearance commonly persists in the browser session, but Discogs can require verification again after its cookie expires or its security policy changes.

When the browser helper returns a Discogs sales median, that median becomes the hard threshold signal: median above the configured threshold is GREEN, and median at/below the threshold is RED.

If the automatic helper lands on the wrong Discogs pressing, use Manually Choose Pressing, navigate the Discogs tab to the correct release, then return and click Accept New Pressing. You can also paste a Discogs `/release/` URL into the Discogs pressing URL field. Pasted URLs apply immediately even when Discogs blocks the follow-up stats pull.

## Identifier Search Expansion

Barcode and catalog-number lookups use a two-stage search. The app first searches the identifier, then derives likely artist/title terms from those results and runs a broader eBay search. Results are merged and deduped. The local endpoint paginates eBay Browse results in 200-listing pages, up to 1,000 returned listings per query, and reports eBay total-match counts in the source summary.

## Test Commands

```powershell
npm test
npm run build
```

## Architecture

- `src/lib/ebay` contains the marketplace client interface, browser client, and mock eBay client.
- `src/server/marketplaceApi.ts` contains shared server-side eBay and Discogs lookup logic.
- `src/server/vinylLotDiscoveryApi.ts` contains the transient, bounded eBay lot-discovery workflow.
- `src/server/vinylLotFeedbackApi.ts` validates and stores sanitized local-only feedback packets.
- `api/vinyl-lots/scan.ts` exposes the protected hosted Vinyl Lots scan action.
- `src/lib/vinylLots` contains scan options, artist preferences, feedback contracts, and lot quantity/genre/condition/noise classification.
- `vite.config.ts` wires that shared lookup into local Vite dev at `/api/ebay/search`.
- `api/ebay/search.ts` exposes the same lookup as a hosted Vercel serverless function.
- `api/ebay/seller-listings.ts` exposes the read-only active seller listings endpoint.
- `api/discogs/stats.ts` exposes the best-effort one-release Discogs stats pull.
- `src/lib/bulkBuy` contains Bulk Buy batch storage and pricing math.
- `browser-extension/discogs-stats-helper` contains the unpacked Chrome helper source.
- `public/downloads/record-scanner-discogs-helper.zip` is the hosted packaged helper.
- `src/lib/scoring` contains GREEN/YELLOW/RED triage logic.
- `src/lib/normalization` contains price, title, and consensus helpers.
- `src/components` contains focused UI components.
- `src/fixtures` contains credential-free demo data.
- `src/tests` covers scoring and normalization behavior.

## eBay Integration Status

The real integration uses eBay OAuth client-credentials token minting with the Production Client ID and Client Secret.

Browse API search currently powers barcode, catalog-number, and manual text inputs. These searches default to used listings, with New and Both available in the lookup panel. Image search remains a mock placeholder until eBay image-search access and request behavior are confirmed.










