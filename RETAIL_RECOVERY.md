# Retail deal recovery — October 28, 2026

The scanner encountered the reported Talking Heads and AC/DC offers, but hid them behind definitive economics rejections using incomplete evidence or assumed costs. Separately, the daily workflow grew to 6,002 required offer searches. Evidence expired faster than it was collected, and fresh discovery could not reach publication. These were functional failures, not evidence that no deals existed.

## Changes

- The sale-radar scan selects at most 12 distinct albums by default. A third of its capacity is reserved for recent advertised deal events; remaining capacity balances observed album demand and unfamiliar offers. Explicit `--maxResearchPoolSize` and comprehensive diagnostics remain available. Artist familiarity supplies no valuation or buy status.
- All discovered offers remain in the private scan draft. Unselected offers and historical obligations are explicitly deferred, never counted as completed. Fresh matching research can be reused; acquisition prices and observation times are never refreshed by copying old offers.
- `--full` starts a new scan. Automatic and explicit continuation require a draft no older than 24 hours. Expired `--finish` refuses before enrichment or publication. Lease rollover requires exact, durable reciprocal supersession and preserves profile ownership.
- Slickdeals uses its publisher RSS feeds for newest and popular vinyl posts. Duplicates, explicit expiry, stale dates, missing prices, unavailable feeds and excluded formats retain separate outcomes. An MP3/AutoRip bonus no longer excludes a physical vinyl record; selected digital SKUs still fail.
- The Retail Arbitrage page independently reads `/api/arbitrage/deal-radar`. Current advertised leads remain accessible even when the daily researched publication is missing or interrupted. The panel polls every five minutes while visible, expires stale responses, and never labels a feed price as verified stock or profit.
- A negative estimate based on unconfirmed pricing, edition, acquisition or inbound shipping stays REVIEW with its assumptions. Fully supported negative economics may still reject. Explicit false identity/edition flags cannot establish sold evidence. BUY keeps all evidence and full-ledger gates.
- Failed workflow contexts retain a sanitized failure code, stage and explanation. Private raw diagnostics and marketplace content are not copied into the learning store.

## Runtime safeguards retained

Existing local browser recovery changes have been reconciled into source: ownership leases, process mutexes, exact seller/profile binding, attempt timestamps, validated observation intake, edition review outcomes, measured throughput, and upload readback. See `RESEARCH_BROWSER_RECOVERY.md`. Neither public feeds nor a successful browser connection count as completed sold research.

## Validation and activation

Run `npm test` and `npm run build`. `npm run dev -- --port 5183` provides the local UI and feed route. A safe targeted diagnostic is:

```powershell
node scripts/runRetailArbitrageScan.mjs --sources=slickdeals-vinyl-records --skipUpload --skipActiveEnrichment --skipEbaySync
```

`node scripts/runRetailWorkflow.mjs --localOnly` suppresses production status and upload writes. Finishing with `--localOnly` still enforces completion and runs final upload validation in dry-run mode. It may read configured services and write local diagnostic artifacts.

Activation requires both the application release and the scheduled runner/prompt update. The primary checkout has previously uncommitted operational repairs; preserve its exports, credentials, browser ownership files and unrelated work. Do not replace or reset that checkout wholesale. The prepared automation prompt retains the existing 5:30 a.m. America/Los_Angeles schedule and all purchase, account, publication and watchdog boundaries.

After activation, verify the live feed endpoint and UI, then complete one current selected cohort through exact retailer/edition research, curation, upload and run/hash readback. A zero verified-buy result is legitimate; calling an unfinished or stale run successful is not. Recurring reliability remains unproven until actual scheduled runs finish with fresh useful results.

The private audit and source research are in `outputs/retail-recovery-audit/`. They cover all 333 retained scan/final artifacts, 82 workflow records, 24 attempt receipts and 30 watchdog events, with explicit limits where older failures did not preserve their cause.
