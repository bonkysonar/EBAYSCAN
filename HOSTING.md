# Hosting

The app is prepared for Vercel hosting, but it should not be deployed unless David explicitly asks.

## Why Vercel

- The frontend is a Vite static build from `dist`.
- The real marketplace lookup needs server-side secrets.
- Vercel can host both the static app and `/api/ebay/search` as a serverless function.

## Required Environment Variables

Set these in the Vercel project dashboard, not in committed files:

```env
EBAY_ENV=production
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MARKETPLACE_ID=EBAY_US
DISCOGS_USER_TOKEN=
```

`DISCOGS_USER_TOKEN` is optional. eBay variables are required for real eBay lookup.

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
- `src/server/marketplaceApi.ts` contains shared eBay/Discogs lookup logic.
- `src/lib/ebay/client.ts` calls `/api/ebay/search` from the browser.
- `vercel.json` points Vercel at the Vite build output and configures the API function.

## Deployment Notes

1. Import `bonkysonar/EBAYSCAN` into Vercel.
2. Keep the framework preset as Vite.
3. Set the environment variables above for Production and Preview.
4. Deploy from a reviewed branch or merged `main`.
5. Test manual search, catalog search, barcode search, and the eBay Product Research link.

