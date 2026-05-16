# Data Model

## SearchInput

Discriminated union for lookup requests:

- `{ type: "barcode"; barcode: string }`
- `{ type: "catalog"; catalogNumber: string }`
- `{ type: "manual"; query: string }`
- `{ type: "image"; imageBase64: string; fileName?: string }`

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
- `rawSummary`

## TriageDecision

- `decision`: `GREEN`, `YELLOW`, or `RED`
- `confidence`: number from 0 to 1
- `threshold`
- `priceSummary`
- `reasons`
- `warnings`
- `topListings`
- `suggestedAction`

## Settings

- `threshold`: default target value threshold, initially `5`
- `minimumResultsForGreen`
- `minimumConfidenceForGreen`
- `highOutlierMultiplier`
- `wideSpreadMultiplier`
- `riskKeywords`
