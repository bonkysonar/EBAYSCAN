# Decisions

## 2026-05-16: Mock-first Marketplace Architecture

The app uses a `MarketplaceClient` interface with a mock eBay client first. This lets scoring, UI, tests, and scanner workflow be developed without credentials and without scraping.

## 2026-05-16: Conservative Triage Defaults

Uncertain records go YELLOW. GREEN means likely worth processing because comparable prices cluster above the threshold. RED means likely safe to skip, and should only be returned when there are enough similar listings, low prices, no meaningful risk flags, and adequate confidence.

## 2026-05-16: Local-first MVP

Settings are stored in browser localStorage and fixtures are local TypeScript data. No production data is mutated.

## 2026-05-16: React + Vite + TypeScript

The initial stack is React + Vite + TypeScript with Vitest. This keeps the MVP lightweight, easy to run locally, and friendly to modular UI and logic tests.

## 2026-05-16: Local eBay Browse API Endpoint

Real eBay lookup is routed through a local Vite dev-server endpoint so OAuth credentials and minted tokens stay out of browser bundles. Barcode, catalog-number, and manual search can use real Browse API search. Searches default to used listings because used vinyl is the primary workflow, with New and Both available as operator controls. Real lookup failures return YELLOW/no-results warnings instead of generic mock matches; mock fallback is reserved for explicit demo inputs and image placeholder work. Image search remains mocked until official image-search access is confirmed.

## 2026-05-16: Identifier Search Expansion

Catalog numbers and barcodes can be too narrow by themselves. Identifier searches now run a primary identifier query, derive likely artist/title tokens from the returned titles, run an expanded artist/title query, and merge/dedupe the results. eBay total-match counts are preserved in the raw summary so future scoring can reason about market saturation separately from the returned candidate list.


## 2026-05-17: Discogs Marketplace Stats

Discogs lookup uses DISCOGS_USER_TOKEN server-side only. The app searches Discogs releases, fetches release details and marketplace stats, and displays matched release, lowest price, number for sale, have/want counts, and match confidence. Current API responses did not provide median/sold-history price, so the UI labels median as unavailable rather than inventing it.

## 2026-05-17: Vercel-Ready Server Boundary

Marketplace lookup logic now lives in `src/server/marketplaceApi.ts` so local Vite middleware and hosted serverless routes share the same implementation. The hosted entrypoint is `api/ebay/search.ts`, and `vercel.json` configures the Vite build plus serverless function. This keeps eBay and Discogs secrets server-side while allowing the app to run from other computers once deployed.

## 2026-05-17: Low-End Comparable Price Signal

Broad median listing price can be misleading for common records with many cheap copies and a few expensive outliers. Scoring now emphasizes the average of the cheapest 10 title-matching comparable listings, and visible candidate tiles are sorted from lowest total price upward. This better supports fast culling decisions such as `BOZ SCAGGS Slow Dancer`, where many active listings are below the processing threshold.

For threshold decisions, `averageCheapestTenTotalPrice` is the primary benchmark. If it is above the configured threshold and enough comparable listings exist, the app returns GREEN even when listing consensus is imperfect. This matches the workbench rule: above-threshold low-end comps mean "go/process," not "skip."

Catalog-number Discogs matching is stricter than general text search. Catalog results are ranked by normalized catno similarity, shared catalog tokens, standalone series numbers, and plausible original-year preference so values such as `ECM 1 1216` prefer `ECM-1-1216`/1982-style matches over later reissues.

Barcode searches can use Discogs as an eBay expansion source. If eBay GTIN/text barcode search returns no usable listings but Discogs identifies the release, the API runs a second eBay search using the Discogs artist/title. This fixes cases such as `07599254741`, where Discogs identifies `Peter Cetera - Solitude / Solitaire` but eBay GTIN search returns zero.

## 2026-05-17: Paginate Active eBay Candidates

The eBay Browse API endpoint is queried in 200-listing pages, up to 1,000 returned listings per query leg. This prevents title-match and market-saturation logic from silently maxing out at the first page while preserving eBay's reported total count in the raw summary.

## 2026-05-18: Discogs Sales Stats Pull / Import

Discogs release pages display Last Sold, Low, Median, and High sales statistics, but the official API response used here does not provide those historical sales values. The app does not silently scrape Discogs pages because Discogs terms restrict automated scraping/data extraction and sales-history marketplace data. Instead, the UI accepts user-provided Discogs Statistics text or saved HTML/XML/text for the current result, parses the values locally, displays them, and uses imported Discogs sales median to prevent overly generous GREEN decisions.

David explicitly asked for a one-release-at-a-time automatic pull because Discogs median is the primary real-world pricing signal in this workflow. The app now makes a best-effort server-side fetch for the matched Discogs release and parses only the visible sales stats. This is intentionally not a batch/mining feature. If Discogs returns a browser challenge or blocks the request, the UI shows that failure plainly and keeps the manual paste/file import fallback.

## 2026-05-18: Discogs Browser Helper Extension

Because Discogs can block server-side page fetches while a normal signed-in Chrome session can still display the release page, the fastest viable workflow is a tiny local Chrome extension. Record Scanner opens a Discogs helper tab with a one-time token and return origin. The extension runs only on Discogs pages, reads the visible release stats table, and posts Last Sold / Low / Median / High back to the opener window. This avoids slow Google Sheets IMPORTXML polling and avoids OCR/screenshot fragility.

The background extension path proved less reliable than the visible helper flow because it introduced extra injection, service-worker, and timing failure points. The app now waits until a Discogs release URL is available, waits a short 500ms settle delay, then automatically opens the visible helper flow that was already proven to work. Browser-helper medians are treated as authoritative threshold decisions: above threshold GREEN, at/below threshold RED, with confidence set to 100%.

## 2026-05-20: Separate Seller Price Analyzer

Store-pricing analysis is a separate hash route at `#/seller-prices` so the scanner page remains focused on fast record triage. The analyzer is read-only: it can pull active seller listings and compare current asking prices to active eBay cheapest-10 comps, but it does not call any eBay revise/end/relist mutation APIs.

Seller recommendations intentionally use active eBay cheapest-10 average and active comparable count rather than Discogs median. This answers a different question than the scanner: not "is this record worth processing?" but "is David's live listing competitive in the current active market?"

## 2026-07-13: Automatic Discogs Price Guide Replaces Automatic Browser Helper

Opening a new Discogs page for every scan was slow, repeatedly triggered browser challenges, and defeated the scanner's one-enter workflow. The default search now calls Discogs' documented authenticated `marketplace/price_suggestions/{release_id}` API endpoint and selects the conservative Very Good (VG) suggestion for used-record triage. The UI labels this value as a price guide, not a historical median.

The app no longer launches the Chrome helper automatically. Pressing Enter performs the eBay and Discogs API lookup without browser navigation or another click. The page pull, Chrome helper, and pressing chooser remain manual options for cases where David wants the exact page-visible Last Sold / Low / Median / High history or needs to correct a pressing. A below-threshold automatic Discogs price guide conservatively prevents an eBay-only GREEN decision, but it is not treated as the helper median's 100%-confidence historical signal.

## 2026-07-13: Reusable Visible Discogs Session

Production confirmed that the configured Discogs token can read public release/current-lowest data but cannot provide the historical page statistics, and Vercel continues to receive a 403 browser challenge on direct page pulls. The helper therefore returns to the automatic path with a different lifecycle: extension v0.3 creates one visible Chrome popup window, persists its tab/window IDs in `chrome.storage.session`, and reuses that same window for every matched release.

The first helper window is focused so David can complete Discogs' normal browser verification. Challenge detection brings the window forward again when attention is required, allows up to five minutes for a human response, and never attempts to bypass the verification. Successful reads return focus to the scanner. The persistent request map is also stored in session storage so a Manifest V3 service-worker suspension does not lose the response route.

## 2026-07-16: Honest Retail Source Coverage

Retail source coverage is measured from the pages actually attempted, not inferred from the configured source count. Catalog and sale-page health are preserved separately with requested/resolved URLs, fallback behavior, partial coverage, blocks, failures, timeouts, retries, and page errors. A failed check means unknown coverage; it does not mean no products or no sale.

Source metadata such as priority, retailer type, sale likelihood, noise level, crawl strategy, discount threshold, and source-specific economics remains attached throughout the scan so later ranking and diagnostics do not lose the reason a source was configured.

## 2026-07-16: Paginated Shopify Discovery and Global Candidate Selection

Shopify catalogs are paginated beyond the first 250 products, with collection context queried when available. Only available variants can become candidates. Price, compare-at price, currency, SKU, barcode, inventory, variant identity, and collection context are retained.

Obvious navigation, promotion-only, general-retail, merch, accessories, and non-vinyl formats are rejected before eBay enrichment. Credible soundtracks and unknown-artist vinyl remain eligible when product and format evidence is strong.

High-noise marketplaces require explicit product-level vinyl/LP evidence. ISBN/book identifiers, digital-only products, turntables/record players, apparel, merch, and conflicting physical formats are hard exclusions even when surrounding copy includes the word vinyl. Broad volume/BOGO collections remain campaign evidence unless a true per-item record price can be normalized.

General-retailer unit prices (`/ea`, `/lb`, and similar), shipping amounts, savings, and coupons are not product prices. HTML entities and escaped query separators are decoded before parsing. Retail taxonomy is removed from artist/title and active-search queries. Credible, high-confidence compare-at markdowns can receive an exploratory validation slot without lowering the source's main sale threshold.

Mixed-format Shopify products are evaluated per available variant. Variant title, price, identifiers, inventory, and exact variant URL travel together, preventing a cheap CD from pricing an LP. Explicit vinyl variant identity also overrides contradictory parent-product CD taxonomy during active eBay enrichment and downstream filtering.

Candidate limits are applied after a global quality ranking. Per-source quotas and exploration slots prevent a high-volume feed from filling the queue before other retailers are evaluated.

## 2026-07-16: One Canonical Retail Arbitrage Evaluator

The scan, curator, and Retail Arbitrage UI use the same evaluator and reason codes. This replaces the prior situation where the raw scan, manual curator, and UI could disagree.

`BUY` requires every gate:

- Dated, condition-matched recent sold velocity.
- A complete active search with exact matched active supply.
- Sufficient artist/title/edition match confidence for sold and active evidence.
- Evidence freshness.
- A dated retail offer inside the two-day default freshness window.
- Demand, sell-through, listing-count, and months-of-supply thresholds.
- A conservative resale value.
- Minimum expected net profit and ROI after the full cost ledger.

Missing, stale, undated, aggregate-only, or inexact evidence produces REVIEW rather than an automatic buy. An explicit weak match can produce REJECT. WATCH is reserved for otherwise credible opportunities that miss the current economics gate.

Retail offer freshness is evaluated separately from sold and active-market evidence. A missing, materially future, or older-than-configured `capturedAt` adds `OFFER_STALE_OR_UNDATED` and prevents `BUY` while preserving the demand, supply, match, and economics calculations for review.

Active asking prices are supply and research evidence, not proof of what buyers pay.

A complete exact active search above the configured listing-count ceiling is nevertheless conclusive supply evidence. It produces `SUPPLY_HARD_FAIL` immediately, even when sold research is incomplete, so obviously crowded records do not occupy the validation queue.

## 2026-07-16: Full Cost Ledger

Retail profit is calculated after purchase price, sales tax, inbound shipping, FX fees, duty, other acquisition costs, marketplace percentage and fixed fees, promoted-listing fees, outbound shipping, packaging, returns reserve, and other selling costs.

The evaluator exposes landed cost, total selling costs, expected net profit, margin, ROI, and a maximum purchase price that would clear the configured profit and ROI gates. Purchase price plus tax is no longer treated as the complete arbitrage cost.

Unknown inbound shipping is not assumed free; the default reserve is `$5`, while a verified free-shipping offer can explicitly provide zero. Unknown source currency withholds USD economics. Foreign prices require a positive conversion rate with a capture date inside the evidence-freshness window before profit or ROI can authorize a buy.

## 2026-07-16: Dated Velocity Is Required

Recent sales velocity must come from dated transactions with quantity and condition evidence. Local eBay order exports can supply 30/90/365-day metrics for this account's own sales.

Seller Hub Product Research rows are aggregate rows. Total sold plus a latest-sale date does not reveal the distribution of units across 30, 90, and 365 days. Product Research can support sold-price and repeat-row research but cannot prove velocity or create BUY by itself.

Artist identity is a separate evidence requirement. A title and edition resemblance cannot validate local sold history when the sold record is by a different artist.

## 2026-07-16: Velocity-Sensitive Economics and Priority

Retail arbitrage no longer applies one minimum-profit rule to every record. It evaluates Fast Turn, Balanced, and Slower / Higher Margin profiles. A quick seller may qualify with a smaller dollar margin, while a slower seller must compensate with materially stronger net profit and ROI. Exact evidence, matching, freshness, and supply constraints are not relaxed by the cheaper profile.

Priority is a separate 100-point model covering demand durability, economics, competition/supply, evergreen prior, and evidence quality. The evergreen component can use this account's artist-level sales, retailer best-seller/customer-pick signals, review depth, identifiers, and explicit user preference, but it remains a weak prior. It cannot convert sparse aggregate Product Research or crowded active supply into real velocity.

The buyer UI presents all three options with their thresholds and reasons, defaults to the priority-sorted active queue, and accepts explicit negative feedback such as Not for me, Too slow, and Margin too thin.

## 2026-07-16: Automatic eBay Sold-History Refresh

Fresh order history is collected from the configured eBay user token; a new CSV is not required for normal operation. The sync reads Fulfillment orders and Finances transactions in bounded slices, refreshes a 14-day overlap, and persists only sanitized seller-side records and aggregates.

Final-value/fixed fees, promoted-listing charges, refunds, and directly attributable shipping labels are joined to order lines. Shipping-label transactions that cannot be safely tied to one order remain account-level median/percentile calibration instead of being invented as line-item costs. Buyer identities, addresses, usernames, tokens, raw API responses, and financial transaction IDs are prohibited from persisted outputs.

## 2026-07-16: Walmart Absolute-Price and Availability Adapter

Walmart discovery uses structured page state instead of visible anchor/card text. The adapter scans first-party vinyl at `$10`, `$15`, and `$20` ceilings across configured, price-low, best-match, and best-seller lanes, paginates each lane, and deduplicates by item identity/UPC.

A Walmart record at or below `$15` is an unconditional market-validation candidate; `$15` to `$20` is a conditional candidate. Neither lane requires a strike-through markdown. Search-result availability is treated cautiously because Walmart's anonymous default location can falsely report in-stock shippable records as unavailable. A bounded product-page verification pass rechecks the strongest low-price records before they are discarded.

## 2026-07-16: Generic Find-ID Product Research

Product Research planning and curation are keyed by stable find ID and normalized query variants. The curator applies generic title, format, condition, damage, bundle, merch, and edition matching rules. Daily operation must not add title-specific allowlists or patch the curator for the records found that day.

Pending, failed, and no-row research statuses remain explicit so unvalidated records are not mislabeled as final rejects.

## 2026-07-16: Draft-to-Final Atomic Publication

Retail runs have explicit phases:

1. Scan output is a draft.
2. Active eBay enrichment updates the draft.
3. Product Research is gathered and curated.
4. The canonical evaluator produces a final schema-versioned artifact.
5. Only that final artifact can publish.

Each run has a safe `runId`. Publication stores an immutable final run and advances the latest pointer atomically. Identical retries are idempotent; conflicting content for one run or an older observed run cannot silently replace the current latest payload. An explicit draft phase/status always wins over legacy filename conventions, and pointerless legacy fallback is ordered by lifecycle observation time rather than filesystem modification or upload time.

## 2026-07-16: Sale Campaign Lifecycle and History

Site-wide sales are persistent campaigns, not one phrase-match snapshot per source. Multiple simultaneous campaigns from one retailer remain distinct.

Duplicate page fragments with the same normalized campaign identity, URL, scope, discount, offer type, and promo code collapse into one observation. Truly different offers from the same retailer remain separate.

Campaigns move through New, Changed, Ongoing, Evergreen, Unknown, and Ended. Failed or untrustworthy source checks produce Unknown. Ended requires repeated successful checks that do not find the offer. First/last seen times, evidence/content hashes, observation counts, misses, failures, reopening, and transitions are retained and exposed through `/api/arbitrage/history`.

The Site-wide Sales page leads with New and Changed, keeps Ongoing and Evergreen quieter, and separates Unknown from Ended.

## 2026-07-16: Buyer Queue and Local Outcome Feedback

Retail Arbitrage opens on Buy now. Rejects are not mixed into the default list. Needs validation, Watch, Reject, purchased/tracked, false-positive/dismissed, and All views are separate.

The detail panel prioritizes the full profit ledger, dated demand, exact supply, sell-through, months of supply, match confidence, evidence freshness, gate failures, and a conservative test quantity.

Record outcomes (bought, listed, sold, returned, false positive) and campaign reviews (confirmed, false positive, expired, wrong scope) are stored locally in the browser. Feedback changes the user's queues without mutating retailer or marketplace data.

Feedback is scoped to the material observation, not just the stable record/campaign ID. Changed prices, URLs, discounts, inventory, content, or reopened campaigns invalidate older dismissals and review outcomes.

Both arbitrage pages poll for a new final publication every five minutes and refresh immediately after focus or visibility restoration. Retail scoring advances on a one-minute clock. Initial cached BUYs remain hidden until the latest publication is verified; after that, transient refresh failures retain the last verified data. Optional campaign history loads separately with a five-second deadline and cannot replace current embedded campaigns unless run IDs match.

## 2026-07-16: Bounded Enrichment

eBay OAuth and Browse requests have abort deadlines, and the parent source scan gives the enrichment subprocess a configurable overall timeout. Network stalls therefore fail into explicit validation state instead of blocking scan publication indefinitely.

## 2026-07-16: Deterministic Daily Automation

The daily automation runs the source scan, optional active enrichment, find-ID research plan, generic curation, final validation, and one final-only publication. It reports honest coverage and evidence status.

The automation must not modify scanner source code for individual titles, publish drafts, purchase products, submit retailer forms, mutate eBay listings, or overwrite browser feedback.

