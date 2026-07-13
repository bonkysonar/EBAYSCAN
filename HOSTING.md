# Hosting

The app is deployed on Vercel from the `main` branch.

- Production app: `https://ebayscan.vercel.app`
- Project: `bonkysonars-projects/ebayscan`
- Active deployment: inspect the stable production alias with `npx vercel inspect https://ebayscan.vercel.app`.

## Why Vercel

- The frontend is a Vite static build from `dist`.
- The real marketplace lookup needs server-side secrets.
- Vercel hosts the static app and the serverless API routes.

## Required Environment Variables

Set these in the Vercel project dashboard, not in committed files:

```env
EBAY_ENV=production
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MARKETPLACE_ID=EBAY_US
DISCOGS_USER_TOKEN=
EBAY_USER_REFRESH_TOKEN=
BLOB_READ_WRITE_TOKEN=
ARBITRAGE_UPLOAD_TOKEN=
```

`DISCOGS_USER_TOKEN` is optional for Discogs release data. `EBAY_USER_REFRESH_TOKEN` is optional for the read-only Seller Price Analyzer and lets the server mint and cache short-lived seller user tokens automatically. `EBAY_USER_ACCESS_TOKEN` remains supported only as a temporary fallback. eBay client variables are required for real scanner lookup and for seller-token refresh.

`BLOB_READ_WRITE_TOKEN` is required for hosted Retail Arbitrage uploads and should be provisioned by a Vercel Blob store attached to the project. `ARBITRAGE_UPLOAD_TOKEN` is a shared secret that protects `POST /api/arbitrage/upload`; use the same value in the daily automation environment.

## Local Commands

```powershell
npm install
npm test
npm run build
npm run dev
```

Local Vite dev still provides `/api/ebay/search` through `vite.config.ts`, reading `.env.local`.

To publish daily Retail Arbitrage output to the hosted site, set these on the machine running the automation:

```env
ARBITRAGE_UPLOAD_URL=https://ebayscan.vercel.app/api/arbitrage/upload
ARBITRAGE_UPLOAD_TOKEN=
```

## Hosted Architecture

- `api/ebay/search.ts` is the hosted serverless function.
- `api/ebay/seller-listings.ts` is the read-only seller-listings function.
- `api/discogs/stats.ts` is the best-effort one-release Discogs stats function.
- `api/arbitrage/latest.ts` reads the newest Retail Arbitrage payload from Vercel Blob, with local filesystem fallback for dev.
- `api/arbitrage/upload.ts` accepts protected daily scan uploads and stores them in Vercel Blob.
- `src/server/marketplaceApi.ts` contains shared eBay/Discogs lookup logic.
- `src/lib/ebay/client.ts` calls `/api/ebay/search` from the browser.
- `public/downloads/record-scanner-discogs-helper.zip` is copied into the Vite output and served as the Chrome helper download.
- `vercel.json` points Vercel at the Vite build output and configures the API function.

## Deployment Notes

1. Keep the framework preset as Vite.
2. Set the environment variables above for Production and Preview.
3. Deploy reviewed work by merging or pushing to `main`.
4. Test manual search, catalog search, barcode search, Seller Price Analyzer, the eBay Product Research link, and the Chrome extension download link.

Seller Price Analyzer listing loads should use the browser client's paged flow. Direct hosted `POST /api/ebay/seller-listings` calls can pass `{ "pageNumber": 1, "maxPages": 5 }` to avoid function timeouts on large active inventories.

