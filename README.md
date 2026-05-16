# Record Scanner

Local-first record triage MVP for deciding whether vinyl records are probably below a resale processing threshold, worth keeping for manual processing, or ambiguous enough to inspect manually.

## Local Setup

```powershell
npm install
npm run dev
```

Then open the Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

## Useful Demo Inputs

- Barcode: `012345LOW`
- Barcode: `999999RARE`
- Catalog number: `60296-1`
- Manual search: `fleetwood mac rumors common`
- Manual search: `blue note mono original`
- Manual search: `mixed ambiguous vinyl`
- Image placeholder: upload any image to exercise the image input path against mocks.

## Test Commands

```powershell
npm test
npm run build
```

## Architecture

- `src/lib/ebay` contains the marketplace client interface and mock eBay client.
- `src/lib/scoring` contains GREEN/YELLOW/RED triage logic.
- `src/lib/normalization` contains price, title, and consensus helpers.
- `src/components` contains focused UI components.
- `src/fixtures` contains credential-free demo data.
- `src/tests` covers scoring and normalization behavior.

## eBay Integration Status

Real eBay authentication is intentionally not implemented yet. Add official eBay Browse API support behind `MarketplaceClient` in `src/lib/ebay/client.ts` when credentials, API access, and terms-compliant request patterns are ready.
