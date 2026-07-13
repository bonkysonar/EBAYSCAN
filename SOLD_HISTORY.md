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

## Condition Rules

Records are classified as `new_sealed` when the title or custom label includes signals like `Factory Sealed`, `Brand New`, `New/Sealed`, `New Sealed`, `Sealed`, or when the custom label starts with `Whole`.

Records are classified as `used` when the title includes a media/sleeve grade pair such as `VG+/VG`, `EX/NM`, or `NM/VG+`.

Everything else stays `unknown` so the automation can treat it cautiously.
