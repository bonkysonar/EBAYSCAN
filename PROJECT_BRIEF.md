# Project Brief

Record Scanner is a local-first vinyl resale triage app for quickly deciding whether a record is probably below a configurable processing threshold, probably worth keeping, or too ambiguous to skip without manual review.

It is not an exact pressing identifier, grading tool, or automated listing/pricing engine. The MVP is a culling assistant that saves attention for records where human judgment matters.

## Decision Philosophy

- GREEN means likely worth processing/listing or at least not casually skipping.
- YELLOW means ambiguous: manual check needed.
- RED means likely low value: safe candidate for skip or bulk pile.

The app is conservative. Uncertainty should move records to YELLOW rather than pretending to know. Risk keywords and variant signals usually prevent RED skip decisions instead of automatically forcing GREEN.

## MVP Scope

- Manual search input.
- Barcode input compatible with USB scanners that type text and press Enter.
- Catalog-number input for fast label/matrix-style lookups, treated cautiously because numbers can overlap across releases.
- Image upload placeholder wired through the same marketplace interface.
- Mock eBay service layer.
- Separated scoring engine.
- Configurable default threshold, initially $5.
- Result screen with decision, confidence, price summary, reasons, warnings, and candidate listings.
