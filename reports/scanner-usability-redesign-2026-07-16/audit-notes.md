# Record Scanner usability audit notes

Audit date: 2026-07-16

## Sam & Dave

- The latest final payload stores 23 active matched listings, 2 aggregate Product Research sales, and no validated 30/90/365-day velocity.
- The production API currently returns the same 23 active listings for this candidate.
- The deployed UI bundle still uses the older `oneSellerSoldCount / totalSoldCount sold` presentation. That pair is not sell-through and can be mistaken for a ratio.
- The user screenshot shows 20 active listings and a $21.11 floor. The scanner stored a $31.98 floor. A replay showed that the matcher rejects the mojibake title `Iâ€™m` at a score just below its threshold, while the correctly encoded apostrophe matches.

## Product Research identity

- `totalSoldCount` is overloaded: it can mean the user's own historical quantity before curation, then be overwritten by the sum of accepted Product Research row totals.
- `oneSellerSoldCount` is the maximum total from one accepted row; it does not identify a seller.
- Product Research row validation currently permits fuzzy evidence from another planned find to beat an exact find-ID result with zero rows.
- At least one current candidate, Filter's *The Amalgamut*, inherited Evanescence *Fallen* sold evidence, including an incompatible box set.
- Artist parsing also assumes some retailer titles are `artist - title`, which turns album names such as *The Amalgamut* and *Fallen* into artists.

## Walmart coverage

- The latest scan accepted 18 raw Walmart candidates and included zero in the final queue.
- The sale-radar filter requires a product-sale phrase or a sufficiently large advertised markdown, so inexpensive records without a strike-through price are excluded before ranking.
- A read-only replay found 37 structured vinyl products in Walmart page data but the generic anchor parser recovered 9.
- The page advertised 11 pages, while the generic retailer crawler fetched no result pagination.
- A 12-item smoke replay retained only 2 high-signal rows; rejected inexpensive examples included Garth Brooks, Deftones, The Weeknd, and Michael Jackson.

## Existing seller history

- The local sold-history index contains 2,492 order rows and 2,521 units from 2025-12-31 through 2026-04-10.
- It contains 611 new/sealed order rows and 632 new/sealed units.
- For new/sealed rows, median item price is $22.00, median buyer-paid total is $25.97, and median buyer-paid shipping is $4.47.
- The current history is more than three months behind the audit date and needs a fresh export before it can calibrate current demand.

## Post-audit implementation update

The implementation completed after the snapshot above supersedes several original input requests:

- The existing eBay user token now refreshes Fulfillment orders and Finances transactions automatically. A normal scan does not require a new CSV.
- The first API backfill covers 2024-07-17 through 2026-07-16 and produced 17,455 sanitized API order-line records (17,618 units). After retaining non-duplicate legacy rows, the combined index contains 19,030 records and 19,193 units.
- The evaluator now offers fast-turn, balanced, and high-margin paths. It does not force every record through one hard minimum-profit rule.
- A concise narrated benchmark is enough: roughly 5-10 focused minutes showing accepted, rejected, and borderline records.
- Walmart now has a structured, paginated low-price adapter plus bounded product-page availability verification. The one-page verification smoke test recovered 18 records that anonymous search data had incorrectly marked unavailable.

The generated HTML report remains an audit-time snapshot. This post-audit section and the current project documentation describe the implemented behavior.
