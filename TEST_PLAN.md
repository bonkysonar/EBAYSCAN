# Test Plan

## Manual Flow

1. Run `npm install`.
2. Run `npm run dev`.
3. Enter `012345LOW` in barcode mode and press Enter. Expect GREEN.
4. Enter `999999RARE` in barcode mode and press Enter. Expect RED or YELLOW depending on risk mix.
5. Enter `60296-1` in catalog-number mode and press Enter. Expect YELLOW because the mock includes overlapping matches.
6. Enter `mixed ambiguous vinyl` in manual mode and press Enter. Expect YELLOW.
7. Adjust the threshold in Settings and verify the result changes after searching again.
8. Upload an image and verify the image path uses the same marketplace/scoring flow.

## Automated Tests

Run `npm test`.

Coverage should include:

- Low-value obvious records score GREEN.
- High-value obvious records score RED.
- Mixed or ambiguous results score YELLOW.
- Overlapping catalog-number results stay YELLOW.
- Risk keywords prevent GREEN.
- Barcode, catalog-number, manual, and image inputs share the marketplace interface.
- Price normalization.
- Title normalization.
- Consensus extraction.

## API Mock Testing

Mocks should remain deterministic and credential-free. Add fixture cases whenever scoring behavior changes.

## Future Real eBay Testing

Use official eBay APIs only. Add integration tests behind environment-gated configuration and keep unit tests independent from credentials.
