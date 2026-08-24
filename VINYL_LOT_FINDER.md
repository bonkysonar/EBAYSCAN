# Vinyl Lot Finder: Feasibility, Compliance, and Build Plan

Status: compliance-safe adaptive discovery, customization, artist signals, and local feedback handoff implemented and validated locally on July 28, 2026; automated valuation remains gated on eBay approval.

## Implemented safe MVP

- Separate `#/vinyl-lots` page in Record Scanner.
- Two broad official eBay Browse searches per selected genre, followed only when needed by a fallback and enabled artist searches; hard ceiling of 20 calls per scan.
- Transient results with a six-hour expiry and no listing persistence.
- Default 12-record floor, unknown-count collection review, exact-title de-duplication, and conservative lot/genre/condition/format classification.
- Explicit filtering for apparent single LPs, singles, 7-inch/45 RPM records, choice/per-record listings, packaging-only listings, and known counts below 12.
- Per-genre coverage diagnostics that make any lane with fewer than 10 retained candidates an incomplete scan.
- Persisted local scan options and a separate editable `#/vinyl-lot-artists` page with 48 starting artist signals.
- Per-result and overall 1–10 feedback with explanations, sanitized filesystem storage on loopback, sanitized browser-local storage on the hosted site, and an honest `codex://new` handoff that still requires the user to press **Send**.
- `AGENTS.md` plus `VINYL_LOT_LEARNING.md` as deterministic durable product memory.
- Hosted scan access-key gate that fails closed when the production key is absent, blocks empty browser requests, and offers explicit remember/forget controls for a successfully verified key on a private device.
- Route-specific 60-second Vercel duration with a 50-second fail-safe scan deadline; expired scans stop queued Browse calls and return incomplete evidence when any primary search succeeded.
- No sold-data combination, seller-type inference, valuation, automated purchasing, or price recommendation.

The final local browser test used the complete 20-call budget because 1990s rock needed artist expansion. It displayed 44 distinct results, passed coverage with 15 hip-hop, 16 classic-rock, 13 1990s-rock, and 10 instrumental-jazz retained candidates, and removed 316 single/noisy/undersized observations. The stated-count review leads included a newly listed 20-LP classic-rock lot, a $39.99 19-record early hip-hop collection, a $124.90 48-record hip-hop collection, and a $20 14-LP rap/R&B promo lot. Condition remained explicitly unverified where the listing did not support VG+.

Validation completed on August 15, 2026 with 52 test files / 432 tests passing and a successful production build.

## Goal

Add a separate `#/vinyl-lots` area to Record Scanner for finding newly listed US vinyl lots while preserving the existing record-triage and retail-arbitrage workflows.

The intended end state is a read-only decision-support system. It must never bid, buy, submit offers, or contact sellers automatically.

## What the live test established

The existing production eBay credentials work with Browse API search. On July 28, 2026, four representative active-listing searches returned:

| Search | eBay matches | Returned in bounded test | Primary issue |
| --- | ---: | ---: | --- |
| `vinyl record lot 20 hip hop` | 12 | 12 | "You pick," per-record, 45 RPM, and DJ-single noise |
| `classic rock vinyl lot 20 records` | 71 | 50 | Same variation/per-record noise; broad genre drift |
| `90s alternative rock vinyl lot` | 10 | 10 | Mostly sub-20 lots and 7-inch records |
| `hard bop jazz vinyl lot` | 31 | 31 | 45 RPM and general-jazz false positives |

The Browse response supplied useful discovery fields: item ID, title, creation/origin time, buying options, public seller feedback, item country, condition bucket, shipping, images, category, and an item-detail URL.

The test also confirmed several handoff warnings:

- Search terms alone do not enforce a real fixed lot quantity.
- eBay's broad `Used` condition is not evidence of VG+ media.
- Variation listings such as "you pick" can look like very cheap lots.
- A true 1990s-rock lot is uncommon and an empty result must be acceptable.
- The known low-grade example `358728677232` and 14-record jazz example `298478703816` were no longer returned, so saved fixtures are required for deterministic regression tests.
- Known hip-hop item `267712279074` was still active at the time of the test.

The repository's automated baseline was healthy before feature work: 46 test files and 371 tests passed.

## Material compliance blocker

The current eBay API License Agreement allows applications to search and display current listings, but the standard terms materially conflict with the requested valuation workflow:

- Section 9.5 prohibits using eBay Content, alone or with third-party information, to suggest or model prices for items listed on eBay.
- Section 8.5 treats market-trend, pricing, sales-volume, and similar APIs as restricted; pricing tools using that data require eBay's express prior written consent.
- Section 9.10 prohibits using eBay Content to train algorithms or AI systems.
- Public listing information must be no more than six hours stale and must be deleted once it is no longer public.
- Publicly displayed eBay Content may not be combined with non-eBay content in the same display.
- Deriving information about types of eBay users requires express prior written permission, which affects a "casual seller" classifier.

Because the product's core recommendation compares an eBay acquisition listing with outside sold evidence and calculates a maximum purchase price, that capability should not be shipped against the standard Browse license. Written clarification or approval from eBay is the first production gate.

## Safe architecture while approval is pending

### 1. Live eBay discovery view

An isolated eBay-only view can:

- Run bounded, official Browse API searches for the four target genres.
- Request fixed-price/Best Offer, US-located vinyl listings and sort by newly listed where permitted.
- De-duplicate items found by multiple searches.
- Exclude obvious variation listings, per-record offers, 45 RPM lots, CDs, cassettes, and clearly sub-threshold lots.
- Show current eBay listing fields and link back to eBay.
- Label quantity and condition parsing as screening signals, not verified facts.
- Refresh data within six hours and avoid retaining expired eBay content.

It must not calculate undervaluation, maximum offers, seller type, predicted profit, or a price-derived ranking without eBay approval.

### 2. Separate user-owned lot economics calculator

A separate calculator can operate only on information the user enters or lawfully obtains independently of eBay. It can calculate:

- Conservative, expected, and optimistic proceeds.
- Cash profit before labor and economic profit after labor.
- Target-ROI acquisition ceiling.
- Per-record fees, outbound shipping, supplies, returns, damage, and probability of sale.
- Inventory disposition: individual, bundle, filler, or unknown.

This calculator must not be auto-populated with or visually co-mingled with eBay API content while operating under the standard license.

### 3. Approval-gated analyzer

Only after eBay confirms the use case in writing should the application add:

- Listing-photo/description extraction and OCR or vision analysis.
- Seller-type inference.
- Sold-comparable matching and sell-through calculations.
- Price, profit, ROI, maximum-offer, and undervaluation rankings tied to eBay listings.
- Historical listing snapshots beyond the permitted freshness window.
- Material-change alerts containing eBay content.

## Proposed implementation after the product boundary is approved

Keep the feature independent of Retail Arbitrage:

- UI: `src/components/VinylLotFinder.tsx`
- Domain types and rules: `src/lib/vinylLots/`
- Official API discovery: `scripts/lib/ebayLotDiscovery.mjs`
- External full scan: `scripts/runVinylLotScan.mjs`
- Published results: a separate `vinyl-lot-finds/` Vercel Blob prefix
- Read/upload APIs: `api/vinyl-lots/latest.ts` and `api/vinyl-lots/upload.ts`
- Local development middleware: `vite.config.ts`
- Route: `#/vinyl-lots` in `src/App.tsx`

The current discovery-only "Run now" endpoint is operator-authenticated, capped at 20 Browse calls, limited to 50 seconds internally, and allowed 60 seconds by Vercel. Any future full scan that adds approval-gated photo, sold-market, or valuation work should still run outside the interactive request and upload one validated result, matching the existing Retail Arbitrage automation pattern.

## Approval-gated domain model

- Saved search and scan run
- Transient listing observation and freshness timestamp
- Listing photo evidence
- Inventory record and unidentified placeholder
- Identification candidate and human correction
- Pressing candidate and confidence
- Independently sourced sold comparable
- Scenario valuation and cost ledger
- Recommendation reasons and hard gates
- Alert fingerprint and material-change event

Every recommendation must retain its calculation inputs and evidence. Missing sold evidence, unsupported VG+ condition, weak inventory coverage, or ambiguous pressing identification must prevent an automatic `BUY` recommendation.

## Valuation rules for the approved version

Apply sale probability exactly once.

`expected collectible value = conservative market price × pressing confidence × condition confidence × probability of sale`

`net proceeds = expected collectible value - selling fees - seller-funded postage - supplies - returns/damage reserve`

`profit = individual net proceeds + bundle proceeds - labor/overhead - acquisition cost`

`ROI = profit / acquisition cost`

`maximum acquisition cost = (individual net proceeds + bundle proceeds - labor/overhead) / (1 + target ROI)`

Default test assumptions for any future approval-gated analyzer:

- 12-record discovery threshold; a user-selected higher target may retain 12-to-target lots as near-matches.
- 30% target ROI and 12-month liquidation window.
- US location and fixed price/Best Offer.
- Seller feedback below 500 is only a positive signal, never a hard rule.
- Unsupported media condition yields `ASK SELLER` or `PASS`, never `BUY`.
- Sold data must be distinguished from asking-price and price-guide data.
- Unknown records reduce both value and confidence.

## Validation plan

1. Save sanitized Browse responses as deterministic fixtures; never put credentials or personal data in fixtures.
2. Test lot-count extraction, variation/per-item rejection, formats, target genres, condition language, and cross-query de-duplication.
3. Preserve the expired low-grade and sub-20 jazz examples as hand-authored fixtures based on the documented facts.
4. Test rate limits, partial pages, missing shipping, missing images, ended listings, and stale-data deletion.
5. For the approval-gated analyzer, verify pressing lower bounds, explicit unknown inventory, exact sold-source labels, and no double application of sale probability or costs.
6. Verify `L + B - O = $130` produces a $100 ceiling at 30% ROI and $86.67 at 50% ROI.
7. Require human review of false positives and false negatives before enabling scheduling or alerts.
8. Run the complete Vitest suite and production build before any deployment.

## Decisions still needed

- eBay's written approval or clarification for the pricing, AI analysis, seller classification, retention, and alerting use cases.
- Authoritative permitted sold-data source.
- Scan cadence and API/vision budget.
- Alert channel.
- Default selling fees, labor rate/minutes, shipping policy, tax, returns, minimum profit, and minimum individual sale price.
- Whether scheduled processing runs on the existing Windows automation host or a new authenticated job service.
