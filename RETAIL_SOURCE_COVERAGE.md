# Retail source coverage

Last bounded live audit: 2026-07-22 from the local scanner host. A successful request below means the retailer exposed a public, read-only catalog response at that moment; it is not a promise that the retailer will keep the endpoint available.

## Structured direct-retailer coverage

The retail scanner can paginate Shopify `products.json` collection feeds. The following repaired targets returned HTTP 200 with a `products` array in the live audit. Counts are the first bounded page (`limit=250`), before the scanner's own pagination, availability, format, and candidate-quality filters.

| Source | Public collection feed | Products / available on first page |
| --- | --- | ---: |
| Capitol Records Store | `shop.capitolmusic.com/collections/vinyl` | 250 / 247 |
| Def Jam Store | `defjamshop.com/collections/vinyl` | 130 / 110 |
| EMI Store | `emirecords.com/collections/vinyl` | 250 / 250 |
| Verve Store | `store.ververecords.com/collections/9-98-up-vinyl-collection` | 66 / 58 |
| Rarewaves | `rarewaves.com/collections/vinyl` | 250 / 250 |
| Assai Records | `assai.co.uk/collections/a-z-vinyl-offers` | 250 / 250 |
| Plaid Room Records | `plaidroomrecords.com/collections/discounted` | 250 / 250 |
| Light in the Attic | `lightintheattic.net/collections/sale` | 43 / 43 |
| Mondo | `mondoshop.com/collections/new-vinyl-records` | 41 / 15 |
| Sister Ray | `sisterray.co.uk/collections/autumn-sale` | 49 / 15 |
| Vinilo | `vinilo.co.uk/collections/sale` | 106 / 88 |
| Daptone Records | `shopdaptonerecords.com/collections/lps` | 110 / 96 |
| Colemine Records | `coleminerecords.com/collections/lp` | 99 / 96 |
| Pure Noise Records | `purenoise.merchnow.com/collections/best-selling-vinyl` | 250 / 250 |
| Equal Vision | `equalvision.com/collections/vinyl-lp` | 250 / 250 |
| Sumerian Records | `sumerianrecords.com/collections/vinyl-records` | 122 / 122 |
| Rise Records | `riserecords.com/collections/vinyl-lp` | 235 / 230 |
| Third Man Records | `thirdmanrecords.com/collections/all-music` | 250 / 206 |

These counts are discovery inputs, not purchase recommendations. A product must still be in stock, identify a vinyl variant, survive landed-cost evaluation, and have reliable resale evidence before it can be a buy.

## Official marketplace coverage

- `ebay-purchase` is an official eBay Browse API source for new, fixed-price vinyl. It requires configured eBay OAuth credentials; destination-verified purchase evidence additionally requires `EBAY_DELIVERY_POSTAL_CODE`. A lane-balanced item-detail pass confirms artist, release, format, and structural record metadata before the offer can be trusted. Its item price plus explicit fixed shipping is a possible acquisition cost; active asking prices are not sold-price evidence.
- Amazon is intentionally not claimed as covered. There are no configured/approved Amazon product-discovery credentials, and the scanner must not scrape Amazon pages.

## Known external limitations

- Target's public category page does not currently expose a usable product catalog to the generic parser. The scanner must use an approved Target partner/affiliate data feed if access is granted; it must not call Target's private storefront APIs.
- Walmart returned HTTP 412 to bounded catalog requests from this host during the audit. That is reported as blocked/unknown coverage. The scanner must not evade the block.
- Rough Trade's corrected canonical sale route is `roughtrade.com/browse/sale`, but this host received an access challenge during the audit. A challenge is unknown coverage, not evidence that no sale exists.
- Banquet Records' removed `/vinyl` route was replaced with its live `/new-in` page. It has no verified public structured feed, so it remains generic-HTML coverage and may produce fewer candidates.
- Retailers returning 403/429/challenge responses remain visible in run diagnostics. They are not counted as successfully searched, and an empty result from those sources must never be presented as "no deals."

## Regression check

Run the source-catalog tests without making network requests:

```powershell
npm test -- --run src/tests/arbitrageSourceCatalog.test.ts
```

For a bounded live check, run selected sources without upload or production mutation:

```powershell
node scripts/runRetailArbitrageScan.mjs --sources=capitol-records-store,def-jam,emi-store,verve-store,rarewaves,plaid-room-records --skipUpload --skipActiveEnrichment --skipEbaySync --maxProductFinds=25 --maxSaleEvents=25
```
