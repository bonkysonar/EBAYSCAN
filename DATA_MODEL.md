# Data Model

## SearchInput

Discriminated union for lookup requests:

- `{ type: "barcode"; barcode: string }`
- `{ type: "catalog"; catalogNumber: string }`
- `{ type: "manual"; query: string }`
- `{ type: "image"; imageBase64: string; fileName?: string }`

Each input may include `conditionFilter?: "used" | "new" | "both"`. The UI defaults to `used` because most triage lookups are for used albums.

Catalog numbers may contain letters, numbers, spaces, hyphens, slashes, and label-specific formatting. They are lookup hints rather than exact pressing identifiers.

## CandidateListing

Marketplace candidate returned by a client:

- `id`
- `title`
- `price`
- `shippingPrice`
- `totalPrice`
- `currency`
- `condition`
- `imageUrl`
- `itemUrl`
- `source`
- `matchSignals`
- `raw`

## SearchResult

- `input`
- `listings`
- `source`
- `timestamp`
- `warnings`
- `rawSummary`: includes active eBay query plan, returned listing counts, and total-match counts when available

## TriageDecision

- `decision`: `GREEN`, `YELLOW`, or `RED`
- `GREEN`: worth processing/listing
- `YELLOW`: manual review needed
- `RED`: likely safe to skip/bulk
- `confidence`: number from 0 to 1
- `threshold`
- `priceSummary`
- `reasons`
- `warnings`
- `topListings`
- `suggestedAction`

## Price Summary

- `lowestTotalPrice`
- `averageCheapestTenTotalPrice`: average of the cheapest title-matching comparable listings, used as the main low-end triage signal
- `cheapestTenCount`
- `medianTotalPrice`
- `trimmedMedianTotalPrice`
- `resultCount`
- `relevantResultCount`: title-matching listings used for low-end pricing when manual artist/title search is available
- `sameTitleClusterCount`
- `highOutlierCount`
- `priceSpread`

## Settings

- `threshold`: default target value threshold, initially `5`
- `minimumResultsForSkip`
- `minimumConfidenceForSkip`
- `highOutlierMultiplier`
- `wideSpreadMultiplier`
- `riskKeywords`

## Seller Price Analyzer

`SellerListing` preserves the seller's exact item ID, SKU/custom label, title, current item price and currency, listing type, variation indicator, quantities and dates. Flat shipping is optional; missing or calculated shipping stays unknown. Currency is read from the XML price attribute rather than defaulting all listings to USD.

`SellerPricingAnalysis` version 4 includes `analyzedAt`, `comparisonBasis: item-price`, `matchedCount`, exact retained `comparableIds`, the median of up to ten lowest matched item prices, percentage difference, status, confidence, seller coverage, rejection counts and reasons. `activeComparableCount` stays null because a raw query total does not prove equivalent-copy supply. The old crowded statuses remain readable for historical CSVs. Active asking prices do not prove sold value or demand.

`AnalyzerRow` separates inventory, evidence, analysis state and user-authored workflow fields (`isTaggedForChange`, `proposedPrice`, `changeNote`). Browser persistence uses IndexedDB; runner persistence uses a private atomic checkpoint plus per-row journal. Only fresh current-version evidence supports review drafts. Changes to inventory invalidate analysis while preserving review notes. The UI retains only the matched benchmark sample and removes raw API payloads.

The faster-sales draft policy suggests reductions only when at least three known-grade matches support a benchmark at least 5% below current price. Supported evidence requires at least five matches, at least two known sellers and a bounded price spread; its cap is 20%. Other usable samples are tentative and capped at 10%. Fewer than three matches, unknown own condition, conflicting condition, auctions, variations and mixed lots cannot supply drafts. Explicit description grades retain provenance; unknown grades are never inferred. This is a review proposal, not a profitability claim or live eBay revision. Unknown shipping, cost basis, sleeve condition and exact pressing require review.

## Retail scanner publication and learning additions

Schema 2 final artifacts support `publicationMode: full | source_updates`. Source updates require `sourceUpdateVersion: 1`, an authoritative source manifest, fresh observations, and successful catalog/sale-page evidence for the appropriate data. `sourceUpdates` records updated/retained source IDs and the last broad success/attempt timestamps. A sale-only check cannot refresh product prices. Immutable run storage and the atomic latest pointer are unchanged.

Product additions: resolved artist identity/provenance; physical-format confirmation; exact variant verification status/time; campaign application checks; an explicit remaining-check decision-list assessment. Campaign additions: versioned terms (scope, percent/fixed/BOGO, thresholds, exclusions, stacking, dates, membership), illustrative basket scenarios, and per-campaign funnel counts. The broad research pool remains in the draft and is dropped from the public final artifact after curation.

Operational status is stored separately from the latest publication so failed attempts remain visible. Sanitized feedback stores only an opaque offer hash, observation hash, run hash, rank, enumerated outcome, and timestamp. Successful-empty-research memory stores hashes/status/time. No marketplace content is added to either learning store. Vinyl Lots and its six-hour display boundary are unchanged.

