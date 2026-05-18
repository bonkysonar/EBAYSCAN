# Record Scanner

Local-first record triage MVP for deciding whether vinyl records are probably below a resale processing threshold, worth keeping for manual processing, or ambiguous enough to inspect manually.

## Local Setup

```powershell
npm install
npm run dev
```

Then open the Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

## Hosting Status

The app is prepared for Vercel hosting but has not been deployed. See `HOSTING.md` for setup steps, required environment variables, and deployment notes.

## Color Semantics

- GREEN: likely worth processing/listing because prices cluster above the threshold.
- YELLOW: ambiguous or needs manual review.
- RED: likely safe to skip or move to bulk because prices cluster at/below the threshold.

## Real eBay Setup

Real eBay Browse API lookup is optional and local-only. Create `.env.local` with:

```env
EBAY_ENV=production
EBAY_CLIENT_ID=your_production_app_id_here
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_CLIENT_SECRET=your_production_cert_id_here
```

Do not commit `.env.local`. The client secret is used only by the local Vite dev server endpoint at `/api/ebay/search` and is not bundled into browser code.

The local server mints and caches short-lived eBay application tokens automatically. If eBay rejects a real request, normal searches show a YELLOW no-results warning instead of misleading mock matches. Only explicit demo inputs use mock fallback.

## Useful Demo Inputs

- Real manual search: `fleetwood mac rumours`
- Real catalog search: `60296-1`
- Mock barcode-style fallback: `012345LOW`
- Mock barcode-style fallback: `999999RARE`
- Mock/manual ambiguous fallback: `mixed ambiguous vinyl`
- Image placeholder: upload any image to exercise the image input path against mocks.

## Speed Mode

Speed Mode is a barcode-only workflow for scanner sessions. Turning it on focuses the barcode input immediately, disables catalog/manual/image inputs, and returns focus to the barcode input after each lookup finishes so David can scan, glance at the result, then scan the next record.

## eBay Product Research Link

Each result includes an Open eBay sold research link. It uses eBay Seller Hub Product Research with 	abName=SOLD, dayRange=90, categoryId=176985, limit=50, and the best query available. For barcode/catalog searches, the link prefers the expanded artist/title query over the raw identifier.

## Discogs Setup

Optional Discogs marketplace stats are available when .env.local includes:

```env
DISCOGS_USER_TOKEN=your_discogs_personal_token_here
```

The app searches Discogs releases in parallel with eBay and displays matched release, lowest marketplace price, number for sale, have/want counts, and match confidence. Discogs median/sold-history price is shown as unavailable unless the API returns it.

## Discogs Sales Stats Pull / Import

Discogs release pages show useful sales statistics such as Last Sold, Low, Median, and High. Those sales-history values are not available from the official API response used by the app. When a result has a Discogs match, the app can try a one-release-at-a-time pull of the matched Discogs page, or you can paste the visible Statistics text / upload a saved Discogs HTML/XML/text file into the Discogs import box. Parsed Discogs sales median becomes a stricter GREEN gate.

Discogs may block the automatic pull with a browser challenge; when that happens, the app shows the blocker and the paste/file import box remains the fallback. Do not use this as a batch data-mining feature.

## Discogs Browser Helper

For the fastest workflow, install the companion Chrome extension from `browser-extension/discogs-stats-helper`:

1. Open Chrome and go to `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Choose `C:\Users\dbort\OneDrive\Documents\Codex Projects\Record Scanner\browser-extension\discogs-stats-helper`.
5. In Record Scanner, scan/search a record with a Discogs match.
6. Click Open Discogs Helper.

The helper opens the matched Discogs release in a tab, reads the visible Last Sold / Low / Median / High stats from your real browser session, and sends them back to Record Scanner. This avoids waiting on Google Sheets and avoids pretending the server can read Discogs pages when Discogs blocks automated page fetches.

Once installed, Record Scanner asks the helper automatically when a Discogs match appears. The helper opens an inactive background tab, reads the stats, sends them back, and closes the helper tab. The Run Discogs Helper button retries the same background flow.

When the browser helper returns a Discogs sales median, that median becomes the hard threshold signal: median above the configured threshold is GREEN, and median at/below the threshold is RED.

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
- `api/discogs/stats.ts` exposes the best-effort one-release Discogs stats pull.
- `src/lib/scoring` contains GREEN/YELLOW/RED triage logic.
- `src/lib/normalization` contains price, title, and consensus helpers.
- `src/components` contains focused UI components.
- `src/fixtures` contains credential-free demo data.
- `src/tests` covers scoring and normalization behavior.

## eBay Integration Status

The real integration uses eBay OAuth client-credentials token minting with the Production Client ID and Client Secret.

Browse API search currently powers barcode, catalog-number, and manual text inputs. These searches default to used listings, with New and Both available in the lookup panel. Image search remains a mock placeholder until eBay image-search access and request behavior are confirmed.










