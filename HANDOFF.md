# Handoff

Last updated: 2026-06-22

## Current State

- Branch: `main`
- Latest local/remote commit during this handoff cleanup: `0739d8d Add Chrome extension download link`
- Production app: `https://ebayscan.vercel.app`
- Current working tree should be clean before new work starts.
- No open GitHub PRs were visible as of this cleanup.
- Do not commit `.env.local`; it contains credentials and is ignored.

The merged product now includes the default Scanner, optional Bulk Buy page, Seller Price Analyzer, hosted Vercel API routes, Discogs helper extension support, and a hosted Chrome helper zip download.

## Product Semantics

The color meanings were intentionally flipped from the original brief:

- `GREEN`: likely worth processing/listing because pricing clusters above threshold.
- `YELLOW`: ambiguous or needs manual review.
- `RED`: likely safe to skip or move to bulk.

Default threshold is still `$5`.

## eBay Integration Status

Real active-listing lookup is wired through shared server logic used by both local Vite middleware and hosted Vercel functions:

- Browser client: `src/lib/ebay/client.ts`
- Local API/server middleware: `vite.config.ts`
- Hosted API route: `api/ebay/search.ts`
- Mock fallback: `src/lib/ebay/mockClient.ts`

`.env.local` should contain:

```env
EBAY_ENV=production
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_ID=EBAY_US
```

The app now uses eBay OAuth client-credentials flow to mint and cache application tokens automatically. Manual `EBAY_ACCESS_TOKEN` is no longer needed.

## Search Behavior

Manual search:

- Runs eBay Browse API active-listing search.
- Adds `vinyl record` to the query.
- Defaults to used condition.

Catalog/barcode search:

- Runs a primary identifier search.
- Derives likely artist/title tokens from the primary results.
- Runs an expanded artist/title query.
- Merges and dedupes both result sets.
- Paginates eBay Browse results in 200-listing pages, up to 1,000 returned listings per query.

Condition filter:

- `used`: sends `conditions:{USED}`.
- `new`: sends `conditions:{NEW}`.
- `both`: sends no condition filter.

The Price Cluster panel now displays `rawSummary`, including query plan, returned counts, and eBay total-match counts.

Example verified:

```text
Catalog: BXL1 0209
Primary: "BXL1 0209 vinyl record" total=5 returned=5
Expanded: "quah jorma kaukonen tom hobson vinyl record" total=66 returned=66
Merged: 66 unique listings
```

## Sold Listings / Product Research

Current key can mint tokens and use Browse API, but Marketplace Insights remains blocked:

```text
/buy/marketplace_insights/v1_beta/item_sales/search
403 Access denied / Insufficient permissions
```

Sold comps, sold count, and 90-day sell-through are not available yet through the current eBay API access.

Recommended future UI:

- Show active listing count now.
- Show returned/analyzed listing count now.
- Show sold comps status as unavailable until Marketplace Insights access is granted.
- If access is granted later, add 90-day sold count, median sold price, and sell-through ratio.

Phrase for eBay access request:

```text
Request production access to the Buy Marketplace Insights API, specifically item_sales/search, for Product Research / sold-comps lookup in a resale pricing workflow.
```

## Known Issues / Risks

- Active asking prices are not sold comps. UI/docs should keep that distinction visible.
- eBay Browse results can include irrelevant listings; scoring is conservative but still early.
- Identifier expansion is heuristic. It works for the tested `BXL1 0209` example but needs more real-world cases.
- Browser automation had clipboard issues in Codex, so some UI checks were verified through direct local API calls instead.
- Discogs may block server-side page pulls with a browser challenge. The Chrome helper and pasted pressing URL are the practical fallback paths.
- Seller Price Analyzer can hit eBay rate limits; it intentionally pauses on 429 and processes rows in batches.
- Hosted deployments require secrets to stay in Vercel environment variables, never committed files.

## Verification Commands

```powershell
npm test
npm run build
```

Both passed during the 2026-06-22 doc cleanup: 10 test files / 41 tests, and production build succeeded.

Local API smoke test passed on port 5190:

```text
manual "fleetwood mac rumours vinyl record" total=781 returned=781 pages=4
```

Manual dev run:

```powershell
npm run dev
```

Useful inputs:

- Manual: `fleetwood mac rumours`
- Catalog: `BXL1 0209`
- Manual: `QUAH Jorma Kaukonen`
- Demo/mock barcode: `012345LOW`
- Demo/mock barcode: `999999RARE`

## Files Most Relevant For Next Session

- `src/server/marketplaceApi.ts`: shared server-side eBay token minting, Browse API query, identifier expansion, Discogs lookup, and Product Research URL generation.
- `vite.config.ts`: local Vite `/api/ebay/search` middleware that calls the shared server module.
- `api/ebay/search.ts`: hosted Vercel serverless function for `/api/ebay/search`.
- `vercel.json`: Vercel build/output/function config.
- `HOSTING.md`: hosting setup notes and environment variable checklist.
- `src/lib/ebay/types.ts`: shared marketplace/search types.
- `src/lib/ebay/client.ts`: browser-side client calling local endpoint.
- `src/lib/scoring/scoreRecord.ts`: GREEN/YELLOW/RED scoring.
- `src/components/SearchInputPanel.tsx`: barcode/catalog/manual/image inputs and condition selector.
- `src/components/PriceClusterSummary.tsx`: displays price summary and query/source summary.
- `README.md`, `DECISIONS.md`, `TEST_PLAN.md`, `DATA_MODEL.md`, `PROJECT_BRIEF.md`: updated docs.

## Suggested Next Steps

1. Add more catalog/barcode real-world fixtures and tune identifier expansion from actual scanning sessions.
2. Request eBay Marketplace Insights API access for sold comps if sold-through data becomes important.
3. Consider moving saved Bulk Buy batches from localStorage into durable cloud storage if multi-device batch recall becomes important.
4. Keep the hosted Chrome extension zip updated any time files in `browser-extension/discogs-stats-helper` change.

## Discogs Status

DISCOGS_USER_TOKEN is configured locally. Discogs release search + marketplace stats are wired into the local API and Price Cluster panel. Verified with catalog BXL1 0209: Discogs returned a high-confidence Quah match, lowest marketplace price, number for sale, have/want counts, and a warning that median/sold-history price is unavailable from current API responses.


## Product Research Link

The local API now returns marketSnapshot.ebayResearchUrl and ebayResearchKeywords. The UI renders an Open eBay sold research button in PriceClusterSummary. The URL targets Seller Hub Product Research SOLD tab for 90 days, vinyl category 176985, limit 50, and prefers expanded artist/title keywords for catalog/barcode lookups. Verified BXL1 0209 generated keywords quah jorma kaukonen tom hobson.

## Boz Scaggs / Low-End Pricing Update

`BOZ SCAGGS Slow Dancer` exposed that broad median active listing price is not enough for common records. Scoring now uses `averageCheapestTenTotalPrice`, calculated from the cheapest title-matching comparable listings for manual artist/title searches. Candidate tiles are sorted low-to-high from `decision.topListings`, which is now built from the cheapest relevant listings instead of the API's original order. Local smoke test returned 200 eBay listings for Boz, with cheapest visible totals starting at 1.99, 2.99, 2.99, 3.99, 4.79.

The saved Discogs HTML showed page-visible sales stats for release 2165798: Last Sold Jan 25, 2026; Low $0.63; Median $2.70; High $33.26. The official release and marketplace stats API responses currently provided current marketplace lowest price and number for sale, but not those historical low/median/high sales values.

## ECM Catalog Matching Update

`ECM 1 1216` exposed that Discogs `catno` search can return later reissues before the intended catalog variant. Catalog-result ranking now scores normalized catno equality/containment, matching catalog tokens, standalone series number `1`, and plausible original year. Local API smoke test for `ECM 1 1216` returned Discogs `ECM-1-1216`, `Offramp`, release 7654911, confidence high, year 1982. eBay returned 112 merged listings with cheapest active totals starting at 10, 10.69, 10.99, 11.33.

## Barcode Discogs-To-eBay Expansion

`07599254741` exposed that eBay GTIN search can return zero listings while Discogs correctly identifies the release. The API now runs a Discogs-derived eBay fallback query for identifier searches when eBay cannot derive an artist/title expansion. Local smoke test: primary eBay barcode GTIN total=0, Discogs matched `Peter Cetera - Solitude / Solitaire`, fallback eBay query returned 75 listings, and Product Research keywords became `Peter Cetera Solitude / Solitaire`.

## Speed Mode

`SearchInputPanel` now has a Speed Mode toggle for barcode-only scanner sessions. When enabled, it focuses/selects the barcode input immediately, disables catalog/manual/image controls, and focuses/selects the barcode input again when `isSearching` transitions from true to false. This supports scan, glance, scan, glance workflows.

## Bulk Buy Scanner

Bulk Buy is a secondary lookup page at `#/bulk-buy`, linked from the top navigation. The default `#/scanner` route stays in normal triage mode and does not add rows to a bulk batch. On the Bulk Buy route, every scan/search adds a row to the Bulk Buy ledger. The row stores the scan order, album/title, new/used condition, category, reference price, recommended buy amount, best-case sale price, estimated fees/taxes/shipping supplies, and estimated profit.

Bulk Buy pricing lives in `src/lib/bulkBuy/calculateBulkBuy.ts`. The reference price is the lower of Discogs sales/market median and eBay average cheapest-10 active price. Under `$5`, the buy price is a flat `$0.50`; otherwise it is `40%` of the reference price. Sale estimates and profit math round down to the nearest `$0.50`. Fees include marketplace fee plus a 5% advertising fee, and tax uses the self-employment tax estimate on post-cost profit.

The ledger UI lives in `src/components/BulkBuyLedger.tsx`. It supports sortable columns, adjustable widths, delete row, click row to restore the middle review column, running totals, average buy per record, CSV download, reset, and named saved batches. Saved batches use browser localStorage via `src/lib/bulkBuy/batches.ts`, so they are local to the browser/device for now.

## Manual Discogs Sales Stats Import

Discogs page-visible sales statistics (Last Sold, Low, Median, High) are not available in the official API response currently used by the app, and automatic page scraping was avoided because Discogs terms restrict scraping/data extraction and sales-history marketplace data. The UI now accepts user-provided Discogs Statistics text or saved HTML/XML/text in `PriceClusterSummary`. Parser lives in `src/lib/discogs/parseSalesStats.ts`. Imported stats are stored on `discogs.salesStats`, displayed in the Discogs panel, and `scoreRecord` uses imported Discogs sales median to block GREEN when the median is at or below the configured threshold.

## Discogs Sales Stats Pull

David explicitly accepted one-release-at-a-time page pulls because Discogs median is a key pricing signal. The app now adds `/api/discogs/stats` for hosted Vercel and matching local Vite middleware. It fetches the matched Discogs release URL/ID, parses Last Sold/Low/Median/High from page HTML with `parseDiscogsSalesStats`, and stores the result as `discogs.salesStats` with source `page_fetch`. `PriceClusterSummary` auto-attempts the pull once per matched release and includes a Pull Discogs Data retry button. If Discogs returns a Cloudflare/browser challenge, the API returns a clear error and the manual paste/file import remains the fallback.

## Discogs Browser Helper Extension

Companion Chrome extension lives in `browser-extension/discogs-stats-helper`. Install/reload via Chrome `chrome://extensions` -> Developer mode -> Load unpacked. Background-helper mode was attempted but proved less reliable than the original visible helper flow. `PriceClusterSummary` now waits until a Discogs release URL is available, waits 500ms, then automatically opens the visible Discogs helper window with hash params `recordScanner=1`, `recordScannerOrigin`, and a one-time token. The Discogs content script parses Last Sold/Low/Median/High from `#release-stats` or the visible Statistics block and posts results back to the opener. App accepts only messages with the matching token and stores the stats as source `browser_extension`. Browser-helper median is a hard threshold signal in `scoreRecord`: above threshold GREEN/100%, at or below threshold RED/100%.

The production app header includes Download Chrome Extension, which serves `public/downloads/record-scanner-discogs-helper.zip`. Rebuild that zip from `browser-extension/discogs-stats-helper` whenever the extension source changes.

## Hosting

Marketplace API logic lives in `src/server/marketplaceApi.ts`. Local dev works through Vite middleware, and hosted Vercel deploys use the routes in `api/`. `vercel.json` is present, `.vercel/` is ignored, and `HOSTING.md` documents the environment variables and deployment checks.

## Seller Price Analyzer

The merged Seller Price Analyzer lives at `#/seller-prices`. It does not alter scanner inputs or scanner scoring flow. The page pulls active seller listings read-only through `POST /api/ebay/seller-listings`, then analyzes each listing title with the existing `/api/ebay/search` active-market endpoint. The seller endpoint uses POST so Vite dev does not serve the matching `api/ebay/seller-listings.ts` source file as transformed JavaScript.

Required optional env for real seller pulls:

```env
EBAY_USER_REFRESH_TOKEN=...
```

`EBAY_USER_ACCESS_TOKEN` is still accepted as a temporary fallback, but the durable setup is the refresh token above plus the existing `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`. The seller endpoint mints and caches short-lived user access tokens from the refresh token before calling Trading API `GetMyeBaySelling`.

Recommendations use active eBay cheapest-10 average and active comparable count. More than 25% above cheapest-10 average is high, more than 20% below is possible underpricing, 50+ active comps is crowded, and 150+ is very crowded. No eBay listing mutation endpoints were added.

The analyzer can pause after the current in-flight lookup, resume pending rows later, filter by recommendation status, sort by status/current price/delta/active comps, and download the currently visible rows as CSV. Seller listing parsing captures both eBay `SKU` and Selling Manager `CustomLabel`; CSV `sku` falls back to `custom_label` when no separate SKU exists.

Seller analyzer rows are cached in browser localStorage under `record-scanner-seller-price-analyzer-v1`, including completed analysis, active comp snapshots, proposed price, change note, and tag-for-change state. Clicking a compact spreadsheet row opens an in-page analytics panel; eBay links live inside that panel so row clicks no longer navigate away from the analyzer.

The seller page can also import a saved browser snapshot CSV from the previous analyzer export shape: `title,item_url,meta,your_price,cheapest_10_average,delta,active_comps,recommendation,reason`. This restores analyzed rows without new Browse calls and merges by item ID/title with currently cached active listings so SKU/custom label metadata is retained when available.

To reduce eBay Browse 429s, seller analysis uses `searchProfile: "seller-pricing"` instead of the full scanner lookup. That profile skips Discogs, requests `sort=price`, caps each row at 50 returned active comps, and preserves eBay's reported active total count. The UI analyzes 25 pending rows per click, waits 2.5 seconds between rows, and auto-pauses when eBay returns 429.

Seller listing loads are chunked through `POST /api/ebay/seller-listings` with `pageNumber` and `maxPages`. The browser client requests five Trading API pages at a time, which avoids Vercel function timeouts for inventories around 5,000 active listings.

