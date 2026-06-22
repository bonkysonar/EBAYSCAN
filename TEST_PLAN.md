# Test Plan

## Manual Flow

1. Run `npm install`.
2. Create `.env.local` with `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` if testing real eBay lookup.
3. Run `npm run dev`.
4. Leave Condition set to Used, enter `fleetwood mac rumours` in manual mode, and press Enter. Expect real eBay used-condition results if the token is valid.
5. Enter `BXL1 0209` in catalog-number mode and press Enter. Expect a source summary showing both a catalog-number query and an expanded artist/title query if eBay returns enough title clues. If `DISCOGS_USER_TOKEN` is configured, expect a Discogs match with lowest price and for-sale/have/want counts.
6. Enter `012345LOW` in barcode mode and press Enter. Expect real eBay lookup if token is valid; explicit mock fallback should classify this demo input as RED skip if real lookup fails.
7. Upload an image and verify the image path uses mock data with an image-placeholder warning.
8. Switch Condition to New and Both and verify searches still run.
9. Turn on Speed Mode. Verify the barcode input receives focus immediately, catalog/manual/image inputs are disabled, scanning/submitting a barcode works, and focus returns to the barcode input after the result appears.
10. When a Discogs match appears, verify the Discogs panel automatically tries to pull sales stats once and that the Pull Discogs Data button can retry it. If Discogs blocks the page pull, expect a clear blocker message.
11. Paste or upload saved Discogs Statistics text/HTML containing Last Sold, Low, Median, and High. Verify the Discogs panel displays the imported values and a below-threshold Discogs median prevents GREEN.
12. Install or reload the Chrome helper from `browser-extension/discogs-stats-helper`, run a result with a Discogs match, and verify Record Scanner automatically opens the visible Discogs helper shortly after the Discogs match appears.
13. Click Run Discogs Helper and verify it retries the same visible helper flow.
14. Adjust the threshold in Settings and verify the result changes after searching again.
15. Paste a different Discogs `/release/` URL into Discogs pressing URL. Verify the visible Discogs release updates immediately even if the stats pull is blocked.
16. Verify the Bulk Buy ledger adds each scan/search in stable sequential order.
17. Sort Bulk Buy by buy, sell, profit, album, condition, category, and reference price. Verify the Order column values do not change.
18. Resize Bulk Buy table columns and verify the table remains usable.
19. Delete a Bulk Buy row and verify totals update.
20. Click a Bulk Buy row and verify the middle review column restores that record's result.
21. Save a named Bulk Buy batch, load it from the Saved selector, download CSV, and reset the batch.
22. Verify Bulk Buy values round down to the nearest `$0.50`, show `$0.50` buys under `$5`, and include marketplace fee, 5% ad fee, shipping supplies, and self-employment tax in profit.
23. Open `#/seller-prices`. Verify the Seller Price Analyzer page is separate from the scanner and does not change scanner inputs/results.
24. With `EBAY_USER_ACCESS_TOKEN` configured, click Load Active Listings and verify active store listings load read-only.
25. Click Analyze Prices and verify rows are analyzed incrementally with current price, cheapest-10 average, delta percent, active comp count, and recommendation.
26. Click Pause Analysis while analysis is running. Verify the current row finishes, no new row starts, and Analyze Next continues pending rows without re-running completed rows.
27. Leave `#/seller-prices` and return. Verify active listings and completed analysis are restored from browser storage.
28. Click a compact seller row. Verify an analytics panel opens instead of navigating to eBay.
29. In the analytics panel, tag a row for change, enter a proposed price/note, close and reopen the row, and verify the values persist.
30. Filter by status and verify only matching analyzer rows remain visible, including tagged rows.
31. Sort by current price, delta, status, and active comps in both directions.
32. Click Download CSV and verify the export includes `sku`, `custom_label`, `item_id`, proposed price, change note, pricing recommendation, delta, active comp count, and item URL.
33. Click Import Snapshot CSV with a saved browser snapshot export. Verify analyzed rows restore without running eBay Browse calls, and SKU/custom label values are preserved when matching active listings were already loaded.

## Automated Tests

Run `npm test`.

Coverage should include:

- Low-value obvious records score RED.
- High-value obvious records score GREEN.
- Mixed or ambiguous results score YELLOW.
- Overlapping catalog-number results stay YELLOW.
- Risk keywords prevent RED skip.
- Manual artist/title searches calculate low-end value from the cheapest title-matching comparable listings.
- Visible candidate listings are sorted from lowest total price upward.
- Real eBay searches with more than 200 active matches paginate beyond the first page and report pages/returned counts in the source summary.
- Discogs sales statistics parser extracts Last Sold, Low, Median, and High from pasted text or saved HTML.
- Imported Discogs sales median prevents GREEN when it is at or below the configured threshold.
- Browser-helper Discogs median acts as the hard threshold decision with 100% confidence.
- Best-effort Discogs page pull reports blocked/failed page fetches without fabricating sales stats.
- Bulk Buy math rounds down to half-dollar increments and applies the low-price flat buy, title-match markdowns, fees, ad fee, shipping supplies, and tax calculations.
- Bulk Buy table sorting, deletion, CSV download, named save/load, and row click-to-review behavior.
- Pasted Discogs pressing URL fallback updates three different releases even when stats pulls are blocked.
- Seller Price Analyzer flags listings more than 25% above active eBay cheapest-10 average.
- Seller Price Analyzer flags possible underpricing more than 20% below active eBay cheapest-10 average.
- Seller Price Analyzer flags crowded pricing risk at 50+ active comps and very crowded risk at 150+ active comps.
- Seller Price Analyzer marks too-few-comps cases as NEEDS_REVIEW.
- Seller Price Analyzer uses the seller-pricing lookup profile, limiting Browse calls to the cheapest active comps and auto-pausing on 429 rate limits.
- Seller listing XML parser maps GetMyeBaySelling ActiveList XML to normalized seller listings.
- Seller listing parser captures SKU and CustomLabel for export workflows.
- Seller browser snapshot CSV import restores analyzed rows and preserves matching SKU/custom label metadata.
- Barcode, catalog-number, manual, and image inputs share the marketplace interface.
- Price normalization.
- Title normalization.
- Consensus extraction.

## API Mock Testing

Mocks should remain deterministic and credential-free. Add fixture cases whenever scoring behavior changes.

## Future Real eBay Testing

Use official eBay APIs only. Keep unit tests independent from credentials. Add integration tests behind environment-gated configuration once token minting is automated.

## Hosted Testing

Before deploying, run `npm test` and `npm run build`.

After a Vercel deployment, verify:

- Manual search returns real eBay results from `/api/ebay/search`.
- Catalog search still performs identifier expansion.
- Barcode search still accepts scanner-style Enter submit.
- Condition filter defaults to Used.
- Discogs data appears only when `DISCOGS_USER_TOKEN` is configured.
- Discogs sales stats pull either displays Last Sold/Low/Median/High or shows the Discogs browser-challenge/blocker message.
- The Download Chrome Extension link returns `record-scanner-discogs-helper.zip`.
- No secrets appear in browser source, network payloads, or committed files.


