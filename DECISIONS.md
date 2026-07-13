# Decisions

## 2026-05-16: Mock-first Marketplace Architecture

The app uses a `MarketplaceClient` interface with a mock eBay client first. This lets scoring, UI, tests, and scanner workflow be developed without credentials and without scraping.

## 2026-05-16: Conservative Triage Defaults

Uncertain records go YELLOW. GREEN means likely worth processing because comparable prices cluster above the threshold. RED means likely safe to skip, and should only be returned when there are enough similar listings, low prices, no meaningful risk flags, and adequate confidence.

## 2026-05-16: Local-first MVP

Settings are stored in browser localStorage and fixtures are local TypeScript data. No production data is mutated.

## 2026-05-16: React + Vite + TypeScript

The initial stack is React + Vite + TypeScript with Vitest. This keeps the MVP lightweight, easy to run locally, and friendly to modular UI and logic tests.

## 2026-05-16: Local eBay Browse API Endpoint

Real eBay lookup is routed through a local Vite dev-server endpoint so OAuth credentials and minted tokens stay out of browser bundles. Barcode, catalog-number, and manual search can use real Browse API search. Searches default to used listings because used vinyl is the primary workflow, with New and Both available as operator controls. Real lookup failures return YELLOW/no-results warnings instead of generic mock matches; mock fallback is reserved for explicit demo inputs and image placeholder work. Image search remains mocked until official image-search access is confirmed.

## 2026-05-16: Identifier Search Expansion

Catalog numbers and barcodes can be too narrow by themselves. Identifier searches now run a primary identifier query, derive likely artist/title tokens from the returned titles, run an expanded artist/title query, and merge/dedupe the results. eBay total-match counts are preserved in the raw summary so future scoring can reason about market saturation separately from the returned candidate list.


## 2026-05-17: Discogs Marketplace Stats

Discogs lookup uses DISCOGS_USER_TOKEN server-side only. The app searches Discogs releases, fetches release details and marketplace stats, and displays matched release, lowest price, number for sale, have/want counts, and match confidence. Current API responses did not provide median/sold-history price, so the UI labels median as unavailable rather than inventing it.

## 2026-05-17: Vercel-Ready Server Boundary

Marketplace lookup logic now lives in `src/server/marketplaceApi.ts` so local Vite middleware and hosted serverless routes share the same implementation. The hosted entrypoint is `api/ebay/search.ts`, and `vercel.json` configures the Vite build plus serverless function. This keeps eBay and Discogs secrets server-side while allowing the app to run from other computers once deployed.

## 2026-05-17: Low-End Comparable Price Signal

Broad median listing price can be misleading for common records with many cheap copies and a few expensive outliers. Scoring now emphasizes the average of the cheapest 10 title-matching comparable listings, and visible candidate tiles are sorted from lowest total price upward. This better supports fast culling decisions such as `BOZ SCAGGS Slow Dancer`, where many active listings are below the processing threshold.

For threshold decisions, `averageCheapestTenTotalPrice` is the primary benchmark. If it is above the configured threshold and enough comparable listings exist, the app returns GREEN even when listing consensus is imperfect. This matches the workbench rule: above-threshold low-end comps mean "go/process," not "skip."

Catalog-number Discogs matching is stricter than general text search. Catalog results are ranked by normalized catno similarity, shared catalog tokens, standalone series numbers, and plausible original-year preference so values such as `ECM 1 1216` prefer `ECM-1-1216`/1982-style matches over later reissues.

Barcode searches can use Discogs as an eBay expansion source. If eBay GTIN/text barcode search returns no usable listings but Discogs identifies the release, the API runs a second eBay search using the Discogs artist/title. This fixes cases such as `07599254741`, where Discogs identifies `Peter Cetera - Solitude / Solitaire` but eBay GTIN search returns zero.

## 2026-05-17: Paginate Active eBay Candidates

The eBay Browse API endpoint is queried in 200-listing pages, up to 1,000 returned listings per query leg. This prevents title-match and market-saturation logic from silently maxing out at the first page while preserving eBay's reported total count in the raw summary.

## 2026-05-18: Discogs Sales Stats Pull / Import

Discogs release pages display Last Sold, Low, Median, and High sales statistics, but the official API response used here does not provide those historical sales values. The app does not silently scrape Discogs pages because Discogs terms restrict automated scraping/data extraction and sales-history marketplace data. Instead, the UI accepts user-provided Discogs Statistics text or saved HTML/XML/text for the current result, parses the values locally, displays them, and uses imported Discogs sales median to prevent overly generous GREEN decisions.

David explicitly asked for a one-release-at-a-time automatic pull because Discogs median is the primary real-world pricing signal in this workflow. The app now makes a best-effort server-side fetch for the matched Discogs release and parses only the visible sales stats. This is intentionally not a batch/mining feature. If Discogs returns a browser challenge or blocks the request, the UI shows that failure plainly and keeps the manual paste/file import fallback.

## 2026-05-18: Discogs Browser Helper Extension

Because Discogs can block server-side page fetches while a normal signed-in Chrome session can still display the release page, the fastest viable workflow is a tiny local Chrome extension. Record Scanner opens a Discogs helper tab with a one-time token and return origin. The extension runs only on Discogs pages, reads the visible release stats table, and posts Last Sold / Low / Median / High back to the opener window. This avoids slow Google Sheets IMPORTXML polling and avoids OCR/screenshot fragility.

The background extension path proved less reliable than the visible helper flow because it introduced extra injection, service-worker, and timing failure points. The app now waits until a Discogs release URL is available, waits a short 500ms settle delay, then automatically opens the visible helper flow that was already proven to work. Browser-helper medians are treated as authoritative threshold decisions: above threshold GREEN, at/below threshold RED, with confidence set to 100%.

## 2026-05-20: Separate Seller Price Analyzer

Store-pricing analysis is a separate hash route at `#/seller-prices` so the scanner page remains focused on fast record triage. The analyzer is read-only: it can pull active seller listings and compare current asking prices to active eBay cheapest-10 comps, but it does not call any eBay revise/end/relist mutation APIs.

Seller recommendations intentionally use active eBay cheapest-10 average and active comparable count rather than Discogs median. This answers a different question than the scanner: not "is this record worth processing?" but "is David's live listing competitive in the current active market?"

## 2026-07-13: Automatic Discogs Price Guide Replaces Automatic Browser Helper

Opening a new Discogs page for every scan was slow, repeatedly triggered browser challenges, and defeated the scanner's one-enter workflow. The default search now calls Discogs' documented authenticated `marketplace/price_suggestions/{release_id}` API endpoint and selects the conservative Very Good (VG) suggestion for used-record triage. The UI labels this value as a price guide, not a historical median.

The app no longer launches the Chrome helper automatically. Pressing Enter performs the eBay and Discogs API lookup without browser navigation or another click. The page pull, Chrome helper, and pressing chooser remain manual options for cases where David wants the exact page-visible Last Sold / Low / Median / High history or needs to correct a pressing. A below-threshold automatic Discogs price guide conservatively prevents an eBay-only GREEN decision, but it is not treated as the helper median's 100%-confidence historical signal.

## 2026-07-13: Reusable Visible Discogs Session

Production confirmed that the configured Discogs token can read public release/current-lowest data but cannot provide the historical page statistics, and Vercel continues to receive a 403 browser challenge on direct page pulls. The helper therefore returns to the automatic path with a different lifecycle: extension v0.3 creates one visible Chrome popup window, persists its tab/window IDs in `chrome.storage.session`, and reuses that same window for every matched release.

The first helper window is focused so David can complete Discogs' normal browser verification. Challenge detection brings the window forward again when attention is required, allows up to five minutes for a human response, and never attempts to bypass the verification. Successful reads return focus to the scanner. The persistent request map is also stored in session storage so a Manifest V3 service-worker suspension does not lose the response route.

