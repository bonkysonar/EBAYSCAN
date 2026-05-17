# Test Plan

## Manual Flow

1. Run `npm install`.
2. Create `.env.local` with `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` if testing real eBay lookup.
3. Run `npm run dev`.
4. Leave Condition set to Used, enter `fleetwood mac rumours` in manual mode, and press Enter. Expect real eBay used-condition results if the token is valid.
5. Enter `BXL1 0209` in catalog-number mode and press Enter. Expect a source summary showing both a catalog-number query and an expanded artist/title query if eBay returns enough title clues.
6. Enter `012345LOW` in barcode mode and press Enter. Expect real eBay lookup if token is valid; explicit mock fallback should classify this demo input as RED skip if real lookup fails.
7. Upload an image and verify the image path uses mock data with an image-placeholder warning.
8. Switch Condition to New and Both and verify searches still run.
9. Adjust the threshold in Settings and verify the result changes after searching again.

## Automated Tests

Run `npm test`.

Coverage should include:

- Low-value obvious records score RED.
- High-value obvious records score GREEN.
- Mixed or ambiguous results score YELLOW.
- Overlapping catalog-number results stay YELLOW.
- Risk keywords prevent RED skip.
- Barcode, catalog-number, manual, and image inputs share the marketplace interface.
- Price normalization.
- Title normalization.
- Consensus extraction.

## API Mock Testing

Mocks should remain deterministic and credential-free. Add fixture cases whenever scoring behavior changes.

## Future Real eBay Testing

Use official eBay APIs only. Keep unit tests independent from credentials. Add integration tests behind environment-gated configuration once token minting is automated.

