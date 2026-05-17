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

