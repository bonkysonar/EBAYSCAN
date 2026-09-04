# Retail scanner audit and improvement plan

Audit date: September 4, 2026. Scope: the live Retail Arbitrage and Site-wide Sales pages, their publication API, local daily artifacts from August 24–September 4, the daily automation, and the discovery, pricing, research, ranking, and publication code. This document records the pre-implementation audit. The subsequent implementation is documented in RETAIL_ARBITRAGE.md, DATA_MODEL.md, DECISIONS.md, and TEST_PLAN.md.

The scanner needs to optimize for useful buying decisions. At present, it gathers many offers, chooses a largely price-driven research sample, and presents most of the unresolved sample to David. Campaign recognition, product identity, evidence completion, and publication reliability all lose useful opportunities along the way.

## What the audit established

| Observation | Evidence and consequence |
| --- | --- |
| The live publication is three days old. | On September 4, `/api/arbitrage/latest` and both live pages served `scan-2026-09-01T12-33-55-773Z`. September 2–4 have local final artifacts, but all fail the publication coverage gate. September 2 automation memory explicitly records the skipped upload. September 3–4 artifacts also report `publishable: false`; their upload attempts were not independently verified. |
| The default queue mostly transfers research work to David. | The live API returns 65 product rows: 0 A, 2 B, 57 C, and 6 rejected. The default page displays 59. Only 2/65 have validated sold evidence. The local September 1 final contains 80 products; the server filters another 15 during retrieval, after research capacity has already been spent. |
| This is a repeated outcome. | Each of the 12 local finals from August 24 through September 4 contains 80 products and zero BUY decisions. Five of those runs are publishable. Missing research is not proof that the products have no market, but repeated empty searches are not useful recommendations either. |
| Blue Note was reached but its sale was missed. | September 1 visited the vinyl catalog, homepage, and `end-of-summer-sale-2026` collection. It parsed 589 candidates, recorded zero sale events, and allocated just one research slot. September 4 parsed 587 candidates with the same zero-sale/one-slot outcome. |
| The Blue Note slot was wasted on a digital product. | The local final selected `GoGo Penguin - GGP/RMX - Digital Album` at $7.99. It remained a C candidate locally and was absent from the live product list. This shows that catalog membership and later filtering do not provide a consistent product contract. |
| Blue Note's current advertised offer falls outside ordinary detection. | Its official summer-sale page advertises 20% off music and merch, a separate home-decor offer, and a shipping threshold. `detectSaleEvents` emphasizes 30–99% snippets; `isLargeSaleSignal` requires at least 30% for the percentage route. The wording/scope checks also do not reliably understand mixed music/merch offers. This verifies a current miss, without assuming it is the exact earlier sale David meant. |
| Separate offers are being combined into a false claim. | The live sale page calls uDiscover's offer “50% off sitewide,” using evidence that contains both a 50%-off selected-vinyl collection title and a separate 30%-off sitewide banner. The official retailer page distinguishes those offers. Replaying the published campaign through `applyVerifiedSaleCampaigns` discounted a synthetic $40 product outside that collection to $20. That is a reproduced scope error, not a claim about the actual checkout price of any record. |
| Non-record promotions and damaged inventory remain visible. | The sale page describes a Zavvi `FUNKO20` promotion for Funko Pop vinyl figures as a vinyl sale. Retail rows include damaged/dented jackets and B-stock. The current classifier accepts the observed damaged-jacket title in a local replay. |
| Product identity is corrupting some research queries. | The parser turns `Nearsighted - Baby Pink LP` into artist `Nearsighted`, title `Baby Pink`. Another row uses an album title as artist and a color description as title. Shopify ingestion prefers this hyphen split over vendor metadata. These are unresolved identities, not evidence of no demand. |
| “Promising” and turnover can be misleading. | The first live Tier B row, NOW's five-LP yearbook, shows $0.44 estimated net, about 1% ROI, two aggregate sales in three years, and a seven-day estimated turn. The evaluator explicitly returns seven days when exact active supply is zero and any recent or long-term sales pace is positive. Tier B can qualify through discount plus aggregate demand without clearing an economics floor. |
| Campaign discounts have no complete verification path. | `applyVerifiedSaleCampaigns` already adjusts certain exact, retailer-observed percentages before product selection. But it skips already-marked-down, volume, and conditional offers; marks calculated prices `campaign_advertised`; and the evaluator only accepts `direct_retailer` or `official_api` as verified acquisition offers. There is no general daily step that resolves the campaign estimate into a confirmed eligible product price. |
| Coverage metrics are masking the business failure. | September 1 reports 127 sources and 32,583 candidates, but only 56 sources with usable product coverage, 46 parser-empty sources, and 19 failed/blocked sources. September 4 falls to 55% direct catalog reach and about 21.7% productive direct sources, with 56 failed/blocked. Those numbers explain freshness problems; they do not measure whether David receives useful candidates. |

Official retailer evidence: [Blue Note summer sale](https://store.bluenote.com/collections/end-of-summer-sale-2026), [uDiscover selected-vinyl collection and separate sitewide banner](https://shop.udiscovermusic.com/collections/50-off-select-vinyl). These observations are time-specific; availability, exclusions, and prices must be rechecked during implementation.

## Proposed work, in order

### 1. Correct product identity and sale pricing before adjusting rankings

Create one normalized product/offer contract used by ingestion, research planning, curation, publication, and UI. Preserve artist, release title, edition, physical format, barcode/catalog identifier, retailer variant, condition, currency, availability, and preorder/release date separately. Use structured retailer metadata first; do not interpret every hyphen as an artist/title delimiter. Missing identity must trigger resolution rather than an apparently exact empty search.

Resolve format at the variant level, while retaining explicit parent-title warnings for digital products, damaged jackets, and accessories. Default actionable inventory should be available physical records; damaged inventory, singles, bundles, and preorders need explicit handling rather than being admitted because they are cheap. A damaged jacket must not be compared as pristine new/sealed stock.

Replace flat page-text offer extraction with separate structured campaign observations: discount type, exact amount/rate, applicable collection/products, excluded editions, code, dates, minimum spend, shipping rule, stacking rule, and supporting retailer evidence. Bind each rate to its own sentence/banner/terms block. Recognize music-inclusive mixed campaigns and discounts below 30%; the record's economics should determine importance.

Keep existing lifecycle/history handling, but derive changes from material terms instead of navigation text. Treat “Funko vinyl” as a different product category. A URL slug or sale label alone can create an unverified lead, not a retailer-confirmed discount.

**Acceptance:** Blue Note's current 20% music campaign is captured with separate decor/shipping terms; uDiscover retains distinct 30% sitewide and 50% selected-product scopes; digital products and Funko promotions never enter record research. These must be generic fixtures, not retailer/title allowlists.

### 2. Make each sale produce evaluated records in the daily scanner

For every new or materially changed campaign, enumerate its eligible physical-record variants, calculate the effective acquisition price, then run product-level economics. A campaign should expose eligible records, evaluated records, records that pass, unresolved terms, and exclusions. Its page should link directly to its best resulting record candidates.

Handle already-reduced prices, extra codes, and stacking according to explicit terms. Do not skip all marked-down products or blindly discount them twice. Model fixed discounts and minimum spends at basket level. BOGO and volume offers need an eligible basket and allocation rule; an advertised “up to” percentage is not a uniform discount.

Calculate both a standalone purchase and, where useful, a small qualifying basket. Include sales tax, actual/estimated inbound shipping, dated FX, selling fees, advertising, outbound shipping, packaging, and returns reserve. Free shipping applies only after the eligible basket reaches the threshold; show any extra cash or unwanted stock required to reach it.

Add a final read-only retailer/API verification step for shortlisted offers. It must confirm identity, stock, currency, price and campaign eligibility, retain the observation time, and expire appropriately. If final pricing is available only in checkout, expose that one unresolved requirement for manual confirmation; do not promote the estimate to GREEN.

**Acceptance:** a synthetic product that becomes profitable only after a valid 20% campaign appears in the shortlist; excluded and non-stacking products do not; shipping/basket thresholds change economics correctly; expired campaigns cannot create fresh recommendations. No purchase or checkout submission is part of the workflow.

### 3. Spend research capacity on plausible opportunities, then choose the visible list

Keep a broad internal discovery pool, but separate it from the user-visible list. Currently the scanner enriches roughly 240 products, reduces them to 80, and only then builds the sold-research plan. Preserve the pool through sold validation so later evidence can promote a better candidate.

Use three discovery paths: newly discounted/campaign-eligible records; current offers for exact releases supported by David's own dated sales; and a small exploration allocation for unfamiliar records with strong product/price evidence. Own sales describe David's experience, not the entire market. Artist preferences remain inclusion/review context only and never determine value or economic rank.

Resolve identity before marketplace queries. Use barcode/catalog and exact pressing searches, then a clearly labeled base-release fallback to discover possibilities. Broad fallback results cannot become exact-edition proof. Distinguish no results, bad identity, failed search, unavailable access, and unfinished research.

Make the existing signed-in Product Research handoff resumable and explicit about its aggregate evidence limits. Do not design the unattended BUY path around a nonexistent historical-sales API or treat aggregate quantities as dated 90-day velocity. Use permitted dated transaction evidence where available; otherwise retain an evidence gap. Fix the Windows absolute-path issue and checkpoint research by find ID instead of relying on one long browser capture.

Remove the seven-day turnover shortcut. Zero active listings can reflect sparse supply, sparse demand, or query failure; it cannot establish rapid sale. With weak or aggregate-only timing, show uncertain turnover and withhold profit-per-30-day precision. A “promising” label must require meaningful conservative economics as well as credible product demand, even if one verification step remains.

**Acceptance:** the $0.44-net example is not a top recommendation; zero supply plus two sales over three years does not predict seven days; album/color parsing no longer creates false artist/title queries; a better record from the retained pool can replace a weak initially selected record after research.

### 4. Present a short decision list and keep it fresh

Default to “Worth considering”: fully verified opportunities plus a small set with defensible economics and one clearly stated remaining check. Aim for at most 5–15 distinct releases when warranted, never a minimum to fill. Keep broad C leads in an optional research view. Group equivalent color variants and alternate retailer offers under a release while preserving edition-specific evidence and prices.

Each recommendation should answer: which pressing, where to buy, effective unit and landed cost, sale/code conditions, conservative resale basis, estimated net/ROI, demand evidence, why it surfaced now, last verification time, and what remains uncertain. A day with no qualifying opportunities should say so plainly.

Separate last successful publication, latest attempted scan, and per-source verification times. Report a failed daily run on the site instead of only retaining an old publication with a small age label. Fix approved source adapters and failed JSON/content-type handling; use retailer feeds or normal visible verification where available, without evading blocks.

Propose a versioned publication model that can publish independently verified source updates while labeling unavailable coverage and retaining timestamps for older observations. This requires an explicit implementation change and tests; do not weaken the current full-run upload gate or present a partial run as comprehensive. Surface campaign changes independently of unrelated retailer failures.

Retain the broad daily scan, then use bounded, staggered checks of active campaigns and the strongest offers during sale periods. Set cadence by observed retailer access and useful yield. Fresh prices must pass the same economics/evidence gates. No automation schedule is changed by this audit.

**Acceptance:** an unrelated retailer failure cannot silently freeze all verified offers for days; stale offers cannot appear current; source-health counters match the delivered list; a newly changed sale is detected within the configured recheck interval, with a proposed target of two hours for priority active campaigns where access permits.

### 5. Measure usefulness and make feedback affect the next scan

Connect explicit review outcomes to the scanner through a sanitized preference/review store. Current feedback is browser-local and affects that browser's queue, not tomorrow's discovery/research allocation. Preserve factual reason codes such as bad identity, wrong format, margin too thin, stale offer, and too slow. Suppress unchanged rejected offers and repeated empty research until a material price, stock, identity, or evidence change justifies revisiting. Do not permanently bury records merely because an earlier search failed.

Track the full funnel by source and campaign: discovered, identity-resolved, eligible, correctly priced, evidence-completed, economically qualified, displayed, reviewed, and useful to David. Record where a known missed deal was lost. Source counts and discounts are diagnostics, not the success metric.

Build a replay set from the failures above plus independently confirmed positive examples. Include 10/20/30% campaigns, mixed scopes, code stacking, non-stacking, BOGO/basket pricing, excluded editions, digital variants, damaged stock, currency, malformed identity, sparse demand, blocked sources, and partial publication. Keep a holdout set of new sales so passing known examples does not become overfitting. The undisclosed deal can remain a blind check if David later chooses to reveal it; the plan does not depend on that.

Proposed evaluation: a seven-day shadow comparison against the current scanner. Aim for at least 70% of the first ten displayed recommendations to be worth opening, measured through David's explicit review, and no known false price/format/scope claims in the regression set. Report actual precision and campaign-detection misses rather than claiming success from more GREEN labels. Preserve applicable eBay/Discogs restrictions and the six-hour Vinyl Lots display boundary; do not expand marketplace-content retention through the learning store.

## Implementation boundaries and validation

Primary files: `scripts/runRetailArbitrageScan.mjs`, `scripts/lib/retailSaleDiscovery.mjs`, `scripts/lib/candidatePipeline.mjs`, `scripts/lib/shopifyCatalog.mjs`, `scripts/lib/retailListingParsing.mjs`, `scripts/lib/productResearchCuration.mjs`, `scripts/prepareArbitrageResearchPlan.mjs`, `src/lib/arbitrage/evaluateOpportunity.mjs`, `src/lib/arbitrage/types.ts`, `src/server/arbitrageFindsApi.ts`, `src/components/RetailArbitrage.tsx`, `src/components/SiteWideSales.tsx`, and `src/lib/arbitrage/reviewFeedback.ts`. Introduce separate campaign-pricing and offer-verification modules rather than adding more unrelated logic to the large scanner script.

Deliver in small reviewable changes: product/campaign correctness; campaign-to-record pricing and verification; evidence-aware selection and UI; publication resilience; feedback and monitoring. Deployment remains a separate explicit request under `CODEX_RULES.md`.

Audit verification: 139 existing tests passed across candidate pipeline, retail sale discovery, arbitrage evaluation, Shopify catalog, Product Research curation, and publication API suites. Read-only local replays reproduced incorrect out-of-collection discounting, album/color identity splitting, damaged-jacket acceptance, and the seven-day/$0.44 Tier B example. Passing existing tests does not cover these observed failures; add the acceptance cases above with the implementation.

At the end of the audit, no application code, production data, marketplace listings, purchases, or automation settings had been changed. The user subsequently authorized implementation, commit, merge, publication, and deployment. The seven-day usefulness evaluation requires future explicit reviews; implementation does not claim that target has already been achieved.
