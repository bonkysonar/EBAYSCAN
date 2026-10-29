# Retail research reliability

The daily runner researches a bounded shortlist of current offers so discovery can finish while prices are relevant. It must complete the selected cohort before publishing a verified report. Finding an offer, completing its searches, matching its pressing, and proving its economics are separate outcomes.

## Failure modes repaired

| Failure | Current behavior |
| --- | --- |
| Thousands of accumulated offers could not finish before evidence expired | Default sale-radar research selects up to 12 distinct album queries, with one third of slots reserved for fresh deal-feed events when available. The full discovery pool stays in the local draft and unselected offers are counted as deferred. The 240-task setting only batches the selected work. |
| An old unpublished run prevented discovery of new prices | Resume only drafts up to 24 hours old; explicit `--full` always starts fresh. New scans reuse fresh matching research but do not inherit unrediscovered acquisition offers. Preserve original drafts/checkpoints and retire contexts only after a durable, exact successor exists. |
| Generic failed reports hid the cause | Saved failures include a bounded, sanitized cause, step and time. No raw command output, URL queries or credentials enter the failure summary. Invocation, research, validated local output and publication remain distinct states. |
| Stale comparisons or truncated sold tables looked complete | Active comparisons expire after 24 hours. Sold completion checks the observed query, filters, date window, freshness and pagination. Completed searches and validated prices remain separate counters. |
| Product queries contained merchandising text | Resolve retained eBay listings through official item aspects and normalize known format/catalog suffixes. Conflicting artist identities remain unresolved. |
| Variant labels replaced quoted album names or made searches too narrow | Parse explicit quoted release identity before the selected color suffix. Remove orphaned FIRST/STANDARD modifiers only when the original listing confirms an edition label. Search both the full A b/w B title and its A-side without changing edition validation. |
| Shipping comparisons were reused after a destination change | Include the configured marketplace, API environment and destination in the active-search cache identity. Missing or changed destination identities force a refresh. |
| Retailer feed routes moved or stopped returning JSON | Use the official Shopify Ajax product interface and observed catalog links, with legacy feed fallback. Correct verified storefront migrations. Stop a host after access failures. |
| A mixed-format product's cheapest price was a CD or download | Read the exact enabled vinyl option and its own price/stock. Magento grouped rows, Shopify Buy Buttons, Thrill Jockey, Topshelf, Domino, Honest Jon's, Resident, Zavvi and Plastic Head have explicit format adapters. Recheck the same variant during curation. Resident backorders cannot use its broader available-for-sale flag as in-stock evidence. |
| Retailer records lacked an explicit artist | Re-read the exact Shopify variant. A valid variant barcode may corroborate artist and album against eBay Browse record aspects, with agreement required against both advertised titles. Conflicts remain unresolved. This metadata check does not add a price, a sale, completed research, or a BUY. |
| Long research sessions left eBay acquisition quotes at scan-time prices | Before final curation, re-read each exact eBay listing through Browse with the configured destination ZIP. Verify unchanged listing/release identity, New fixed-price vinyl, in-stock status, domestic origin and fixed shipping. Refresh acquisition price/time only on success; failed, removed, rate-limited or destination-unconfigured offers lose verified status. |
| Valid records were classified as accessories | Recognize Double/Triple LP and record-size types. Ignore specific incidental sticker and protective-mailer phrases while retaining actual accessory exclusions. Version identity checks so classifier fixes revisit prior rejections. |
| Status reported only the most recent partial update | Measure offers visible in the merged report separately from the current scan attempt. Legacy completion flags do not establish current completed research. |

## Coverage vocabulary

- **Catalogs with products** counts sources that produced parsed record offers. It does not imply an exhaustive catalog crawl or profitable inventory.
- **Sources with opportunities** is the former “product coverage” metric: sources with retained promising offers. Successful catalogs with no qualifying offers do not belong in this numerator.
- **Completed research** means required searches were fully observed. A successful search with no usable matches is complete but has no validated price.
- **Deferred discoveries** were not selected for the current research cohort. Historical deferred offers may also have stale prices. Neither category counts as completed research, and neither prevents publication of a fully researched current cohort.
- **Validated sold evidence** requires matching usable sales. Edition conflicts and removed listings cannot supply a price or a BUY. Annual and recent windows are not added together.

Configured domains are deduplicated. Storefront migrations can reveal duplicate entries, such as Domino US and Domino Mart; aliases must not inflate productive-source counts.

## Runner procedure

1. Acquire the profile-bound research lease described in [Seller Hub browser recovery](RESEARCH_BROWSER_RECOVERY.md). Start `node scripts/runRetailWorkflow.mjs --full` for a new scan, or `--resume=<exact-context>` only while that draft is no older than 24 hours. Use the returned exact context/draft paths. A bounded `--sources=<ids>` refresh also creates a new cohort.
2. Collect every scheduled query for the selected current offers through the signed-in Seller Hub browser. Save all result pages, explicit empty results, actual date controls and filters. Keep checkpoints local and original observations unchanged.
3. Run `node scripts/prepareArbitrageResearchPlan.mjs <exact-draft>` after each small batch. Complete pending, repair, refresh, justified annual tasks and explicit edition reviews for this cohort. A historical 6,002-offer backlog does not become this scan's obligation.
4. Finish through `node scripts/runRetailWorkflow.mjs --finish=<exact-context>`. The freshness and completeness gates run before active-price refresh, retail verification, curation and publication. An unfinished fresh cohort remains resumable; an expired draft requires fresh discovery. For validation without remote writes, add `--localOnly` to startup and finish. It runs final validation, records `validated`, and does not upload or post operational status.

Set `EBAY_DELIVERY_POSTAL_CODE` to the actual purchase destination. The final eBay offer check needs it to request a destination-specific shipping quote; it cannot be inferred from a generic listing. This uses the documented [Browse contextual-location header](https://developer.ebay.com/api-docs/buy/static/api-browse.html).

Source recovery probes are diagnostic runs. A manually combined set of successful probes must be labeled as a multi-scan recovery audit, never presented as one simultaneous broad scan. A healthy catalog with no candidate and a blocked catalog are distinct outcomes.

Research completeness cannot guarantee market liquidity or a profitable purchase. Incomplete access remains unknown; asking prices remain competition evidence. No purchase is automated.

## Verification

Run `npm test` and `npm run build`. Regressions cover cohort limits, checkpoint-only rollover, query reuse, pagination repair, freshness, identity conflicts, physical formats, access failures and variant rechecks. Browser verification must also exercise a signed-in research query and inspect the visible merged report. Automated tests alone do not establish those live outcomes.

See [Seller Hub browser recovery](RESEARCH_BROWSER_RECOVERY.md) for profile-bound tab recreation, chat leases, process locks, explicit edition-review outcomes and the two-wakeup verification procedure.
