# Research-led retail offers

Do not infer an empty market from an empty scanner. Work in both directions:
use recent condition-matched sales to find retailer stock, and independently
search retailer clearance, named promotions and deal communities for new leads.
Vary queries by album/UPC, retailer, sale type and recent date. Community posts
are discovery leads; only the retailer establishes a current acquisition offer.

`runRetailWorkflow.mjs --sources=best-buy --reviewedOffers=<local-json>` starts a
new bounded source update from reviewed primary Best Buy product pages. The JSON
uses `version: 1`, `captureMethod: "public_page_reader"`, and `pages` with the
actual URL, capture timestamp, artist, album and readable primary-page `text`.
The product URL must contain its displayed SKU. Price, seller, format and
availability must all be present. An optional `shippingPolicy` contains the
official URL, timestamp and observed terms. Search snippets are insufficient.
Observations expire after six hours and never imply a full catalog scan. Keep
these files under ignored `exports/`, not in Git. Browser captures remain a
separate provenance type. Do not label a page-reader result as a browser check.

The normal sold-research, active API, curation and publication workflow still
applies. Finish using `--finish=<workflow-context>` only after examining the
matched rows and the resulting recommendation. A reviewed lead does not bypass
sold evidence, condition, edition or margin requirements.

Verified order-level free-shipping terms create an explicitly conditional
scenario with a minimum spend, the cash required for additional inventory and
the single-copy alternative. They cannot produce an unconditional BUY. Confirm
the actual basket's stock and shipping before purchasing. Quantity examples are
not recommended inventory depth. Expired promotions are never carried forward
from old orders; user purchase receipts stay private.

Historical sold estimates are capped at 98% of a fresh, matched active quote
when that quote is lower. Asking prices cannot establish value without sold
evidence. The six-hour eBay display limit is unchanged.

Compound color/effect plus explicit matching disc count can identify a pressing
when a seller omits “deluxe” or “anniversary.” Other color, format, signed,
series and pressing conflicts continue to fail. Generic editions still require
their distinguishing metadata. “Worth considering” uses its explicit evidence,
profit, demand and supply gates without a duplicate heuristic tier cutoff;
automatic BUY strategy thresholds remain unchanged.

Resale comparisons use delivered prices, including buyer-paid shipping. Deduct
the actual label cost once; do not add a second shipping revenue credit. The
editable default model uses 12.7% plus $0.40 marketplace fees, $4.39 postage,
6% promotion, $1 packaging and a 3% returns reserve. Percentage marketplace
and advertising fees also apply to estimated buyer sales tax (9.5% by default),
which is withheld rather than earned. Packaging, reserves and future buyer tax
remain assumptions. Heavier parcels and international orders may cost more.
An exact known buyer-tax amount can override the estimate in a cost ledger.
Private order details used to calibrate costs must remain outside Git.
