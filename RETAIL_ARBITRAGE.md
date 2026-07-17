# Retail Arbitrage Scanner

This guide describes the record-buying workflow used by the Retail Arbitrage and Site-wide Sales pages.

## Purpose

The scanner has two related jobs:

1. Find individual new/sealed records that may sell quickly enough and profitably enough to buy for resale.
2. Track broad retailer campaigns without presenting the same unchanged sale as new every day.

A source check, a promising price, or an active eBay asking price is not a buy recommendation by itself. `BUY` is reserved for records that clear the canonical demand, supply, match, freshness, and economics gates.

## Source Catalog and Coverage

The source inventory lives in `src/lib/arbitrage/vinylShopSources.ts`. Each source can carry operational metadata such as priority, retailer type, sale likelihood, noise level, crawl type, default discount threshold, and source-specific minimum profit or ROI.

Every scan preserves source and page health in `sourceReports`:

- Catalog and sale pages are reported separately.
- Requested and resolved URLs are retained, including homepage fallback and discovered same-store sale pages.
- Healthy, partial/degraded, blocked, and failed checks remain distinguishable.
- A failed source check produces unknown coverage; it does not prove that a sale ended or that the retailer had no useful records.
- Discovery feeds and aggregators remain labeled as leads until a retailer page confirms the offer.

The UI reports attempted, sale-page-capable, degraded, blocked, and priority-source coverage. Counts describe what the scanner actually reached, not the total configured list.

Requests use bounded concurrency, per-host pacing, timeouts, retries, and backoff. Active eBay token/Browse calls also have request deadlines, and the parent scan will stop a stuck enrichment subprocess instead of hanging indefinitely. Diagnostic runs can limit the source set without changing the catalog:

```powershell
node scripts/runRetailArbitrageScan.mjs --sources=source-id-1,source-id-2 --skipUpload
```

Useful scan controls include `--sourceConcurrency`, `--fetchRetries`, `--hostDelayMs`, `--fetchTimeoutMs`, `--maxDiscoveredSalePages`, `--discoveryDetailLimit`, and `--discoveryConcurrency`.

Walmart has a dedicated structured-data adapter. It scans first-party vinyl across `$10`, `$15`, and `$20` price bands with price-low, best-match, and best-seller lanes, follows up to `--walmartMaxPages` per lane, deduplicates by Walmart item/UPC, and admits useful absolute prices without requiring a markdown badge. Because Walmart search results can report stale default-location inventory, the scanner rechecks up to `--walmartAvailabilityDetailLimit` promising low-price records on their product pages before discarding them as unavailable. Seller, stock, fulfillment, badges, ratings, reviews, SKU, UPC, current price, and was price remain visible in the evidence.

## Product Discovery

The scanner first rejects obvious navigation, promotion-only, non-music, non-vinyl, accessory, merch, and alternate-format rows. Strong soundtrack and unknown-artist listings can remain when the product URL and vinyl-format evidence are credible.

High-noise marketplace sources require explicit vinyl/LP evidence in the product itself. ISBN/book links, digital-only products, turntables/record players, apparel, merch, and conflicting physical formats are rejected even when surrounding page text mentions vinyl. Broad volume/BOGO collection offers remain sale-campaign leads unless the scanner can normalize a real per-record price; they do not become product candidates by themselves.

General-retailer price cards are normalized before discount math. Per-unit values such as `$26.68/lb` or `$34.43/ea`, shipping amounts, savings callouts, and coupons cannot become the record's purchase price. Escaped HTML entities and query separators are decoded, and retailer taxonomy such as `Music & Performance` is removed from artist/title and eBay search text. A high-confidence record with a genuine compare-at markdown can enter an exploratory validation slot below a noisy source's main sale threshold; small markdowns still stay out of sale-radar.

Shopify sources use paginated JSON catalogs rather than silently stopping after the first 250 products:

- Collection context is queried when the configured URL identifies a collection.
- Pagination continues up to `--shopifyMaxPages`.
- Only available variants can become candidates.
- Each available variant is assessed separately, so a mixed CD/LP product cannot use the CD price for the LP. Explicit variant formats such as `2LP`, `2xLP`, and `2-LP` override contradictory product-level CD taxonomy throughout ingestion, active-supply enrichment, publication filtering, and display.
- Price, compare-at price, currency, SKU, barcode, variant identity, inventory quantity, and collection context are retained when present.

Candidates from all sources are scored together before the daily limit is applied. Ranking considers record confidence, source quality, discount, sold evidence, identifiers, and deal context. Per-source caps and exploration slots prevent one high-volume feed from consuming the entire queue before other retailers are considered.

The default sale-radar run caps the final candidate queue; `--mode=comprehensive` intentionally retains the broader set.

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

Priority is scored separately across demand durability, economics, competition/supply, evergreen strength, and evidence quality. Artist-level results from this account's own order history, retailer best-seller/customer-pick signals, reviews, identifiers, and explicit user preference are weak evergreen priors; they cannot rescue weak item-level velocity or crowded supply.

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

The index includes quantity-aware 30/90/365-day record metrics and artist aggregates used as a weak evergreen prior. A CSV remains an optional fallback/import path:

```powershell
node scripts/buildSoldHistoryFromEbayCsv.mjs path\to\orders.csv exports\sold-history my-export --as-of=2026-07-16
```

The builder allocates order-level shipping, preserves transaction and unit counts, separates new/sealed, used, and unknown condition buckets, and calculates 30/90/365-day metrics. This is the account's own sales evidence; it does not prove that another marketplace seller repeatedly sold the record.

## eBay Product Research

Seller Hub Product Research remains useful for sold-price and repeat-row validation. Research links target Vinyl Records (`categoryId=176985`), New (`conditionId=1000`), the Sold tab, and normalized query variants.

Product Research rows are aggregate rows. Even when they show a total sold quantity and a latest-sale date, they do not reveal how those units were distributed across the last 30, 90, and 365 days. Aggregate Product Research alone therefore cannot prove velocity or create a `BUY`.

Research is generic and keyed by stable find ID:

```powershell
node scripts/prepareArbitrageResearchPlan.mjs
node scripts/prepareArbitrageResearchPlan.mjs exports\arbitrage-finds\<scan-file>.json --max=40
```

The generated plan includes the find ID, normalized query variants, research URL, source identity, and edition terms. The curation step matches returned rows to the record, rejects bundles, merch, damaged copies, used copies, and conflicting editions, then stores the usable evidence by find ID. There is no title-by-title allowlist in the curator.

For soundtracks, the plan can try the core title, `Soundtrack`, and `OST` variants. A pending, failed, or no-row search remains explicitly labeled.

## Scan, Enrichment, Curation, and Publication

The pipeline has explicit phases:

1. The scanner refreshes sanitized eBay sold history when user credentials are configured, unless `--skipEbaySync` is supplied.
2. `runRetailArbitrageScan.mjs` writes a timestamped `phase: "scan"`, `publicationStatus: "draft"` artifact with a stable `runId`.
3. Active eBay enrichment updates that draft when credentials are available.
4. Product Research is gathered against the find-ID plan.
5. `curateRetailArbitrageRun.mjs` applies the research, runs the canonical evaluator, and writes the dated `phase: "final"` artifact plus an evidence sidecar.
6. `uploadLatestArbitrageFinds.mjs` accepts only final schema-version-2 payloads.

Example:

```powershell
node scripts/runRetailArbitrageScan.mjs --skipUpload
node scripts/prepareArbitrageResearchPlan.mjs exports\arbitrage-finds\<scan-file>.json --max=40
node scripts/curateRetailArbitrageRun.mjs exports\arbitrage-finds\<scan-file>.json exports\arbitrage-finds\<raw-research-file>.json 2026-07-16
node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-2026-07-16.json --dryRun
node scripts/uploadLatestArbitrageFinds.mjs --file=exports\arbitrage-finds\retail-arbitrage-2026-07-16.json
```

Raw scan and enrichment artifacts cannot become latest. Final publication stores an immutable run artifact and advances the latest pointer atomically. Retrying identical content for the same `runId` is safe; conflicting content or an older observation cannot silently replace a newer run. Legacy payloads with explicit draft markers are rejected even when their filename resembles a daily final, and pointerless legacy fallback chooses the newest valid observation time rather than filesystem/upload time.

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

The `daily-vinyl-retail-arbitrage-scan` automation is scheduled for 5:30 a.m. local time. Its deterministic workflow is:

1. Refresh sanitized eBay Fulfillment/Finances history with the incremental overlap.
2. Run the broad source scan and retain honest page-level coverage.
3. Keep the raw artifact as a draft and enrich active eBay evidence when credentials permit.
4. Build the find-ID Product Research plan.
5. Gather or ingest sold research without patching source code for individual titles.
6. Curate once through the canonical evaluator.
7. Validate the final artifact and publish it once.
8. Report coverage, evidence status, adaptive priority, and decisions.

The automation must not edit the curator to accommodate the day's titles, publish a draft, buy anything, submit forms, change listings, or dismiss user feedback.

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
