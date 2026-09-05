# Retail Arbitrage Scanner

This guide describes the record-buying workflow used by the Retail Arbitrage and Site-wide Sales pages.

## Purpose

The scanner has two related jobs:

1. Find individual new/sealed records that may sell quickly enough and profitably enough to buy for resale.
2. Track broad retailer campaigns without presenting the same unchanged sale as new every day.

A source check, a promising price, or an active eBay asking price is not a buy recommendation by itself. `BUY` is reserved for records that clear the canonical demand, supply, match, freshness, and economics gates.

## Source Catalog and Coverage

The source inventory lives in `src/lib/arbitrage/vinylShopSources.ts`. Each source can carry operational metadata such as priority, retailer type, sale likelihood, noise level, crawl type, default discount threshold, and source-specific minimum profit or ROI. The latest bounded live audit, repaired storefront routes, and known external limitations are recorded in `RETAIL_SOURCE_COVERAGE.md`.

Every scan preserves source and page health in `sourceReports`:

- Catalog and sale pages are reported separately.
- Requested and resolved URLs are retained, including homepage fallback and discovered same-store sale pages.
- Healthy, partial/degraded, blocked, and failed checks remain distinguishable.
- A failed source check produces unknown coverage; it does not prove that a sale ended or that the retailer had no useful records.
- Discovery feeds and aggregators remain labeled as leads until a retailer page confirms the offer.

The UI reports attempted, sale-page-capable, productive, parser-empty, blocked, and priority-source coverage. It also shows the server-assessed run-quality status and final-selection concentration. Counts describe what the scanner actually reached, not what it hoped to reach.

Requests use bounded concurrency, per-host pacing, timeouts, retries, and backoff. Active eBay token/Browse calls also have request deadlines, and the parent scan will stop a stuck enrichment subprocess instead of hanging indefinitely. Diagnostic runs can limit the source set without changing the catalog:

```powershell
node scripts/runRetailArbitrageScan.mjs --sources=source-id-1,source-id-2 --skipUpload
```

Source-limited runs cannot use full publication. The versioned `publicationMode: "source_updates"`, `sourceUpdateVersion: 1` contract can publish independently verified retailer observations, retain untouched sources at their original timestamps, and label partial coverage. The original full-catalog coverage gate is unchanged.

Useful scan controls include `--sourceConcurrency`, `--fetchRetries`, `--fetchRetryDelayMs`, `--hostDelayMs`, `--fetchTimeoutMs`, `--maxDiscoveredSalePages`, `--discoveryDetailLimit`, `--discoveryConcurrency`, and `--ebayPurchaseMaxDetailRequests`. Defaults favor coverage over speed: four sources run concurrently, same-host requests are spaced by 650 ms, and retryable failures back off from one second.

Walmart has a dedicated structured-data adapter. When Walmart permits access, it scans first-party vinyl across `$10`, `$15`, and `$20` price bands with price-low, best-match, and best-seller lanes, follows up to `--walmartMaxPages` per lane, deduplicates by Walmart item/UPC, and admits useful absolute prices without requiring a markdown badge. When Walmart returns a block such as HTTP 412, the run records blocked/unknown coverage and does not attempt to evade it.

`ebay-purchase` uses the official eBay Browse API to discover new, fixed-price vinyl in bounded, paginated price and genre lanes. The acquisition price includes the item price plus the lowest explicit fixed USD shipping quote, so inbound shipping is not added twice. A lane-balanced item-detail pass must also confirm artist, release, format/type, and independent record-specific metadata before the offer is trusted (with a stricter multi-aspect fallback when eBay omits `Type`). Labels, decals, mats, clocks, bowls, coasters, sleeves, bags, jewelry, and other accessories are rejected in purchase and active-comparison paths. These are active purchase listings only: the candidate's own listing is excluded from active resale comps, and an asking price never counts as sold evidence.

`EBAY_DELIVERY_POSTAL_CODE` is required before an eBay acquisition offer can be marked `official_api`, because the landed shipping quote must apply to a real destination. Without it—or when item-detail identity remains incomplete—the result stays a `discovery_lead` and cannot become an automatic `BUY`.

Active-supply enrichment does not fail wholesale when the postal code is absent. It can still collect and deduplicate exact matched listing identities and counts. Shipping and landed prices are explicitly marked destination-unverified, so they cannot trigger a below-cost hard failure or authorize a purchase until a real destination is configured.

Retailers with a published no-reseller policy are excluded from automated acquisition. Assai Records is currently inactive for viable-candidate discovery because its official refund policy says marketplace-reseller orders may not be fulfilled; the policy URL and exclusion reason remain in the source catalog for audit.

Amazon is not claimed as a direct catalog while approved Amazon Creators API credentials are absent. A discovery feed can still surface an Amazon product URL; those results retain both identities and display as, for example, `Amazon via Vinyl Price Drop`.

## Product Discovery

The scanner first rejects obvious navigation, promotion-only, non-music, non-vinyl, accessory, merch, and alternate-format rows. Strong soundtrack and unknown-artist listings can remain when the product URL and vinyl-format evidence are credible.

High-noise marketplace sources require explicit vinyl/LP evidence in the product itself. ISBN/book links, digital-only products, turntables/record players, apparel, merch, and conflicting physical formats are rejected even when surrounding page text mentions vinyl. Broad volume/BOGO collection offers remain sale-campaign leads unless the scanner can normalize a real per-record price; they do not become product candidates by themselves.

Slickdeals search cards use a source-specific, role-labelled parser for the thread, current price, list price, advertised discount, date, and retailer. Shipping minimums such as `free shipping on $35+` are excluded from price evidence. A new U.S. explicit-vinyl thread at $20 or less can remain visible as a Tier C research lead even when sold evidence is still missing; that visibility never promotes it to an automatic value claim.

General-retailer price cards are normalized before discount math. Per-unit values such as `$26.68/lb` or `$34.43/ea`, shipping amounts, savings callouts, and coupons cannot become the record's purchase price. Escaped HTML entities and query separators are decoded, and retailer taxonomy such as `Music & Performance` is removed from artist/title and eBay search text. A high-confidence record with a genuine compare-at markdown can enter an exploratory validation slot below a noisy source's main sale threshold; small markdowns still stay out of sale-radar.

Shopify sources use paginated JSON catalogs rather than silently stopping after the first 250 products:

- Collection context is queried when the configured URL identifies a collection.
- Pagination continues up to `--shopifyMaxPages`.
- Only available variants can become candidates.
- A descriptive Shopify handle and product title must share meaningful identity text. A repurposed or stale handle that would open a different record fails closed; opaque catalog-number handles remain allowed.
- Each available variant is assessed separately, so a mixed CD/LP product cannot use the CD price for the LP. Explicit variant formats such as `2LP`, `2xLP`, and `2-LP` override contradictory product-level CD taxonomy throughout ingestion, active-supply enrichment, publication filtering, and display.
- Price, compare-at price, currency, SKU, barcode, variant identity, inventory quantity, and collection context are retained when present.
- All observed collection memberships are retained. A fixed percentage from a verified retailer page can change the candidate price only when it is truly sitewide/vinyl-wide or the product was observed in that exact sale collection. `Up to`, BOGO, and already-marked-down offers are never uniformly discounted.

Research prioritizes actual purchases of the same artist and album. An album-level own-sales prior may span conditions and editions, but supplies no comp price or pressing velocity. Exact New/Sealed comps still require artist, full album title, edition, condition, and dated retained transactions. Artist popularity, retailer badges, and a discount alone cannot establish demand. Unproven exploration is capped at 10% of the actual selected queue, with at most one bootstrap lead when no observed-demand candidate exists; unused capacity stays empty. Diagnostics expose observed-demand selections, deferred unproven records, and unused capacity.

The default sale-radar run caps the final candidate queue; `--mode=comprehensive` intentionally retains the broader set.

## Candidate Queue

Candidate strength is the primary output; the canonical decision remains a separate evidence status:

- `Tier A · verified`: the canonical decision is `BUY`; exact fresh demand, supply, identity, offer, and full-ledger economics all pass.
- `Tier B · promising`: product-level demand and deal/economics signals are useful, but at least one automatic evidence gate remains incomplete. Aggregate Product Research can support B, never A.
- `Tier C · research`: a credible source-linked record offer that still needs sold-market confirmation. This is explicitly not a market-value claim.
- `Price watch`: useful evidence exists, but the source price is not yet attractive enough.
- `Rejected`: validated evidence or an explicit deterministic preference rules the offer out.

The Retail Arbitrage page defaults to A/B/C candidates, sorts by tier and candidate score before the secondary evidence score, and shows candidate reasons plus an immediate retailer link. `BUY`/`REVIEW`/`WATCH`/`REJECT` remain available as evidence filters and badges instead of dominating the queue.

## Canonical Buy Decision

The shared evaluator lives in `src/lib/arbitrage/evaluateOpportunity.mjs`. The scan, curator, and browser UI use the same evaluator and reason codes.

An automatic `BUY` still requires exact, fresh evidence, but economics are velocity-sensitive rather than one hard rule. The evaluator offers three profiles:

- `Fast turn / smaller margin`: up to 45 estimated days, at least `$4` net, and 20% ROI.
- `Balanced`: up to 120 estimated days, at least `$7` net, and 30% ROI.
- `Slower / higher margin`: up to 270 estimated days, at least `$12` net, and 50% ROI.

The thresholds are editable, and a record can qualify through any one profile. Faster records can therefore justify a smaller margin without weakening evidence or supply requirements.

An automatic `BUY` requires all of these:

- Dated, condition-matched sold transactions with validated recent velocity.
- At least the configured 90-day units, sales-per-month, recency, and sell-through thresholds.
- A complete active search with an exact matched active-listing count.
- Sold and active artist, title, and edition matches at or above the configured confidence threshold.
- Sold and active evidence captured within the configured freshness window.
- A retailer offer captured within the configured offer-freshness window so price and availability are current.
- Active supply and months-of-supply below the configured limits.
- A conservative resale value.
- Net profit and ROI above one profile's configured thresholds after the full cost ledger.
- A priority score high enough for a normal buy; lower-scoring qualified records remain one-copy tests.

Default evidence gates include at least 3 units sold in 90 days, 1 sale per month, a sale within 60 days for the balanced profile, 20% sell-through, market evidence no older than 30 days, and a retail offer no older than 2 days. Exact supply is converted into estimated days-to-sale and tested against each profile's inventory horizon. The default ledger reserves `$5` for inbound shipping unless known free shipping or pickup is explicitly recorded as zero. Unknown source currency withholds USD profit/ROI, and a foreign-currency price requires a positive, fresh dated conversion before it can clear economics.

Priority is scored separately across item-level demand durability, economics, competition/supply, retailer product signals, and evidence quality. Artist-level results and artist preferences are inclusion/review context only; they do not claim value, change candidate/economic rank, or rescue weak item-level velocity or crowded supply.

Decision meanings:

- `BUY`: every automatic gate passed.
- `REVIEW`: promising or incomplete, but required evidence is missing, stale, undated, or not exact.
- `WATCH`: demand, supply, and matching are acceptable, but the current buy price misses the economics gate and may become viable at a lower price.
- `REJECT`: validated evidence fails the core gates or shows an explicit weak match.

Missing research stays in `REVIEW`; it is not converted into a false reject.

One exception is a complete, high-confidence exact active search that already exceeds the configured listing-count ceiling. That is known supply evidence, so it produces `SUPPLY_HARD_FAIL` immediately rather than consuming the validation queue while sold research is pending.

## Demand, Supply, and Match Evidence

Sold velocity must be based on dated transactions. The sold evidence model carries:

- Units sold in 30, 90, and 365 days.
- Transaction count and quantity-weighted unit count.
- Latest sale date and days since last sale.
- Sales per month.
- Condition bucket.
- Conservative price evidence.
- Title/edition match confidence and evidence capture time.

Active supply is enriched through paginated eBay active-listing searches. It carries:

- Exact matched active-listing count.
- Raw listings inspected.
- Search completeness.
- Match confidence.
- Capture time and representative matches.

Broad eBay result totals and the lowest active asking price can help research, but they are not accepted as exact supply unless the matching pass and search-completeness fields say so.

Local sold evidence validates artist identity separately from title and edition. A same-title sale by another artist does not establish demand for the candidate.

## Full Cost Ledger

The evaluator calculates landed cost, selling cost, expected net profit, margin, ROI, and a recommended maximum purchase price. The ledger supports:

- Purchase price and sales tax.
- Inbound shipping.
- FX fees and duty.
- Other acquisition costs.
- Marketplace percentage and fixed fees.
- Promoted-listing fees.
- Outbound shipping and packaging.
- Returns reserve.
- Other selling costs.

The Retail Arbitrage detail panel shows this ledger instead of treating purchase price plus tax as the entire cost.

## Local Sold History

The primary sold-history path now uses the configured eBay user refresh token. It fetches Fulfillment orders and Finances transactions in bounded date slices, re-fetches a 14-day overlap for late refunds/fees, and writes only sanitized seller-side records:

```powershell
npm run sold-history:sync -- --lookback-days=730 --refresh-overlap-days=14
```

Outputs include `sold-records-ebay-api.json`, `sold-comps-index.json`, `ebay-economics-summary.json`, and `sync-state.json`. Buyer identities, addresses, credentials, and raw API payloads are never persisted. Selling fees, promoted-listing charges, refunds, and directly attributable shipping labels are joined to orders; unmatched label charges remain account-level calibration percentiles instead of being guessed onto a record.

The index includes quantity-aware 30/90/365-day record metrics. Actual album purchases inform research priority; artist aggregates do not rank a different album or establish value. A CSV remains an optional fallback/import path:

```powershell
node scripts/buildSoldHistoryFromEbayCsv.mjs path\to\orders.csv exports\sold-history my-export --as-of=2026-07-16
```

The builder allocates order-level shipping, preserves transaction and unit counts, separates new/sealed, used, and unknown condition buckets, and calculates 30/90/365-day metrics. This is the account's own sales evidence; it does not prove that another marketplace seller repeatedly sold the record.

## eBay Product Research

Seller Hub Product Research uses one search string: artist plus album name. Colors, formats, barcodes, edition labels, and retailer copy stay out of keywords. Vinyl Records (`categoryId=176985`), New (`conditionId=1000`), and Sold are filters. Returned rows are checked separately for pressing and condition compatibility. Public Sold/Completed links remain available as a browser fallback.

Start with a visibly verified 90-day results window. A completed New/Vinyl search with observed start/end dates, fresh capture time, distinct listing identities, and complete pagination can support units for that exact window. It cannot supply shorter or longer windows. Three-year totals plus the latest sale date remain aggregate evidence and cannot establish 90-day velocity. A URL or dropdown alone is insufficient: verify the displayed results header and filters. Every BUY still requires exact matching, supply, offer verification, freshness, and full-ledger economics.

Research is generic and keyed by stable find ID:

```powershell
node scripts/prepareArbitrageResearchPlan.mjs
node scripts/prepareArbitrageResearchPlan.mjs exports\arbitrage-finds\<scan-file>.json --max=40
```

The workflow plans at most 240 retained candidates and reports any researchable rows outside that bound. The standalone planner can use an explicit smaller `--max`. Each entry contains the exact draft find ID, one artist/album query, source identity, and Seller Hub/public sold links. Curation rejects bundles, merch, damaged copies, used copies, and conflicting editions, then stores usable evidence by find ID. There is no title-by-title allowlist.

Use the same normalized artist/album query for every record, including soundtracks. Pending, failed, blocked, successful-empty, and validated searches remain distinct states.

## Scan, Enrichment, Curation, and Publication

The pipeline has explicit phases:

1. The scanner refreshes sanitized eBay sold history when user credentials are configured, unless `--skipEbaySync` is supplied.
2. `runRetailArbitrageScan.mjs` writes a timestamped `phase: "scan"`, `publicationStatus: "draft"` artifact with a stable `runId`.
3. Active eBay enrichment updates that draft when credentials are available.
4. Product Research is gathered against the find-ID plan.
5. `curateRetailArbitrageRun.mjs` applies the research, runs the canonical evaluator, and writes the run-ID-specific `phase: "final"` artifact plus an evidence sidecar.
6. `uploadLatestArbitrageFinds.mjs` accepts only final schema-version-2 payloads.

Example:

```powershell
node scripts/runRetailArbitrageScan.mjs --skipUpload
node scripts/prepareArbitrageResearchPlan.mjs exports\arbitrage-finds\<scan-file>.json --max=40
node scripts/curateRetailArbitrageRun.mjs exports\arbitrage-finds\<scan-file>.json exports\arbitrage-finds\<raw-research-file>.json 2026-07-16
node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-2026-07-16.json --dryRun
node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-2026-07-16.json
```

Raw scan and enrichment artifacts cannot become latest. Final publication stores an immutable run artifact and advances the latest pointer atomically. Retrying identical content for the same `runId` is safe; conflicting content or an older observation cannot silently replace a newer run. The server re-runs the canonical evaluator for every claimed `BUY`, rejects incomplete source coverage, normalizes duplicate sale-page variants, guarantees unique returned find IDs, and rebuilds summary counts from the returned rows. Legacy payloads with explicit draft markers are rejected even when their filename resembles a daily final, and pointerless legacy fallback chooses the newest valid observation time rather than filesystem/upload time.

Publishing requires `ARBITRAGE_UPLOAD_URL` and `ARBITRAGE_UPLOAD_TOKEN`. The scripts never purchase products, submit retailer forms, or mutate eBay listings.

## Sale Campaign Lifecycle

Site-wide sales are tracked as campaigns rather than one latest phrase per source. Multiple simultaneous offers from one retailer can coexist.

Repeated title/body fragments that describe the same URL, scope, discount, and promo code collapse into one observation. Distinct simultaneous offers, such as separate 30%-off and 40%-off campaigns, remain separate.

Statuses:

- `new`: first observation.
- `changed`: the campaign's offer, evidence, scope, code, discount, or content changed.
- `ongoing`: recently reconfirmed.
- `evergreen`: repeatedly observed and intentionally quieter.
- `unknown`: the campaign was not observed because its source check failed or was not trustworthy.
- `ended`: absent for the required number of successful source checks.

A failed scan never ends a campaign. The current lifecycle requires repeated healthy misses before `ended`. First seen, last seen, observation counts, miss/failure counts, evidence hashes, reopening, and transition history are retained.

The latest final payload is available at `/api/arbitrage/latest`. Campaign history is available at `/api/arbitrage/history`, with optional `sourceId`, `status`, and `limit` query parameters.

## Buyer UI

The Retail Arbitrage page is `#/retail-arbitrage`.

- It opens on the complete active queue, sorted by priority band and score, so an evidence-limited run never looks falsely empty.
- Separate views cover Buy now, Needs validation, Watch, Reject, purchased/tracked, user-rejected, and all active records.
- Rows show priority, recommended strategy, buy cost, profit per 30 days, estimated turn, recent/long-term velocity, supply, and evidence/source status.
- Details show all three buy profiles, the score breakdown, full ledger, 30/90/365-day and three-year evidence, sell-through, supply horizon, confidence/freshness, gate failures, research links, and suggested quantity.
- Threshold settings, dismissals, and record outcomes are stored locally in the browser.
- Outcomes include bought, listed, sold, returned, not for me, too slow, margin too thin, and false positive.
- The page reloads the latest publication every five minutes, refreshes immediately when the tab becomes visible or focused again, and re-evaluates freshness every minute. Cached recommendations stay hidden until an authoritative latest response arrives, while later transient refresh failures keep the last verified publication visible.
- Dismissals and outcomes are tied to a material offer fingerprint. A new price, original price, discount, URL, inventory state, or publication observation returns the record to review.

The Site-wide Sales page is `#/site-wide-sales`.

- New and changed campaigns lead the page.
- Ongoing, evergreen, unknown, and ended campaigns are separated.
- Cards show retailer versus discovery-lead confidence, evidence, first/last seen, scan history, and the latest lifecycle transition.
- Feedback includes confirmed, false positive, expired, and wrong scope.
- Current campaigns render without waiting for optional history. History has a five-second deadline and can replace embedded campaign data only when its `runId` matches the latest publication.
- Campaign feedback is tied to the observed campaign version and lifecycle health, so changed, reopened, or newly recovered sales are not hidden by an older expired/false-positive review.

Local feedback changes the browser's working queues; it does not alter retailer data or marketplace listings.

## Daily Automation

The `daily-vinyl-retail-arbitrage-scan` automation offers runs every two hours. The first eligible run after 5 a.m. Los Angeles time performs the daily broad scan; other runs refresh bounded active sources. Its workflow is:

1. Refresh sanitized eBay Fulfillment/Finances history with the incremental overlap.
2. Run the broad source scan and retain honest page-level coverage.
3. Keep the raw artifact as a draft and enrich active eBay evidence when credentials permit.
4. Build the find-ID Product Research plan.
5. Gather or ingest sold research without patching source code for individual titles.
6. Curate once through the canonical evaluator.
7. Validate the final artifact and publish it once.
8. Report coverage, evidence status, adaptive priority, and decisions.

The automation must not edit the curator for individual titles, publish a draft, buy anything, submit retailer or marketplace transaction forms, change listings, or dismiss user feedback. Saving observed evidence to the local inbox is allowed.

## Verification

Run before handoff or deployment:

```powershell
npm test
npm run build
node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-YYYY-MM-DD.json --dryRun
```

Useful focused suites:

```powershell
npx vitest run src/tests/candidatePipeline.test.ts src/tests/shopifyCatalog.test.ts
npx vitest run src/tests/arbitrageEvaluation.test.ts src/tests/productResearchCuration.test.ts
npx vitest run src/tests/saleCampaignLifecycle.test.ts src/tests/arbitrageFindsApi.test.ts
```

## Decision-list workflow (September 2026)

Run `npm run arbitrage:daily` to prepare a daily broad scan or a bounded campaign refresh. It returns an exact context path, draft path, and research checkpoint path. `--full` forces a broad scan. The cadence file records the last broad attempt; it never substitutes an older draft after a failed command.

The daily automation runs at 5:30 local, with refresh opportunities every two hours. Refreshes check up to twelve sources, pinning up to six priority active-campaign sources and rotating the others. Retailer blocks remain unknown coverage. Requests to a host stop after a final 403/429, and offer verification has a three-minute pass budget. No browser fingerprint or access-control workaround is used.

Research uses the retained pool (up to 240 products), not the preliminary visible 80. Use the normal signed-in browser and save each completed artist/album search immediately. Start the local inbox with `node scripts/serveRetailObservationInbox.mjs`; `http://127.0.0.1:4319/` stores visible retailer observations, and `/research` stores visible Seller Hub rows in `exports/arbitrage-finds/browser-product-research.json`. Capture the actual query, URL, timestamp, displayed date window, New/Vinyl filters, rows, and whether pagination is complete. No cookies, credentials, hidden page state, or raw account data belong in either file.

Start a new scan with `npm run arbitrage:daily -- --browserObservations=exports/arbitrage-finds/browser-source-observations.json` when fresh retailer captures are available. Retail observations cannot be retroactively attached to an existing draft. Finish with `node scripts/runRetailWorkflow.mjs --finish=<context> --browserResearch=exports/arbitrage-finds/browser-product-research.json`. The importer matches the exact draft artist/album plan and merges accepted pages into that draft's checkpoint before curation. `node scripts/importBrowserSoldResearch.mjs <draft> <captures>` also imports independently. `--research=<checkpoint>` remains available; without it, finish automatically resumes the saved checkpoint. Only a missing checkpoint uses pending-only curation. The same run-ID-specific final artifact is validated and published. Full publication still requires the coverage gate; otherwise verified source updates are labeled partial.

The default Worth considering list contains at most fifteen release groups, with no fill quota. Offers must be at most 24 hours old. A verified BUY may appear; a B candidate needs at least $7 expected net, 30% ROI, credible matched demand, fresh active evidence, and at most one remaining timing or checkout-price check. Tier C research is optional. Equivalent releases are grouped for display only; edition-specific prices and evidence remain separate.

Campaign terms bind to their own content block and scope. Fixed discounts and BOGO use explicit baskets; thresholds do not make extra inventory free. A basket is illustrative, before tax and selling costs, and never creates an automatic BUY. Shopify Ajax product and cart GETs check the exact physical variant, availability, price, and presentment currency. Checkout-only discounts remain estimates. Unsupported endpoints or access failures cannot establish verification.

The feedback endpoint accepts only signed, expiring receipts for published offers and enumerated outcomes. The learning store contains opaque hashes, ranks, reason codes, and timestamps only. It does not retain marketplace titles, prices, images, URLs, sellers, descriptions, or raw IDs. Unchanged negative outcomes suppress research for up to fourteen days; material offer or own-evidence changes reopen it. Successful empty research is deferred for seven days using the same sanitized identity, while failed searches remain retryable.

`node scripts/reportRetailUsefulness.mjs` measures the last seven days of explicit feedback on the first ten recommendations. It reports null precision when nothing has been reviewed. The 70% usefulness target is a measurement target, not a claimed result. Per-run source/campaign funnel counters and daily aggregate metrics support the shadow evaluation. The undisclosed retailer deal is not used as a fixture.

Status and feedback API: `/api/arbitrage/operations` (GET status; authenticated POST scan status; POST `?action=feedback` with a signed offer receipt; authenticated GET feedback for the scanner). The existing upload secret signs receipts and authorizes scanner operations; it is never returned to the browser. Review sync failure remains visible and keeps the browser-local outcome.



Research links include explicit start/end timestamps because Seller Hub can display a three-year dropdown while loading only 30 days when the URL has only `dayRange`. Verify the displayed results header and save `observedWindow`, `periodDays`, and capture metadata. An empty checkpoint is pending; failed requests cannot validate partial rows. A successful complete artist/album search with no compatible rows may be deferred for seven days. Source publication and research completion are independent: context, final artifact, and operations status report planned, completed, validated, successful-empty, failed, pending, and matched-row counts. Publishing an all-pending scan never labels research complete.

The final retailer verification runs after sold-research curation, with host pacing, a three-minute budget, and no additional requests to a host after a 403/429. Fresh explicit visible-browser product observations can verify the same exact offer. Otherwise the verification gap remains visible. Research starts with observed album purchases, and display ranking runs after sold and retail evidence are applied. Updated-source counts use the same admission criteria as publication: productive healthy/partial catalogs or healthy/partial sale checks, not every page that responded.


Campaign interpretation is shared by ingestion, basket pricing, and display. Percentage ranges stay `up_to`, category-page headlines require collection membership unless they explicitly state broad coverage, volume offers require the advertised quantity, and unresolved multiple-code terms cannot produce a priced recommendation. The sales page groups a retailer's multiple observations behind one expandable section. Quoted product names containing “Everything” do not count as sitewide coverage.
