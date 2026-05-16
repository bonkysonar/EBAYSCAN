# Decisions

## 2026-05-16: Mock-first Marketplace Architecture

The app uses a `MarketplaceClient` interface with a mock eBay client first. This lets scoring, UI, tests, and scanner workflow be developed without credentials and without scraping.

## 2026-05-16: Conservative Triage Defaults

Uncertain records go YELLOW. The app should only return GREEN when there are enough similar listings, low prices, no meaningful risk flags, and adequate confidence.

## 2026-05-16: Local-first MVP

Settings are stored in browser localStorage and fixtures are local TypeScript data. No production data is mutated.

## 2026-05-16: React + Vite + TypeScript

The initial stack is React + Vite + TypeScript with Vitest. This keeps the MVP lightweight, easy to run locally, and friendly to modular UI and logic tests.
