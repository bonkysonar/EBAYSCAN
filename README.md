# Record Scanner

Local-first record triage MVP for deciding whether vinyl records are probably below a resale processing threshold, worth keeping for manual processing, or ambiguous enough to inspect manually.

## Local Setup

```powershell
npm install
npm run dev
```

Then open the Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

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

## Identifier Search Expansion

Barcode and catalog-number lookups use a two-stage search. The app first searches the identifier, then derives likely artist/title terms from those results and runs a broader eBay search. Results are merged and deduped. The local endpoint requests up to 200 active listings per search page and reports eBay total-match counts in the source summary.

## Test Commands

```powershell
npm test
npm run build
```

## Architecture

- `src/lib/ebay` contains the marketplace client interface, browser client, and mock eBay client.
- `vite.config.ts` contains the local dev-only eBay Browse API endpoint.
- `src/lib/scoring` contains GREEN/YELLOW/RED triage logic.
- `src/lib/normalization` contains price, title, and consensus helpers.
- `src/components` contains focused UI components.
- `src/fixtures` contains credential-free demo data.
- `src/tests` covers scoring and normalization behavior.

## eBay Integration Status

The real integration uses eBay OAuth client-credentials token minting with the Production Client ID and Client Secret.

Browse API search currently powers barcode, catalog-number, and manual text inputs. These searches default to used listings, with New and Both available in the lookup panel. Image search remains a mock placeholder until eBay image-search access and request behavior are confirmed.








