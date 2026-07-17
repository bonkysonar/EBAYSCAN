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
