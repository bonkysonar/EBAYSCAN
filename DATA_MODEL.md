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

`SellerListing` is a read-only active eBay store listing:

- `id`
- `title`
- `sku`
- `customLabel`
- `currentPrice`
- `currency`
- `condition`
- `availableQuantity`
- `quantitySold`
- `imageUrl`
- `itemUrl`
- `startTime`
- `endTime`

`SellerPricingAnalysis` compares a seller listing against active eBay comps:

- `benchmarkPrice`: active eBay cheapest-10 average
- `activeComparableCount`: eBay reported active match count for the best comparable query
- `deltaValue`
- `deltaPercent`
- `status`: `PRICE_HIGH`, `PRICE_LOW`, `CROWDED_PRICE_HIGH`, `VERY_CROWDED_PRICE_HIGH`, `OK`, or `NEEDS_REVIEW`
- `reasons`

Seller analyzer rows may also store browser-local workflow fields:

- `isTaggedForChange`
- `proposedPrice`
- `changeNote`
- `searchResult`: cached active eBay analytics for the row

The analyzer is read-only and does not revise live eBay listings. CSV exports include `sku`, `custom_label`, proposed price, change note, pricing recommendation fields, active comp count, and item URL for later bulk-change workflows.

