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

`node scripts/runRetailArbitrageScan.mjs` still writes a local archive in `exports/arbitrage-finds/`, then uploads the same JSON payload to the hosted site when those automation variables are present. If a workflow enriches or validates the JSON after the first scan pass, run `node scripts/uploadLatestArbitrageFinds.mjs` at the end to publish the newest local JSON file.

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
```

Do not commit `.env.local`. For hosted Vercel, set the same values in the project environment variable dashboard. The client secret is used only server-side and is not bundled into browser code.

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

The app searches Discogs releases in parallel with eBay and displays the matched release, current lowest price, number for sale, have/want counts, match confidence, and an automatic used-condition price guide. The price guide uses Discogs' documented authenticated price-suggestions endpoint and prefers the conservative Very Good (VG) suggestion. It is labeled separately from historical median because the two values are not interchangeable.

## Discogs Sales Stats Pull / Import

Discogs release pages show useful historical statistics such as Last Sold, Low, Median, and High. Those exact page-history values are separate from the official API price guide. Normal scans do not need them: pressing Enter returns the automatic Discogs VG price guide without opening Discogs or requiring another click. If an exact historical median is needed, the app can try a one-release-at-a-time page pull, use the optional Chrome helper, or parse Statistics text / saved Discogs HTML/XML/text supplied by the user.

Discogs may block the automatic pull with a browser challenge; when that happens, the app shows the blocker and the paste/file import box remains the fallback. Do not use this as a batch data-mining feature.

## Discogs Browser Helper

The companion Chrome extension is optional and is only needed to retrieve the exact page-visible historical statistics or manually correct a pressing. The normal scanner flow uses the API price guide and does not open the helper automatically. The packaged extension is available from the app header as Download Chrome Extension, or directly at:

```text
https://ebayscan.vercel.app/downloads/record-scanner-discogs-helper.zip
```

For local development, the unpacked source lives in `browser-extension/discogs-stats-helper`:

1. Open Chrome and go to `chrome://extensions`.
2. Turn on Developer mode.
3. Download and unzip the hosted helper, or use the local folder above.
4. Click Load unpacked and choose the unzipped helper folder.
5. In Record Scanner, scan/search a record with a Discogs match.
6. Click Optional: Open Discogs Helper only when exact historical statistics are needed.

The helper opens the matched Discogs release in a tab, reads the visible Last Sold / Low / Median / High stats from your real browser session, and sends them back to Record Scanner. It is a manual precision tool, not part of the default scan path.

Record Scanner never opens the helper automatically. This avoids repeated Discogs navigations and browser challenges during a scanning session.

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










