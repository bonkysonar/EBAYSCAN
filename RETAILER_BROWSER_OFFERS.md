# Exact retailer offers discovered through feeds

The feed is discovery provenance. A selected feed candidate may be acquisition-verified from a normal visible browser observation of the exact U.S. Amazon, Target or Walmart product. This is a bounded product verification bridge, not a new source, catalog crawler, background request or whole-store coverage claim. It never supplies sold demand or overrides the normal `BUY` gates.

Save the observation through the existing retailer inbox. Keep `sourceId` equal to the selected candidate's existing feed source (`reddit-vinyl-deals`, `slickdeals-vinyl-records` or `vinyl-price-drop`). Use the actually observed primary product URL in `url`. Amazon ASIN, Target TCIN and Walmart item ID are exact product identities. Another product, country, seller/condition URL override or unsupported retailer fails closed.

The document retains the usual `version: 1`, `captureMethod: "visible_browser"`, `pages` wrapper. Each page has `capturedAt`, `outcome: "available"`, public `visibleText`, the selected new-offer `purchaseBlockText` as an exact substring, `productHeadingText`, `artistText`, and `productEvidence` with artist, album, generic physical `format` (`Vinyl` or `LP`), current price, `currency: "USD"` and `available: true`. A barcode is optional; if supplied, it must be visibly shown and match the candidate's existing barcode. Never infer a barcode from another edition.

Add this explicit marker and its actually observed values:

```json
{
  "retailerOfferEvidence": {
    "retailerId": "amazon",
    "productId": "B000ABCDEF",
    "selectedFormat": true,
    "selectedFormatText": "Format: Vinyl",
    "editionText": "Selected edition text, if shown",
    "condition": "new",
    "conditionText": "Buy New",
    "priceText": "$14.99",
    "availabilityText": "In Stock",
    "purchaseActionText": "Add to cart",
    "sellerText": "Shipper / Seller\nAmazon.com",
    "fulfillerText": "Shipper / Seller\nAmazon.com"
  }
}
```

The example is a schema, not evidence to copy. Price, stock, condition, seller and fulfilment snippets must be inside the selected purchase block; artist, title, selected format and edition may be separately visible on the same product page. Confirm the selected physical format visibly before setting `selectedFormat`. Isolate the selected New offer from separate Used offers and format alternatives. The combined Amazon `Shipper / Seller` label is supported, as are explicit `Sold by` / `Ships from` or Target/Walmart first-party `Sold and shipped by` labels. Missing explicit new-condition or first-party seller/fulfiller evidence does not become verified merely because a retailer has a standard product page. Third-party and used offers stay unverified.

A dollar price on these exact U.S. hosts supports USD when the selected offer has no contrary currency signal. Do not invent visible `USD` text. If a currency label is visibly present, retain it in optional `currencyText`. Coupon, member-only or conditional prices without an implemented verification contract remain unverified.

Unknown inbound shipping remains unknown and uses the existing conservative ledger. To record an actually displayed unconditional shipping quote for this selected offer, optional `shippingEvidence` contains `amount`, `currency: "USD"` and exact `visibleText`, such as `FREE delivery Tomorrow, October 30.`. Do not treat a threshold, membership offer, coupon or generic banner as free shipping. Keep stock/shipping snippets minimal and omit delivery addresses, ZIP codes, names and account details. A current signed-in purchase quote is an observation for that user and time, not a general shipping policy.

If the candidate only contains a discussion URL, first follow its actual visible link. Record `discoveryLinkEvidence` with that exact candidate `sourceUrl`, fresh `capturedAt`, the clicked `linkUrl`, its actual `linkText` and containing public `visibleText`, plus the observed final `resolvedUrl`. The final product must match the retailer observation. Artist/album similarity or a manually guessed URL is insufficient. Keep the original discovery link separately when the verified product becomes the direct purchase URL.

Both product evidence and followed-link evidence expire after six hours. The curator revalidates the exact offer and stores only normalized product snippets as `retailerOfferObservation`, under method `visible_browser_retailer_offer`. A changed pressing or barcode clears old pressing-specific sold evidence before rematching. Publication revalidates the bounded snapshot, its price, identity, timestamps and shipping; a mutated verified flag or added raw page data cannot pass.

Bridge pages are excluded from source catalogs, fetch caches, candidate generation and browser catalog diagnostics. They verify already-selected offers and cannot create productive source coverage. A bridge-only browser recovery cannot start a source-update workflow. Source updates require the existing originating source report and keep unchanged sources at their original timestamps.
