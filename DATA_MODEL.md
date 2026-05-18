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

