# Handoff

Last updated: 2026-07-16

## Current State

- Branch: `main`
- Latest committed revision at the start of this handoff: `8e4a7a6 Reuse visible Discogs helper window (#8)`
- Production app: `https://ebayscan.vercel.app`
- The Retail Arbitrage overhaul described below is local work in the current working tree. This handoff does not claim that those changes were committed or deployed.
- Do not commit `.env.local`; it contains credentials and is ignored.

The committed product includes the default Scanner, optional Bulk Buy page, Seller Price Analyzer, hosted Vercel API routes, Discogs helper extension support, and a hosted Chrome helper zip download. The local worktree also contains the Retail Arbitrage and Site-wide Sales overhaul.

## 2026-07-16 Retail Arbitrage Overhaul

The retail scanner is no longer an active-price-first shortlist or a latest-only sale snapshot.

- Source scans retain the full source metadata and honest page-level catalog/sale health, including fallback URLs, resolved URLs, partial coverage, blocks, failures, timeouts, retries, and per-page errors.
- Shopify discovery paginates JSON catalogs, evaluates available variants individually, and preserves compare-at price, currency, SKU, barcode, inventory, variant identity, and collection context. A cheap CD variant can no longer price the LP variant, and explicit `2LP`/`2xLP`/`2-LP` identity survives active enrichment and downstream filters despite mixed parent-product taxonomy.
- Obvious navigation, promotion-only, non-record, alternate-format, accessory, merch, and general-retail rows are rejected before expensive enrichment. High-noise marketplaces require explicit product-level vinyl evidence; ISBNs, digital products, turntables, apparel, and conflicting formats are fenced out.
- General-retailer parsing rejects per-unit prices such as `/lb` and `/ea`, decodes escaped titles and URLs, removes retailer taxonomy from record titles and eBay queries, and admits high-confidence exploratory compare-at markdowns without treating small markdowns as sale-radar finds.
- Candidates are ranked globally before the cap. Per-source quotas and exploration slots prevent one feed from crowding out every other retailer.
- Active eBay enrichment paginates and distinguishes raw listings inspected from exact matched active supply, search completeness, match confidence, and evidence capture time. OAuth/Browse requests and the enrichment subprocess are bounded by timeouts.
- eBay Fulfillment and Finances history now refreshes automatically from the existing user token, with bounded date slices and a 14-day overlap. It persists sanitized order-line evidence, artist aggregates, fee/refund attribution, and account-level shipping-label calibration without buyer data or raw API payloads. CSV import remains an optional fallback.
- Walmart has a dedicated structured adapter with `$10`/`$15`/`$20` absolute-price lanes, multiple sorts, pagination, first-party filtering, and product-page availability rechecks. Live testing showed anonymous search results falsely marked shippable low-price records such as Jimi Hendrix as out of stock; the detail recheck recovered candidates correctly.
- One canonical evaluator is shared by the scan, curator, and UI. `BUY` requires dated sold velocity, exact supply, fresh and confident matches, a qualifying estimated turn, full-ledger economics, and sufficient priority. Fast Turn, Balanced, and Higher Margin profiles allow smaller margins only for faster inventory. A complete exact search above the active-listing ceiling is an immediate supply reject even if sold research is still pending.
- Sam & Dave is now a regression case: two aggregate sold observations over three years against roughly twenty active listings cannot become recent velocity or a buy recommendation.
- The cost ledger includes tax, inbound shipping, FX/duty, marketplace fees, promoted-listing fees, outbound shipping, packaging, returns reserve, and other configured costs. It reserves `$5` inbound by default unless free shipping is explicit; unknown currency or stale/missing foreign conversion withholds USD economics.
- Aggregate Seller Hub Product Research rows can support sold-price research but cannot prove recent velocity or create `BUY` by themselves.
- Product Research planning/curation is generic and keyed by stable find ID. The daily workflow must not patch title-specific allowlists into the curator.
- Raw scan and enrichment outputs remain drafts. Only a curated schema-version-2 final payload can publish; publication writes an immutable run and advances the latest pointer atomically. Explicit legacy drafts cannot masquerade as finals, and pointerless fallback uses observation time rather than file/upload time.
- Sale offers are tracked as campaigns with `new`, `changed`, `ongoing`, `evergreen`, `unknown`, and `ended` states. Duplicate page fragments collapse into one campaign observation, distinct simultaneous offers remain separate, failures become Unknown, and Ended requires repeated healthy misses.
- `/api/arbitrage/history` exposes campaign history in addition to `/api/arbitrage/latest`.
- Retail Arbitrage opens on the priority-sorted active queue so runs without an automatic BUY do not look empty. It separates Buy now, Needs validation, Watch, Reject, tracked outcomes, and user-rejected records. Details show priority breakdown, estimated turn, profit per 30 days, long-term demand/supply, and all three adaptive buy options. Site-wide Sales leads with New/Changed and collapses quieter lifecycle states.
- Record outcomes (bought, listed, sold, returned, not for me, too slow, margin too thin, false positive) and campaign feedback (confirmed, false positive, expired, wrong scope) are browser-local and scoped to the observed offer/campaign version and lifecycle health so changed prices, reopened sales, and recovered unknown campaigns return to review.

The remaining user input is a short narrated screen capture; 5–10 dense minutes is enough. A new eBay CSV and a single hard minimum-profit rule are no longer required.

See `RETAIL_ARBITRAGE.md` for operating details and `TEST_PLAN.md` for the verification flow.

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

Marketplace-wide sold comps, sold count, and 90-day sell-through are not available through the current application-token API access. Retail Arbitrage can use dated local order history as evidence for this account's own sales and can ingest reviewed Seller Hub Product Research rows.

Important evidence boundary:

- Active asking prices are supply/research data, not sales proof.
- A broad Browse total is not exact active supply until title/edition matching is complete.
- Product Research aggregate quantities plus one latest-sale date do not show dated 30/90/365-day unit distribution.
- Only dated, condition-matched transactions can satisfy the automatic velocity gate.
- Missing, stale, or aggregate-only evidence routes the candidate to REVIEW instead of manufacturing a BUY or false REJECT.

Phrase for eBay access request:

```text
Request production access to the Buy Marketplace Insights API, specifically item_sales/search, for Product Research / sold-comps lookup in a resale pricing workflow.
```

## Known Issues / Risks

- Active asking prices are not sold comps. UI/docs should keep that distinction visible.
- eBay Browse results can include irrelevant listings; scoring is conservative but still early.
- Exact active supply depends on a complete paginated search and a confident title/edition match; incomplete or rate-limited searches stay validation work.
- Many retailers block automation, expose incomplete HTML, or change page structure. Coverage metrics must remain honest and Unknown must not be interpreted as no sale.
- Local order history reflects this seller's transactions, not marketplace-wide demand.
- Seller Hub Product Research aggregate rows do not prove recent velocity.
- Identifier expansion is heuristic. It works for the tested `BXL1 0209` example but needs more real-world cases.
- Browser automation had clipboard issues in Codex, so some UI checks were verified through direct local API calls instead.
- Discogs may block server-side page pulls with a browser challenge. The Chrome helper and pasted pressing URL are the practical fallback paths.
- Seller Price Analyzer can hit eBay rate limits; it intentionally pauses on 429 and processes rows in batches.
- Hosted deployments require secrets to stay in Vercel environment variables, never committed files.

## Coverage Findings From the Full Diagnostic

The full local diagnostic artifact is `exports/arbitrage-finds/full-diagnostics/retail-arbitrage-2026-07-16T07-16-46-067Z.json`.

- 126 configured sources were attempted.
- 8 completed without partial/error status, 48 were partial/degraded, and 70 were blocked/failed.
- 31 sources had usable sale-page coverage; 95 had sale-page failures.
- The scan extracted 2,172 raw candidates, selected 60 product candidates, and tracked 11 sale campaigns before sold-research curation.
- Among 42 priority-1 sources, 2 completed cleanly, 6 were degraded, and 34 were blocked.

The static-looking sale list was primarily a coverage and lifecycle problem, not proof that retailers never changed their offers. The UI now exposes these limits instead of hiding them.

The current local final API response contains 73 visible entries after server-side safety filtering: 58 product candidates and 15 sale campaigns. Re-evaluated with evaluator v3, the product queue is 45 `REVIEW`, 13 `REJECT`, and 0 automatic `BUY`/`WATCH`. This is expected because the current run lacks dated sold-velocity proof for the remaining candidates; two records are already hard-rejected for excessive exact active supply.

A final Walmart/Barnes & Noble/Cheap Vinyl smoke run found 12 raw Walmart record candidates but only one credible sale-radar markdown after per-unit-price cleanup. Active eBay enrichment inspected 256 listings, found 99 exact matches with a complete high-confidence search, and correctly classified that candidate as a supply hard-fail rather than a buy lead.

## Verification Commands

```powershell
npm test
npm run build
npx vitest run src/tests/candidatePipeline.test.ts src/tests/shopifyCatalog.test.ts
npx vitest run src/tests/arbitrageEvaluation.test.ts src/tests/productResearchCuration.test.ts
npx vitest run src/tests/saleCampaignLifecycle.test.ts src/tests/arbitrageFindsApi.test.ts
node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-YYYY-MM-DD.json --dryRun
```

Final local verification on 2026-07-16:

- `npm test`: 34 test files, 204 tests passed. The only console noise was jsdom's existing `Window.focus()` notice.
- `npm run build`: passed; Vite produced the production bundle.
- Runtime syntax checks passed for the scanner, enrichment, curator, uploader, evaluator, lifecycle, candidate, Shopify, retail-listing, and active-matching modules.
- Curated final upload dry-run passed for run `scan-2026-07-16T12-31-23-227Z`.
- A raw enriched scan was rejected by the uploader as a draft, as intended.
- Local `/api/arbitrage/latest` and `/api/arbitrage/history` smoke tests passed on port 5191 with matching run IDs.

General scanner API smoke test previously passed on port 5190:

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

- `scripts/runRetailArbitrageScan.mjs`: broad source scan, page health, candidate selection, sale observations, draft artifact, and active-enrichment handoff.
- `scripts/lib/candidatePipeline.mjs`: early record filtering, global ranking, source quotas, and exploration slots.
- `scripts/lib/retailListingParsing.mjs`: general-retailer price, entity, artist, title, and URL normalization.
- `scripts/lib/shopifyCatalog.mjs`: Shopify pagination targets and available-variant normalization.
- `scripts/lib/politeHttp.mjs`: request concurrency, host pacing, timeout, retry, and backoff.
- `scripts/enrichArbitrageActiveEbay.mjs`: paginated active search and exact title/edition supply matching.
- `scripts/buildSoldHistoryFromEbayCsv.mjs`: quantity-aware dated local sold evidence.
- `scripts/prepareArbitrageResearchPlan.mjs`: generic find-ID Product Research queue.
- `scripts/lib/productResearchCuration.mjs`: generic Product Research row matching and rejection rules.
- `scripts/curateRetailArbitrageRun.mjs`: final evidence merge and canonical evaluation.
- `scripts/uploadLatestArbitrageFinds.mjs`: final-only upload validation.
- `src/lib/arbitrage/evaluateOpportunity.mjs`: canonical BUY gates and full cost ledger.
- `src/lib/arbitrage/activeEbayMatching.mjs`: normalized active-search profiles and exact title/edition matching.
- `src/lib/arbitrage/reviewFeedback.ts`: observation-scoped local record and campaign outcomes.
- `scripts/lib/saleCampaignLifecycle.mjs`: campaign identity and lifecycle reconciliation.
- `src/server/arbitrageFindsApi.ts`: immutable final runs, atomic latest pointer, and history reads.
- `src/components/RetailArbitrage.tsx`: buyer queue, evidence/ledger detail, and local record outcomes.
- `src/components/SiteWideSales.tsx`: campaign lifecycle UI, coverage, history, and local campaign feedback.
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

1. Review source coverage weekly, prioritizing high-value retailers with repeated blocked/degraded checks and maintaining official feeds/adapters where available.
2. Calibrate candidate filters and decision thresholds from browser-local false-positive, bought, listed, sold, and returned outcomes.
3. Request eBay Marketplace Insights access if marketplace-wide dated sold transactions become available; do not weaken the velocity gate to substitute aggregate Product Research.
4. Verify and deploy separately when ready. After deployment, smoke-test `/api/arbitrage/latest`, `/api/arbitrage/history`, `#/retail-arbitrage`, and `#/site-wide-sales`.
5. Continue adding catalog/barcode fixtures, consider durable storage for Bulk Buy batches if needed, and rebuild the hosted Chrome extension zip whenever its source changes.

## Discogs Status

DISCOGS_USER_TOKEN is configured locally. Discogs release search + marketplace stats are wired into the local API and Price Cluster panel. Verified with catalog BXL1 0209: Discogs returned a high-confidence Quah match, lowest marketplace price, number for sale, have/want counts, and a warning that median/sold-history price is unavailable from current API responses.


## General Scanner Product Research Link

The local API now returns marketSnapshot.ebayResearchUrl and ebayResearchKeywords. The UI renders an Open eBay sold research button in PriceClusterSummary. The URL targets Seller Hub Product Research SOLD tab for 90 days, vinyl category 176985, limit 50, and prefers expanded artist/title keywords for catalog/barcode lookups. Verified BXL1 0209 generated keywords quah jorma kaukonen tom hobson.

That general-scanner link is separate from the Retail Arbitrage evidence gate. Retail Arbitrage builds find-ID research plans with multiple normalized variants and treats Product Research rows as aggregate sold-price/repeat-row evidence only. They cannot establish dated velocity without transaction-level dates.

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

### 2026-07-13 automatic Discogs pricing route

Repeated helper navigations were not viable for scanner throughput and caused recurring browser challenges. Normal searches now call the documented authenticated Discogs `marketplace/price_suggestions/{release_id}` endpoint alongside the release lookup, select Very Good (VG) as the conservative used-record price guide, and return it on `discogs.suggestedPrice` / `discogs.suggestedPriceCondition`. The marketplace release response now supplies current lowest/for-sale values directly, avoiding a separate marketplace-stats API request.

The initial price-guide deployment stopped auto-launching the extension, but production later confirmed the configured token could not access that endpoint. The persistent v0.3 helper design below supersedes that no-auto-launch behavior.

### 2026-07-13 persistent visible helper v0.3

The price-suggestions endpoint was unavailable to the configured production Discogs token, while Vercel page pulls remained blocked by a 403 browser challenge. Helper v0.3 now restores automatic historical-stat retrieval through one reusable, visible Chrome popup. The extension stores helper and pending-request state in `chrome.storage.session`, waits up to five minutes for normal browser verification, focuses the helper only when it is first created or needs attention, and returns focus to the scanner after success.

`PriceClusterSummary` sends one helper request automatically for each matched release without stats. It detects and warns about pre-0.3 extension versions. The hosted zip must contain `manifest.json` version 0.3.0 and needs to be downloaded/unzipped/reloaded once on each Chrome profile; unpacked extensions do not update themselves from the hosted zip.

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

