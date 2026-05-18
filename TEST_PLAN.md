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
- No secrets appear in browser source, network payloads, or committed files.


