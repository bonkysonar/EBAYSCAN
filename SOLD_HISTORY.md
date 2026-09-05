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

Import with `node scripts/importBrowserSoldResearch.mjs <scan-draft> <browser-captures>`. The importer matches artist/album queries to exact find IDs in that draft and merges into `research-checkpoint-<runId>.json`; a checkpoint from another run is rejected. Alternatively finish the saved workflow with `--browserResearch=<browser-captures>`, which imports before curation. Omitting `--research` resumes the workflow's existing checkpoint. An empty or failed checkpoint never becomes completed research.
