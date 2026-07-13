# Retail Arbitrage Workflow

Captured from David's current process on 2026-06-26.

## Source List

The source inventory lives in `src/lib/arbitrage/vinylShopSources.ts`. It was captured from the Chrome tab group named `vinyl shops`.

## eBay Research Baseline

Use eBay active listings as the automated ranking step:

- Search active eBay listings in category `176985` for Vinyl Records.
- Filter to condition `NEW`.
- Normalize the source row to artist + album title before searching.
- Remove retailer/vendor copy, price text, format/color/edition noise, merch/accessory terms, source suffixes, and label/vendor values when the source title provides a cleaner `Artist - Title`.
- Rank by the spread between source all-in cost and the cheapest matching active new-vinyl eBay listing.
- Keep the Seller Hub Product Research link on each row for manual sold-history validation, but do not use Product Research as the default automated scoring input.

Use eBay Seller Hub Product Research as the manual validation step:

- `tabName=SOLD`
- `dayRange=1095`
- `sorting=-itemssold`
- `marketplace=EBAY-US`
- Prefer sold price plus shipping as the comparable sale amount.

The current manual Product Research URL shape is:

```text
https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=<artist-or-title>&dayRange=1095&categoryId=176985&conditionId=1000&offset=0&limit=50&sorting=-itemssold&tabName=SOLD&tz=America%2FLos_Angeles
```

For retail arbitrage, Product Research links should be constrained to new vinyl:

- `categoryId=176985` for Vinyl Records.
- `conditionId=1000` for New.
- `dayRange=1095`, `sorting=-itemssold`, and `tabName=SOLD`.
- Treat local sold history as a fast cache only. If it has fewer than three useful new/sealed comps, or does not answer the repeat-seller question, eBay Product Research is still required.
- For soundtracks, try broad query variants before accepting thin evidence: core title, core title + `Soundtrack`, and core title + `OST`. Use the variant that returns the strongest relevant sold evidence.

## Initial Buy Rules

These are the current human rules to turn into a ratioed scoring table:

- Strong buy candidate: eBay Product Research shows a seller has sold 10 or more copies of the same album in the last 3 years.
- Minimum spread: all-in purchase price, including source-site tax, should leave at least `$5-$7` between cost and average sold price plus shipping.
- Single-copy sold history: route into a separate review category instead of an automatic buy.
- Thin sold history plus many active listings: usually reject.
- Thin sold history plus few/no active listings: review manually; scarcity can occasionally make it worth testing.

## Signals To Capture Per Candidate

- Source site and source URL.
- Candidate title and artist.
- Purchase price.
- Estimated source-site tax.
- Estimated shipping to David.
- All-in unit cost.
- Bulk quantity available, when visible.
- eBay 3-year total sold count.
- Evidence that one seller has sold 10 or more copies, when visible.
- Average sold price plus shipping.
- Current active eBay listing count.
- Lowest active eBay price plus shipping.
- Estimated margin dollars.
- Estimated margin ratio.
- Decision bucket: `BUY`, `WATCH`, `REVIEW`, or `REJECT`.

## Daily Automation Plan

The Codex app automation `daily-vinyl-retail-arbitrage-scan` runs daily at 5:30 a.m. local time. The default mode is now a sale radar, not a comprehensive per-record pricing sweep. Its job is to:

1. Read the source list from `src/lib/arbitrage/vinylShopSources.ts`.
2. Detect broad sale signals such as 30%+ off, site-wide/store-wide sales, all-vinyl sales, warehouse/clearance sales, and BOGO offers.
3. Keep only high-signal product candidates from final-deal, clearance, price-drop, and sale-heavy sources.
4. Validate those product candidates against local sold history only.
5. Write a small importable JSON payload into `exports/arbitrage-finds/`.
6. Publish the final newest JSON payload to the hosted Vercel site with `node scripts/uploadLatestArbitrageFinds.mjs` after any Product Research validation/enrichment step.

The default daily scan now attempts capped active-listing enrichment when `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` are configured. If credentials are missing, the scan still completes and records active enrichment as skipped. eBay Product Research links are still generated for manual review.

```bash
# Default: sale radar with capped product finds and sale alerts
node scripts/runRetailArbitrageScan.mjs

# Upload the newest local JSON to the hosted Vercel site after validation/enrichment
node scripts/uploadLatestArbitrageFinds.mjs

# Optional old behavior for an intentional broad scan
node scripts/runRetailArbitrageScan.mjs --mode=comprehensive

# Optional capped active-listing enrichment after reviewing the sale radar output
node scripts/enrichArbitrageActiveEbay.mjs --max=25 --concurrency=1

# Local validation only: do not enrich or publish the generated payload
node scripts/runRetailArbitrageScan.mjs --skipActiveEnrichment --skipUpload
```

The sale radar checks both the configured catalog URL and the store homepage, then follows a small capped set of sale links that the store actually publishes. A stale configured path can therefore fall back to a working homepage instead of losing the entire source. Successful fallback URLs are carried into later runs so the same known 404 is not retried every day. `--maxDiscoveredSalePages=<n>` controls the per-store discovery cap, `--fetchTimeoutMs=<n>` controls the request timeout, and `--sources=<id-1,id-2>` limits a diagnostic run to named catalog sources. `--discoveryDetailLimit=<n>` and `--discoveryConcurrency=<n>` cap structured discovery-source detail requests.

### Structured Discovery Sources

- **Reddit VinylDeals:** reads the official public Atom feed at `/r/VinylDeals/new/.rss` and falls back to the old Reddit HTML feed when Atom is blocked or rate-limited. The adapter extracts the post price, publication time, discussion URL, and preferred direct retailer URL while excluding helper/Discord/social links. `r/VGMvinyl` remains catalog metadata but no longer displaces VinylDeals through domain deduplication.
- **Vinyl Price Drop:** reads current deal cards from `/deals`, follows a capped set of detail pages to obtain current price, prior price, discount, retailer URL, and expiration state, and separately verifies `/deals/type/sitewide` entries. Expired sitewide entries are discarded rather than treated as active alerts.

Both are discovery sources. Product listings point to the direct retailer when available and retain the discovery page as evidence. Sitewide findings remain labeled as unverified leads until the retailer itself confirms the offer.

## Site-wide Sale Discovery Improvement Plan

The unchanged daily sale list was primarily a coverage problem: the July 12 run had 47 failed sources, including many valid stores behind stale catalog paths. The first remediation is now implemented: homepage fallback, same-store sale-link discovery, request timeouts, structured page-health reporting, campaign fingerprints, and New / Changed / Ongoing labels. Aggregator results are labeled as unverified discovery leads rather than confirmed retailer sales.

The next improvements should be delivered in this order:

1. **Measure direct-retailer coverage every day.** Track healthy, recovered, blocked, and failed sources separately; alert when direct-retailer coverage falls below 85% or changes sharply. Keep stale paths out of the blocked count when a working homepage was scanned.
2. **Add source-specific official feeds and adapters for priority stores.** Prefer Shopify catalog endpoints, retailer RSS/Atom feeds, sitemaps, public promotion pages, and email/newsletter inputs where available. Build small maintained adapters for the high-sale-likelihood stores that cannot be understood from generic HTML. Do not attempt to bypass access controls on 403/412 sources; route those to assisted browser review or an approved feed.
3. **Use a two-stage discovery and confirmation pipeline.** Let deal sites and community feeds nominate a retailer and offer, then confirm the offer on the retailer's own page before counting it as a retailer sale. Keep unconfirmed leads visible in their own queue with the actual linked retailer URL and evidence text.
4. **Track campaign lifecycle, not just today's phrase match.** Persist first seen, last seen, offer fingerprint, and consecutive successful observations. Highlight New and Changed campaigns, keep Ongoing campaigns quieter, and report Ended only after two successful scans no longer find the offer.
5. **Improve evidence extraction.** Store the exact short banner/link evidence, promo code, percentage, scope, expiration date when present, and the page that supplied it. Reject generic navigation labels such as “All Vinyl” unless they occur with a real discount, BOGO, coupon, clearance, or price-threshold signal.
6. **Tune from review outcomes.** Record confirmed sale, false positive, expired, and wrong-scope feedback. Review weekly recall/precision by source and add or tighten source rules based on that evidence.

The operating targets should be: at least 85% of direct retailer sources successfully checked, zero repeated known-404 probes after recovery is learned, all alerts linked to their evidence page, and a daily summary that leads with New / Changed retailer sales instead of repeating the full ongoing list.

The automation is intentionally review-oriented. It should not purchase anything, submit forms, alter listings, or dismiss finds.

## Retail Arbitrage Page

The app page lives at `#/retail-arbitrage`.

It currently supports:

- Automatically loading the newest daily findings JSON from `exports/arbitrage-finds/` through `/api/arbitrage/latest`.
- Filtering by decision and source.
- Sorting by margin, sold count, purchase price, decision, or newest.
- Dismissing and restoring finds.
- Tuning local buy parameters such as minimum margin, repeat-seller sold count, total sold count, source tax rate, and scarcity thresholds.
- Exporting the visible queue back to JSON.

Expected import shape:

```json
{
  "createdAt": "2026-06-26T12:30:00.000Z",
  "source": "daily-vinyl-retail-arbitrage-scan",
  "finds": [
    {
      "id": "source-stable-record-id",
      "sourceId": "vinyl-price-drop",
      "sourceName": "Vinyl Price Drop",
      "sourceUrl": "https://example.com/product",
      "artist": "Artist Name",
      "title": "Album Title",
      "purchasePrice": 12.99,
      "averageSoldPrice": 19.99,
      "averageSoldShipping": 5.00,
      "totalSoldCount": 18,
      "oneSellerSoldCount": 11,
      "activeListingCount": 4,
      "capturedAt": "2026-06-26T12:30:00.000Z",
      "notes": ["Short evidence note."]
    }
  ]
}
```

## Open Questions

- Whether the daily scan should start by scraping/reading source pages directly, by opening source pages for assisted review, or by accepting manually clipped candidates from the browser.
- Whether to require the 10-copy signal from one seller specifically, or allow total sold count across all sellers when one-seller evidence is unavailable.
- Whether the default margin floor should be `$5`, `$7`, or a tiered rule based on quantity and source reliability.
