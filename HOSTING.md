# Hosting

The app is deployed on Vercel from the `main` branch.

- Production app: `https://ebayscan.vercel.app`
- Project: `bonkysonars-projects/ebayscan`
- Latest known production deployment from this workspace: `https://ebayscan-3mnc4qaqt-bonkysonars-projects.vercel.app`

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
EBAY_USER_ACCESS_TOKEN=
```

`DISCOGS_USER_TOKEN` is optional for Discogs release data. `EBAY_USER_ACCESS_TOKEN` is optional for the read-only Seller Price Analyzer. eBay client variables are required for real scanner lookup.

## Local Commands

```powershell
npm install
npm test
npm run build
npm run dev
```

Local Vite dev still provides `/api/ebay/search` through `vite.config.ts`, reading `.env.local`.

## Hosted Architecture

- `api/ebay/search.ts` is the hosted serverless function.
- `api/ebay/seller-listings.ts` is the read-only seller-listings function.
- `api/discogs/stats.ts` is the best-effort one-release Discogs stats function.
- `src/server/marketplaceApi.ts` contains shared eBay/Discogs lookup logic.
- `src/lib/ebay/client.ts` calls `/api/ebay/search` from the browser.
- `public/downloads/record-scanner-discogs-helper.zip` is copied into the Vite output and served as the Chrome helper download.
- `vercel.json` points Vercel at the Vite build output and configures the API function.

## Deployment Notes

1. Keep the framework preset as Vite.
2. Set the environment variables above for Production and Preview.
3. Deploy reviewed work by merging or pushing to `main`.
4. Test manual search, catalog search, barcode search, Seller Price Analyzer, the eBay Product Research link, and the Chrome extension download link.

