# Retail source coverage

## September 4 repair audit

The live baseline had 17 campaigns in **Needs source repair**, across nine retailers and 16 distinct URLs. This campaign backlog is separate from the 49 sources whose previous HTTP scan failed. The new scanner accepts fresh, exact-domain public-page observations captured through the ordinary browser; it does not extract session cookies or call private storefront APIs. Imported pages are limited to six hours and remain explicitly bounded page observations, not a complete catalog claim.

Ordinary Chrome visits verified every one of those 16 campaign URLs:

| Retailer | Baseline campaigns | Actual page result |
| --- | ---: | --- |
| Recordstore UK | 3 | The former 30%, 40%, and 50% sale collections each render the retailer's 404 page. |
| Polyvinyl | 5 | All five former garage-sale collections explicitly say the page no longer exists. The current vinyl navigation points to the filtered `collections/everything` Shopify catalog. |
| Verve | 3 | The old garage-sale landing page is removed (two campaigns); Collectors Finds loads with current regular product prices and no advertised collection discount. |
| Sound of Vinyl | 1 | The former 50%-off collection is removed. Its replacement End of Summer collection advertises 30% off with exclusions and displays marked product prices. |
| Craft | 1 | Volume-sale page loads. Actual tiers are $50 for 20% off, $75 for 25% off, and $150 for **$30** off. These are separate basket conditions. |
| Century Media | 1 | Clearance page loads with 34 products and actual per-product markdowns. Mixed vinyl/CD bundles require format review. |
| Equal Vision | 1 | Clearance page loads, largely with CDs/merch. A separate 25% **STORE WIDE** banner excludes pre-orders. |
| MVD | 1 | Warehouse Overstock loads with 924 mixed-format products. Individual vinyl offers require exact product-page evidence. |
| Sacred Bones | 1 | David Lynch Warehouse Sale loads with 17 predominantly non-record items; the word “vinyl” in an insert is not evidence of a record. |

The scanner now records confirmed retailer page removals separately from HTTP blocks, allowing only the exact removed campaign to end with `source_page_removed`. HTTP 403/429 failures remain unknown. The fresh 127-source run (`2026-09-05T00:51:11.818Z`) read 28,632 candidates, completed 159 active-market queries without errors, and resolved the original campaign backlog to zero unknown campaigns. Active asking prices remain separate from sold evidence.

Of the 49 originally failed sources, 31 now return ordinary catalog responses; 27 of those produced actual parsed products. Normal-browser captures recover priced LP products from 15 further blocked retailers plus Matador and Data Discs, and current discussion pages from both previously blocked forums. That is **46 of 49 (93.9%) with productive retail or current discovery evidence**. It is not 46 complete daily crawls: 27 are productive ordinary scans, 17 are bounded browser product samples, and two are current forum observations. Captured Tracks, Rhino, and Secretly remain outside this strict count; Secretly's observed pages retain preorder wording and were conservatively excluded from available candidates.

The final bounded refresh (`2026-09-05T01:30:36.893Z`) consumes 57 observed pages across 33 sources, includes 209 available or stock-unresolved product candidates, selects 14 research candidates under the demand gate, and completes 13 active-market queries without failure. It preserves zero unknown campaign statuses from the broad run. Research rows now include the exact selected John Prine, John Coltrane, and Thrice offers without duplicate catalog cards for the same variant.

Genuine storefront changes included Movies Unlimited and PopMarket moving to Shopify; Matador, Secretly, Season of Mist, and Napalm moving catalog paths or hosts; dead Beggars and Plastic Head shop hostnames; and stale Norman/Sounds of the Universe catalog paths. Updated source definitions come from actual official navigation and redirects. The remaining Captured Tracks collection is a retailer-branded 404; its homepage subsequently required a human verification challenge, so no successful product recovery is claimed.

To capture and import a normal-browser fallback:

```powershell
node scripts/serveRetailObservationInbox.mjs
node scripts/runRetailArbitrageScan.mjs --browserObservations=exports/arbitrage-finds/browser-source-observations.json --skipUpload
```

The loopback inbox accepts observed public text and links through its visible form and writes an ignored local evidence file. Exact product observations must show artist/album, LP/vinyl format, current price, and available stock or an enabled purchase control; no purchase is submitted. Curation independently verifies currency and pressing identity. The `/research` inbox saves eBay research captures separately.

`catalogProducts` imports bounded card text, artist when shown, album, LP/vinyl format, displayed price, public product URL, and explicit stock/currency evidence. Missing artist, currency, and stock remain unresolved. CDs, unavailable items, and preorder cards do not become available LP candidates. `--browserOnly --sources=<captured source IDs>` makes an explicitly bounded refresh with `scanComplete:false`; `--previousScan=<draft path>` binds lifecycle continuation to the selected prior run. Unvisited campaigns retain their previous status and check timestamp. Expired captures are ignored after six hours, so a stale evidence file does not abort tomorrow's ordinary scan or make blocked sources healthy.

Forum scans follow the newest actual pagination link and then the previous linked page. They do not infer new page URLs or use page two of an old thread as current deal evidence. Forum coupon text is a retailer-recheck lead and cannot create a verified retail campaign without confirmation on that retailer's own site.

Last broad bounded live audit: 2026-07-22 from the local scanner host, with a targeted candidate-path recheck on 2026-08-05. A successful request below means the retailer exposed a public, read-only catalog response at that moment; it is not a promise that the retailer will keep the endpoint available or permit resale acquisition.

## Structured direct-retailer coverage

The retail scanner can paginate Shopify `products.json` collection feeds. The following repaired targets returned HTTP 200 with a `products` array in the live audit. Counts are the first bounded page (`limit=250`), before the scanner's own pagination, availability, format, and candidate-quality filters.

| Source | Public collection feed | Products / available on first page |
| --- | --- | ---: |
| Capitol Records Store | `shop.capitolmusic.com/collections/vinyl` | 250 / 247 |
| Def Jam Store | `defjamshop.com/collections/vinyl` | 130 / 110 |
| EMI Store | `emirecords.com/collections/vinyl` | 250 / 250 |
| Verve Store | `store.ververecords.com/collections/9-98-up-vinyl-collection` | 66 / 58 |
| Rarewaves | `rarewaves.com/collections/vinyl` | 250 / 250 |
| Assai Records (coverage only; excluded from acquisition) | `assai.co.uk/collections/a-z-vinyl-offers` | 250 / 250 |
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

- Assai Records exposes a catalog but its official refund policy says marketplace-reseller orders may not be fulfilled and may incur an administration fee. It is excluded from active acquisition targets while that policy remains in force.
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
