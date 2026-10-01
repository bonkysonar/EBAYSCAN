# Sold History Comp Database

The retail arbitrage scanner should check local sold history before doing slower eBay Product Research.

## Why This Helps

- Your own sold records are fast to query and already reflect your listing style.
- The data can separate new/sealed records from used records instead of mixing conditions.
- Repeat sales become easy to spot: a title with multiple past sales can skip straight to margin math.
- eBay Product Research is still useful for records you have never sold, stale comps, and active-listing scarcity checks.

## Local Files

Generated sold history lives in `exports/sold-history/`, which is ignored by git.

- `sold-records-<sheet>.json`: sanitized item-level sold records.
- `sold-comps-index.json`: grouped comp index used by the app and automation.

The importer intentionally excludes buyer names, buyer usernames, email addresses, addresses, notes, tracking numbers, and transaction IDs.

## Import Command

```bash
node scripts/buildSoldHistoryFromEbayCsv.mjs <orders.csv> exports/sold-history "2026 Orders"
```

## Automatic eBay API Sync

When seller OAuth is configured, the preferred path is the read-only Fulfillment
and Finances API sync:

```bash
npm run sold-history:sync
```

The first run retrieves up to 730 days in bounded date slices. Later runs
re-fetch a 14-day overlap so delayed refunds, advertising fees, and shipping
label adjustments can update earlier sales without double counting.

Useful options:

```bash
npm run sold-history:sync -- --dry-run
npm run sold-history:sync -- --from=2025-07-17 --to=2026-07-16
```

The API sync writes:

- `sold-records-ebay-api.json`: sanitized line-item sales and attributable economics.
- `ebay-economics-summary.json`: fee, refund, and shipping-label calibration totals.
- `sold-comps-index.json`: version 2 release comps plus artist-level repeat-sale aggregates.
- `sync-state.json`: incremental cursor, one-way financial-event digests, and safe calibration state.

Buyer names, usernames, addresses, notes, OAuth tokens, raw responses, and raw
financial transaction IDs are never written. Unjoined shipping-label
transactions are explicitly reported as aggregate batch debits. Because eBay
does not provide a package-count denominator for those batches, the sync does
not label their percentiles as per-package costs and never guesses them onto
individual records.

## Condition Rules

Records are classified as `new_sealed` when the title or custom label includes signals like `Factory Sealed`, `Brand New`, `New/Sealed`, `New Sealed`, `Sealed`, or when the custom label starts with `Whole`.

Records are classified as `used` when the title includes a media/sleeve grade pair such as `VG+/VG`, `EX/NM`, or `NM/VG+`.

Everything else stays `unknown` so the automation can treat it cautiously.

## Album demand and exact comp evidence

Research priority uses actual retained purchases of the same artist and full album title, including older or different-edition sales. This album demand summary supplies no resale price and no exact-pressing velocity. Artist aggregates, a popular band name, retailer badges, and large unverified counts cannot promote an unproven album. Exact local comps additionally require matching edition and New/Sealed condition. A fuzzy match to a similarly named album or an unconfirmed older pressing cannot supply prices. Curation revalidates older draft metadata against these rules without refreshing retailer observation times.

## Signed-in sold research checkpoint

Use only artist plus album name in Seller Hub's keyword field. Keep Vinyl Records, New, Sold, and the date range in filters. Check pressing, format, and condition on returned rows. Prefer a visibly confirmed 90-day window; complete rows from that exact window can establish its sold-unit count. A three-year total with a latest-sale date cannot supply 30/90/365-day velocity.

Start `node scripts/serveRetailObservationInbox.mjs` and save visible Seller Hub captures through `http://127.0.0.1:4319/research`. The inbox writes the ignored local `exports/arbitrage-finds/browser-product-research.json`. Save query, URL, actual displayed start/end dates, capture time, New/Vinyl filters, complete-pagination status, and rows. Credentials, cookies, hidden state, buyer data, and account identifiers are excluded.

Displayed date-window endpoints are calendar dates in the research URL's `tz`, not midnight UTC timestamps. A capture may describe results ending on the same or previous local calendar day. Compare those dates in that timezone (UTC only for legacy URLs without `tz`), while independently enforcing capture freshness. Invalid timezones, future end dates, older windows, incomplete pagination, duplicate rows, and incompatible editions cannot establish window totals.

Seller Hub sometimes omits applied filters from its URL. After visibly confirming New, Vinyl Records and the selected Sold tab, captures may include `observedFilters: {conditionId: "1000", categoryId: "176985", tabName: "SOLD"}`. These explicit control observations fill missing URL parameters only; a conflicting URL condition, category or Active tab still fails. Do not infer these fields from a desired search or from result titles.

Import with `node scripts/importBrowserSoldResearch.mjs <scan-draft> <browser-captures>`. The importer matches artist/album queries to exact find IDs in that draft and merges into `research-checkpoint-<runId>.json`; a checkpoint from another run is rejected. Alternatively finish the saved workflow with `--browserResearch=<browser-captures>`, which imports before curation. Omitting `--research` resumes the workflow's existing checkpoint. An empty or failed checkpoint never becomes completed research.

## Provisional album price comparisons

Three-year New/Vinyl captures also support a separate `albumPriceBenchmark` across pressings of the same artist and album. It reports the observed listing-average item-price range, unit-weighted mean and median, and captured sold-unit count. Shipping is excluded. More than ten observed units is a volume-supported comparison; ten or fewer remains a visible thin sample. Partial result pages can establish this provisional range, with the captured unit count explicitly treated as a lower bound. They cannot establish a complete market range, exact pressing resale price, recent velocity, or automatic BUY.

The draft importer and curator attach this field independently of strict research completion. To add ranges to an already published run, prepare a new `evidence_updates` artifact using the workflow documented in README. The server requires the exact current baseline run ID, retains all products and original retailer/source/campaign observations, and changes only valid matching album benchmarks. It does not relabel pending exact research as complete or refresh acquisition timestamps.

## Sold-evidence improvement priorities (October 1, 2026)

The October 1 audit found 19,532 retained own-sales records and 916 visible-browser captures spanning 416 distinct queries. These include overlapping captures, 517 outside the import freshness window, and 268 incomplete captures; those categories overlap. Capture count is not research coverage. The latest publication contained 77 record offers plus 32 campaign alerts.

A read-only replay against the same 77 offers found that the old 36-hour UTC-midnight check discarded otherwise verified 90-day quantities for 22 offers captured during the scheduled Pacific morning session. Calendar-aware validation recovered these counts without changing prices, dates, rows, edition matching, or buy thresholds: verified-window coverage increased from 31 to 53 offers. Nine retained only aggregate evidence, 14 were pending, and one had no compatible rows. This replay is not a new production publication or proof of a profitable buy.

The persistent research queue now implements these priorities for usable evidence per distinct release:

1. Validate the displayed Sold/New/Vinyl filters, actual date header, item identities, and pagination while capturing. Save each result immediately; retry failed captures rather than recording them as successful zero-sales searches.
2. Deduplicate work by artist/album query, then match each retailer's edition separately. Resume unfinished evidence tasks across scans using stable release identity, while retaining original capture dates and existing freshness/display limits. Never sum overlapping captures as additional sales.
3. Separate album demand, exact-edition price, and measured-window velocity. Missing color or pressing information should trigger targeted item-specific/identifier review; an actual conflicting edition remains excluded. Existing album benchmarks remain provisional and need fresh captures to populate.
4. Use a verified 90-day window first. For a plausible slow seller with thin recent demand, research a verified 365-day window; a three-year total remains historical context and cannot become recent velocity.
5. Add demand-led sourcing alongside clearance discovery: use observed release-level sales to set an acquisition-price ceiling, then search current retailer offers. Own-sales absence is not evidence of zero market demand.
6. Measure distinct queries attempted/completed, exact-edition matches, fresh price coverage, verified-window coverage, and explicit rejection reasons. Refresh stale high-priority evidence before spending the research budget on repeated captures or new sources.

eBay Product Research remains the available marketplace-wide research surface. A licensed marketplace sold-data API may improve throughput if access is confirmed; ordinary seller-history sync only covers the authorized seller's own sales. No unconfirmed third-party feed or active asking price should be presented as sold evidence.

`prepareArbitrageResearchPlan.mjs` automatically imports fresh saved captures into the exact draft checkpoint. It groups retailer offers by normalized artist/album query and emits one task per required date window, with all edition-specific targets attached. Rebuilding a plan after each research batch removes completed work. Tasks report `pending`, `repair`, `refresh`, or `complete`; access failures get a bounded retry delay. A newer failed or incomplete capture cannot replace a usable verified capture. Complete empty searches are reusable too, without becoming positive demand.

The plan's `editionReviews` identifies captured searches with no confirmed retail-edition match. Its `sourcing` list provides evaluator-derived acquisition ceilings for verified exact sales. The scanner also consults fresh exact captured sales before filtering retailer offers, allowing documented demand to admit records without a sale badge. Annual follow-up is scheduled only for a thin positive recent sample with at least $12 estimated net and 50% ROI; the estimate is a research priority, not a buy recommendation. Separately observed 90-day and 365-day quantities are retained without adding overlapping periods.

The ignored local `research-queue-state.json` preserves opaque task hashes, timestamps, attempt counters and reason codes across scans. It contains no queries, retailer/eBay titles, prices, images, URLs, sellers, descriptions or raw item IDs; raw captures and working plans remain separate ignored evidence artifacts. Untouched task state expires after 30 days. Capture reuse remains limited to seven days, and the six-hour eBay display window is unchanged. Operational status distinguishes distinct query windows from the number of offers covered and reports repair, refresh, pending, retry and edition-review counts.
