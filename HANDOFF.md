# Handoff

Last updated: 2026-05-18

## Current Branch

- Branch: `feature/discogs-stats-import`
- Base/current pushed main commit: `15a343e Build record scanner MVP`
- Current feature work is uncommitted unless this file is committed later.
- Do not deploy unless David explicitly asks.
- Do not commit `.env.local`; it contains eBay credentials and is ignored.

## Product Semantics

The color meanings were intentionally flipped from the original brief:

- `GREEN`: likely worth processing/listing because pricing clusters above threshold.
- `YELLOW`: ambiguous or needs manual review.
- `RED`: likely safe to skip or move to bulk.

Default threshold is still `$5`.

## eBay Integration Status

Real active-listing lookup is wired through a local Vite dev-server endpoint:

- Browser client: `src/lib/ebay/client.ts`
- Local API/server middleware: `vite.config.ts`
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
- Hosted deployment is prepared for Vercel, but not deployed. Secrets must be set as server-side environment variables.

## Verification Commands

```powershell
npm test
npm run build
```

Both passed after the latest hosting-prep refactor.

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

1. Add a Market Snapshot component showing active listed total, returned/analyzed count, search plans used, and sold-comps status.
2. Commit the current feature branch once David is happy with the direction.
3. Add more catalog/barcode real-world fixtures and tune identifier expansion.
4. Import the GitHub repo into Vercel and set server-side environment variables when David is ready to deploy.
5. Request eBay Marketplace Insights API access for sold comps.

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

## Manual Discogs Sales Stats Import

Discogs page-visible sales statistics (Last Sold, Low, Median, High) are not available in the official API response currently used by the app, and automatic page scraping was avoided because Discogs terms restrict scraping/data extraction and sales-history marketplace data. The UI now accepts user-provided Discogs Statistics text or saved HTML/XML/text in `PriceClusterSummary`. Parser lives in `src/lib/discogs/parseSalesStats.ts`. Imported stats are stored on `discogs.salesStats`, displayed in the Discogs panel, and `scoreRecord` uses imported Discogs sales median to block GREEN when the median is at or below the configured threshold.

## Discogs Sales Stats Pull

David explicitly accepted one-release-at-a-time page pulls because Discogs median is a key pricing signal. The app now adds `/api/discogs/stats` for hosted Vercel and matching local Vite middleware. It fetches the matched Discogs release URL/ID, parses Last Sold/Low/Median/High from page HTML with `parseDiscogsSalesStats`, and stores the result as `discogs.salesStats` with source `page_fetch`. `PriceClusterSummary` auto-attempts the pull once per matched release and includes a Pull Discogs Data retry button. If Discogs returns a Cloudflare/browser challenge, the API returns a clear error and the manual paste/file import remains the fallback.

## Discogs Browser Helper Extension

Companion Chrome extension lives in `browser-extension/discogs-stats-helper`. Install/reload via Chrome `chrome://extensions` -> Developer mode -> Load unpacked. Background-helper mode was attempted but proved less reliable than the original visible helper flow. `PriceClusterSummary` now waits until a Discogs release URL is available, waits 500ms, then automatically opens the visible Discogs helper window with hash params `recordScanner=1`, `recordScannerOrigin`, and a one-time token. The Discogs content script parses Last Sold/Low/Median/High from `#release-stats` or the visible Statistics block and posts results back to the opener. App accepts only messages with the matching token and stores the stats as source `browser_extension`. Browser-helper median is a hard threshold signal in `scoreRecord`: above threshold GREEN/100%, at or below threshold RED/100%.

## Hosting Prep

Marketplace API logic was moved from `vite.config.ts` into `src/server/marketplaceApi.ts`. Local dev still works through Vite middleware, and hosted Vercel deploys can use `api/ebay/search.ts`. `vercel.json` is present, `.vercel/` is ignored, and `HOSTING.md` documents the environment variables and deployment checks.

