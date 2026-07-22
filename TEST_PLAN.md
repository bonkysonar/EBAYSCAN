# Test Plan

## Manual Flow

1. Run `npm install`.
2. Create `.env.local` with `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` if testing real eBay lookup.
3. Run `npm run dev`.
4. Leave Condition set to Used, enter `fleetwood mac rumours` in manual mode, and press Enter. Expect real eBay used-condition results if the token is valid.
5. Enter `BXL1 0209` in catalog-number mode and press Enter. Expect a source summary showing both a catalog-number query and an expanded artist/title query if eBay returns enough title clues. If `DISCOGS_USER_TOKEN` is configured, expect a Discogs match with lowest price and for-sale/have/want counts.
6. Enter `012345LOW` in barcode mode and press Enter. Expect real eBay lookup if token is valid; explicit mock fallback should classify this demo input as RED skip if real lookup fails.
7. Upload an image and verify the image path uses mock data with an image-placeholder warning.
8. Switch Condition to New and Both and verify searches still run.
9. Turn on Speed Mode. Verify the barcode input receives focus immediately, catalog/manual/image inputs are disabled, scanning/submitting a barcode works, and focus returns to the barcode input after the result appears.
10. With helper v0.3 installed, run a Discogs match and verify the first result opens one visible Discogs helper window. Complete any browser challenge and verify the stats return to Record Scanner automatically.
11. Paste or upload saved Discogs Statistics text/HTML containing Last Sold, Low, Median, and High. Verify the Discogs panel displays the imported values and a below-threshold Discogs median prevents GREEN.
12. Scan a second Discogs match and verify the existing helper window is reused instead of creating another tab/window. Verify a successful read returns focus to the scanner input.
13. Close the helper window, click Reconnect Discogs Window, and verify helper v0.3 creates one replacement window. Verify an installed v0.2 helper produces an update message.
14. Adjust the threshold in Settings and verify the result changes after searching again.
15. Verify the default `#/scanner` page does not show the Bulk Buy ledger or add scans to a bulk batch.
16. Open `#/bulk-buy` from the top navigation. Verify it uses the same lookup controls as the scanner and shows the Bulk Buy ledger.
17. Paste a different Discogs `/release/` URL into Discogs pressing URL. Verify the visible Discogs release updates immediately even if the stats pull is blocked.
18. Verify the Bulk Buy ledger adds each Bulk Buy scan/search in stable sequential order.
19. Sort Bulk Buy by buy, sell, profit, album, condition, category, and reference price. Verify the Order column values do not change.
20. Resize Bulk Buy table columns and verify the table remains usable.
21. Delete a Bulk Buy row and verify totals update.
22. Click a Bulk Buy row and verify the middle review column restores that record's result.
23. Save a named Bulk Buy batch, load it from the Saved selector, download CSV, and reset the batch.
24. Verify Bulk Buy values round down to the nearest `$0.50`, show `$0.50` buys under `$5`, and include marketplace fee, 5% ad fee, shipping supplies, and self-employment tax in profit.
25. Open `#/seller-prices`. Verify the Seller Price Analyzer page is separate from the scanner and does not change scanner inputs/results.
26. With `EBAY_USER_ACCESS_TOKEN` configured, click Load Active Listings and verify active store listings load read-only.
27. Click Analyze Prices and verify rows are analyzed incrementally with current price, cheapest-10 average, delta percent, active comp count, and recommendation.
28. Click Pause Analysis while analysis is running. Verify the current row finishes, no new row starts, and Analyze Next continues pending rows without re-running completed rows.
29. Leave `#/seller-prices` and return. Verify active listings and completed analysis are restored from browser storage.
30. Click a compact seller row. Verify an analytics panel opens instead of navigating to eBay.
31. In the analytics panel, tag a row for change, enter a proposed price/note, close and reopen the row, and verify the values persist.
32. Filter by status and verify only matching analyzer rows remain visible, including tagged rows.
33. Sort by current price, delta, status, and active comps in both directions.
34. Click Download CSV and verify the export includes `sku`, `custom_label`, `item_id`, proposed price, change note, pricing recommendation, delta, active comp count, and item URL.
35. Click Import Snapshot CSV with a saved browser snapshot export. Verify analyzed rows restore without running eBay Browse calls, and SKU/custom label values are preserved when matching active listings were already loaded.

## Retail Arbitrage Manual Flow

1. Run a small diagnostic source scan:

   ```powershell
   node scripts/runRetailArbitrageScan.mjs --sources=<source-id-1>,<source-id-2> --skipUpload
   ```

   Verify the timestamped artifact is `phase: "scan"` and `publicationStatus: "draft"`, has a safe `runId`, and contains a `sourceReports` entry for every requested source. Catalog and sale-page health must be reported separately, including requested/resolved URLs and page errors.

2. Run a default sale-radar scan. Verify candidates are ranked globally before the cap, more than one source can survive the queue limit, obvious navigation/merch/non-vinyl rows are absent, and sale alerts remain separate from record-level opportunities. Include high-noise fixtures for Walmart, Barnes & Noble, and Cheap Vinyl: ISBN books, category/filter links, record players, and `Vinyl` apparel must be rejected, while an explicitly identified vinyl LP remains eligible. Verify `/ea`, `/lb`, shipping, savings, and coupon amounts cannot become the purchase price; retailer taxonomy and escaped HTML entities must not pollute the artist/title or eBay query. For Walmart, verify the structured `$10`/`$15`/`$20` lanes retain first-party records at or below `$20` even without a markdown, paginate, deduplicate, and recover stale search-result inventory through bounded product-page availability checks.

3. On a Shopify source, verify the scan follows multiple JSON pages when available, ignores unavailable variants, and retains compare-at price, currency, SKU, barcode, variant identity, inventory, and collection context. On a mixed CD/LP product, only the LP variant may become a vinyl candidate and it must retain the LP's price and exact variant URL. Include `2LP`, `2xLP`, and `2-LP` variant spellings under contradictory CD/Vinyl product taxonomy.

4. With eBay credentials configured, verify active enrichment paginates, inspects all returned pages within its cap, and reports exact matched supply separately from raw listings inspected. A broad eBay result total must not be labeled exact supply.

5. Build a Product Research plan:

   ```powershell
   node scripts/prepareArbitrageResearchPlan.mjs exports\arbitrage-finds\<scan-file>.json --max=40
   ```

   Verify every entry is keyed by stable find ID and carries normalized query variants, source identity, research URL, and edition terms. The plan must not require title-specific source-code edits.

6. Curate the scan with a raw Product Research result:

   ```powershell
   node scripts/curateRetailArbitrageRun.mjs exports\arbitrage-finds\<scan-file>.json exports\arbitrage-finds\<raw-research-file>.json YYYY-MM-DD
   ```

   Verify bundles, merch, damaged, used, and conflicting-edition rows are excluded. Pending/failed/no-row research must remain a validation state instead of becoming a false reject.

7. Verify aggregate Product Research rows can populate price and aggregate sold fields but cannot, by themselves, satisfy the dated 30/90/365-day velocity gate or produce `BUY`.

8. Inspect known fully evidenced records. Verify a fast mover can qualify at the smaller-margin profile, a balanced record uses the middle thresholds, and a slower record requires the higher-margin profile. Every `BUY` must still require condition-matched dated velocity, fresh sold and active evidence, confident artist/title/edition matches, complete exact active supply, an acceptable estimated turn, full-ledger economics, and sufficient priority. A same-title/different-artist local sale must remain unvalidated. A complete exact search above the active-listing ceiling must hard-reject even when sold research is pending. Two aggregate sales over three years against roughly twenty active listings must not become recent velocity or a buy.

9. Inspect the cost ledger. Verify it includes purchase, tax, inbound shipping, FX/duty when supplied, marketplace and promoted-listing fees, outbound shipping, packaging, returns reserve, and other configured costs. Missing inbound shipping must use the `$5` default reserve; an explicit zero must preserve known free shipping. Unknown currency and stale/missing foreign conversion must withhold USD profit/ROI and stay `REVIEW`; a fresh dated rate is required before economics can pass.

10. Open `#/retail-arbitrage`. Verify the default queue shows active records sorted by priority rather than appearing empty when no automatic BUY exists. Verify the table exposes priority band/score, strategy, cost, profit per 30 days, estimated turn, recent/long-term velocity, supply, evidence status, and source. Verify the detail panel shows all three adaptive profiles, score breakdown, gates, 30/90/365-day and long-window evidence, sell-through, supply horizon, evidence freshness/confidence, and test quantity.

11. Record bought, listed, sold, returned, not-for-me, too-slow, margin-too-thin, and false-positive outcomes. Reload the page and verify local outcome feedback persists and routes rows into the corresponding local queue. Change the offer price and verify the older dismissal/outcome no longer hides it. Verify the page polls every five minutes, refreshes immediately after focus or visibility restoration, re-scores freshness every minute, and retains the last verified publication when a later refresh fails.

12. Open `#/site-wide-sales`. Verify New and Changed lead the page, Ongoing/Evergreen/Unknown/Ended are separate, simultaneous campaigns from one retailer are retained, and failed source checks produce Unknown rather than Ended. Duplicate title/body fragments for the same campaign must collapse, while distinct discounts or promo codes remain separate.

13. Record confirmed, false-positive, expired, and wrong-scope campaign feedback. Reload and verify the feedback persists locally. Reopen, materially change, or recover an unknown campaign and verify the old outcome is released. Verify current embedded campaigns render before optional history, stalled history times out, and mismatched history run IDs cannot replace the current run.

14. Verify publication safety:

   ```powershell
   node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\<scan-file>.json --dryRun
   node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-YYYY-MM-DD.json --dryRun
   ```

   The raw scan must be rejected as non-final. The curated schema-version-2 payload must pass the dry run with its `runId`. A legacy payload with explicit draft phase/status must also be rejected even if its filename looks final. When no latest pointer exists, legacy fallback must choose by lifecycle observation time rather than file modification/upload time.

## Automated Tests

Run `npm test`.

Coverage should include:

- Low-value obvious records score RED.
- High-value obvious records score GREEN.
- Mixed or ambiguous results score YELLOW.
- Overlapping catalog-number results stay YELLOW.
- Risk keywords prevent RED skip.
- Manual artist/title searches calculate low-end value from the cheapest title-matching comparable listings.
- Visible candidate listings are sorted from lowest total price upward.
- Real eBay searches with more than 200 active matches paginate beyond the first page and report pages/returned counts in the source summary.
- Discogs sales statistics parser extracts Last Sold, Low, Median, and High from pasted text or saved HTML.
- Discogs price-suggestion selection prefers Very Good (VG), falls back through usable conditions, and never labels the result as historical median.
- A Discogs match automatically requests the persistent helper unless historical stats are already present.
- The extension background creates one helper window, reuses it for the next release, and returns focus to the scanner after success.
- Imported Discogs sales median prevents GREEN when it is at or below the configured threshold.
- Browser-helper Discogs median acts as the hard threshold decision with 100% confidence.
- Best-effort Discogs page pull reports blocked/failed page fetches without fabricating sales stats.
- Default scanner route does not show or populate the Bulk Buy ledger.
- Bulk Buy math rounds down to half-dollar increments and applies the low-price flat buy, title-match markdowns, fees, ad fee, shipping supplies, and tax calculations.
- Bulk Buy table sorting, deletion, CSV download, named save/load, and row click-to-review behavior.
- Pasted Discogs pressing URL fallback updates three different releases even when stats pulls are blocked.
- Seller Price Analyzer flags listings more than 25% above active eBay cheapest-10 average.
- Seller Price Analyzer flags possible underpricing more than 20% below active eBay cheapest-10 average.
- Seller Price Analyzer flags crowded pricing risk at 50+ active comps and very crowded risk at 150+ active comps.
- Seller Price Analyzer marks too-few-comps cases as NEEDS_REVIEW.
- Seller Price Analyzer uses the seller-pricing lookup profile, limiting Browse calls to the cheapest active comps and auto-pausing on 429 rate limits.
- Seller listing XML parser maps GetMyeBaySelling ActiveList XML to normalized seller listings.
- Seller listing parser captures SKU and CustomLabel for export workflows.
- Seller browser snapshot CSV import restores analyzed rows and preserves matching SKU/custom label metadata.
- Retail source scanning preserves source metadata and reports honest per-page catalog/sale health.
- Polite HTTP scheduling enforces concurrency, per-host pacing, timeout, retry, and backoff behavior.
- Candidate filtering rejects high-noise marketplace/category rows, ISBN books, digital products, turntables, apparel/merch, and conflicting formats while retaining credible soundtracks, unknown-artist vinyl, and explicit record products.
- General-retailer parsing rejects unit/shipping/promo prices, decodes HTML entities and URLs, produces usable artist/title text, and admits only credible exploratory compare-at markdowns.
- Candidate selection ranks globally and applies source diversity/exploration quotas before the final limit.
- Shopify catalog discovery paginates and evaluates available variants individually while preserving compare-at price, currency, identifiers, inventory, collection context, and exact variant URL.
- Active eBay enrichment paginates, removes retailer taxonomy from queries, distinguishes exact matched supply from raw inspected listings, reports match confidence/search completeness, and times out stalled requests.
- Local sold-history building preserves quantity-weighted dated 30/90/365-day velocity and condition evidence and does not validate same-title rows from another artist.
- eBay sold-history synchronization paginates bounded Fulfillment/Finances slices, sanitizes persisted output, joins fees/refunds/labels without buyer data, refreshes an overlap idempotently, and builds artist aggregates.
- The canonical arbitrage evaluator applies fast-turn, balanced, and high-margin profiles, returns `BUY` only when one profile plus evidence/priority gates pass, and hard-rejects known excessive exact supply.
- Aggregate Product Research rows cannot masquerade as dated recent velocity.
- Product Research planning and curation are find-ID based, reject incompatible rows generically, and keep pending research in review.
- The full arbitrage ledger includes acquisition costs, marketplace/advertising costs, fulfillment, packaging, and returns reserve; unknown inbound shipping uses the default reserve and foreign economics require fresh conversion evidence.
- Scan and enrichment payloads cannot be published as latest; explicit legacy drafts remain drafts, final publication is immutable and idempotent by `runId`, and latest/fallback selection uses lifecycle observation time.
- Sale campaign lifecycle covers duplicate-fragment collapse, distinct simultaneous offers, New, Changed, Ongoing, Evergreen, Unknown, reopening, and Ended after repeated healthy misses.
- `/api/arbitrage/history` filters campaign history by source/status and returns a bounded event list.
- Retail-record and sale-campaign outcome feedback persists locally without mutating marketplace data, but expires when the material offer/campaign observation changes.
- Retail and sale pages poll for current publications, retain the last verified data on transient refresh failure, and reject mismatched/late optional history.
- Barcode, catalog-number, manual, and image inputs share the marketplace interface.
- Price normalization.
- Title normalization.
- Consensus extraction.

## API Mock Testing

Mocks should remain deterministic and credential-free. Add fixture cases whenever scoring behavior changes.

## Future Real eBay Testing

Use official eBay APIs only. Keep unit tests independent from credentials. Add integration tests behind environment-gated configuration once token minting is automated.

## Hosted Testing

Before deploying, run `npm test` and `npm run build`.

For the arbitrage pipeline, also run:

```powershell
npx vitest run src/tests/candidatePipeline.test.ts src/tests/shopifyCatalog.test.ts
npx vitest run src/tests/arbitrageEvaluation.test.ts src/tests/productResearchCuration.test.ts
npx vitest run src/tests/saleCampaignLifecycle.test.ts src/tests/arbitrageFindsApi.test.ts
node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-YYYY-MM-DD.json --dryRun
```

After a Vercel deployment, verify:

- Manual search returns real eBay results from `/api/ebay/search`.
- Catalog search still performs identifier expansion.
- Barcode search still accepts scanner-style Enter submit.
- Condition filter defaults to Used.
- Discogs data appears only when `DISCOGS_USER_TOKEN` is configured.
- Discogs VG price guide appears automatically when the authenticated price-suggestions endpoint returns data.
- Helper v0.3 opens one visible Discogs window, allows normal browser verification, and reuses that window across scans.
- The Download Chrome Extension link returns `record-scanner-discogs-helper.zip`.
- `/api/arbitrage/latest` returns only a final published run and never a raw scan/enrichment artifact.
- `/api/arbitrage/history` returns campaign states and transitions, including Unknown on source failure and Ended only after healthy misses.
- `#/retail-arbitrage` opens on the priority-sorted active queue and uses the same evaluator/reason codes as the scan output.
- `#/site-wide-sales` leads with New/Changed and shows honest source coverage.
- No secrets appear in browser source, network payloads, or committed files.


