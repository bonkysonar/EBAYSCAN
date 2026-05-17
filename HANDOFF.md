# Handoff

Last updated: 2026-05-17

## Current Branch

- Branch: `feature/ebay-browse-integration`
- Base/current pushed main commit: `15a343e Build record scanner MVP`
- Current feature work is uncommitted unless this file is committed later.
- Do not deploy unless David explicitly asks.
- Do not commit `.env.local`; it contains eBay credentials and is ignored.

## Product Semantics

The color meanings were intentionally flipped from the original brief:

- `GREEN`: likely worth processing/listing because pricing clusters above threshold.
- `YELLOW`: ambiguous or needs manual review.
- `RED`: likely safe to skip or move to bulk.

Default threshold is still `$5`.

## eBay Integration Status

Real active-listing lookup is wired through a local Vite dev-server endpoint:

- Browser client: `src/lib/ebay/client.ts`
- Local API/server middleware: `vite.config.ts`
- Mock fallback: `src/lib/ebay/mockClient.ts`

`.env.local` should contain:

```env
EBAY_ENV=production
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_ID=EBAY_US
```

The app now uses eBay OAuth client-credentials flow to mint and cache application tokens automatically. Manual `EBAY_ACCESS_TOKEN` is no longer needed.

## Search Behavior

Manual search:

- Runs eBay Browse API active-listing search.
- Adds `vinyl record` to the query.
- Defaults to used condition.

Catalog/barcode search:

- Runs a primary identifier search.
- Derives likely artist/title tokens from the primary results.
- Runs an expanded artist/title query.
- Merges and dedupes both result sets.
- Uses eBay `limit=200` instead of the previous `20`.

Condition filter:

- `used`: sends `conditions:{USED}`.
- `new`: sends `conditions:{NEW}`.
- `both`: sends no condition filter.

The Price Cluster panel now displays `rawSummary`, including query plan, returned counts, and eBay total-match counts.

Example verified:

```text
Catalog: BXL1 0209
Primary: "BXL1 0209 vinyl record" total=5 returned=5
Expanded: "quah jorma kaukonen tom hobson vinyl record" total=66 returned=66
Merged: 66 unique listings
```

## Sold Listings / Product Research

Current key can mint tokens and use Browse API, but Marketplace Insights remains blocked:

```text
/buy/marketplace_insights/v1_beta/item_sales/search
403 Access denied / Insufficient permissions
```

Sold comps, sold count, and 90-day sell-through are not available yet through the current eBay API access.

Recommended future UI:

- Show active listing count now.
- Show returned/analyzed listing count now.
- Show sold comps status as unavailable until Marketplace Insights access is granted.
- If access is granted later, add 90-day sold count, median sold price, and sell-through ratio.

Phrase for eBay access request:

```text
Request production access to the Buy Marketplace Insights API, specifically item_sales/search, for Product Research / sold-comps lookup in a resale pricing workflow.
```

## Known Issues / Risks

- Active asking prices are not sold comps. UI/docs should keep that distinction visible.
- eBay Browse results can include irrelevant listings; scoring is conservative but still early.
- Identifier expansion is heuristic. It works for the tested `BXL1 0209` example but needs more real-world cases.
- Browser automation had clipboard issues in Codex, so some UI checks were verified through direct local API calls instead.
- Vite middleware currently lives in `vite.config.ts`; long term, a dedicated backend/API module would be cleaner.

## Verification Commands

```powershell
npm test
npm run build
```

Both passed after the latest scoring and eBay integration changes.

Manual dev run:

```powershell
npm run dev
```

Useful inputs:

- Manual: `fleetwood mac rumours`
- Catalog: `BXL1 0209`
- Manual: `QUAH Jorma Kaukonen`
- Demo/mock barcode: `012345LOW`
- Demo/mock barcode: `999999RARE`

## Files Most Relevant For Next Session

- `vite.config.ts`: local eBay endpoint, token minting, Browse API query, identifier expansion.
- `src/lib/ebay/types.ts`: shared marketplace/search types.
- `src/lib/ebay/client.ts`: browser-side client calling local endpoint.
- `src/lib/scoring/scoreRecord.ts`: GREEN/YELLOW/RED scoring.
- `src/components/SearchInputPanel.tsx`: barcode/catalog/manual/image inputs and condition selector.
- `src/components/PriceClusterSummary.tsx`: displays price summary and query/source summary.
- `README.md`, `DECISIONS.md`, `TEST_PLAN.md`, `DATA_MODEL.md`, `PROJECT_BRIEF.md`: updated docs.

## Suggested Next Steps

1. Add a Market Snapshot component showing active listed total, returned/analyzed count, search plans used, and sold-comps status.
2. Commit the current feature branch once David is happy with the direction.
3. Add more catalog/barcode real-world fixtures and tune identifier expansion.
4. Split Vite middleware logic out of `vite.config.ts` into a dedicated local server module.
5. Request eBay Marketplace Insights API access for sold comps.
