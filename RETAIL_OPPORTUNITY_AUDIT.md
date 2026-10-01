# September 30, 2026 opportunity recovery audit

## Observed failure

The hosted publication contained 81 product observations: 67 REJECT and 14 REVIEW, with no BUY. Only one met the consideration economics floor ($7 estimated net profit and 30% ROI); it still lacked sufficient recent demand and a verified campaign price. In 53 saved final artifacts, 2,373 product observations contained zero BUY and only eight observations meeting that economics floor. These are repeated observations across saved artifacts, not 2,373 unique records or 53 independently completed production scans.

The broad September 30 draft discovered 29,753 products, admitted 6,251 high-signal candidates, and presented 5,938 candidates to the research selector. Of 240 research slots, 216 went to observed-demand records and only 24 to unfamiliar offers; 5,315 unfamiliar candidates were deferred. Coverage was also incomplete: 63 of 128 configured sources yielded products, 46 were empty, and 18 had parse failures. These counts do not establish whole-market coverage.

The evidence supports selection bias and incomplete coverage, not the conclusion that resale opportunities do not exist. Most evaluated offers really were too expensive under the current cost assumptions. Lowering the profit floor would conceal that problem.

## Root causes and corrections

1. **Research was conditioned on our own inventory.** The selector reserved only 10% for unfamiliar offers, admitted one when no prior demand existed, and could admit none with one observed-demand record. It could leave almost the entire research budget unused. The new selector reserves half for discovery, shares unused capacity, and rotates each lane across sources. Every selected offer still requires independent sold and active evidence.
2. **Some research queries described the wrong artist.** Newbury uses an artist vendor heading and album-only product titles. Subtitle punctuation in titles such as Act III: Life And Death was parsed as an artist separator; Soundtrack could replace composer metadata. The identity adapter now honors that source's artist heading and recognized soundtrack metadata. Query normalization removes an explicit parenthesized autograph extra while preserving the candidate's physical-edition information for matching.
3. **The slow-sale strategy demanded redundant evidence.** Six verified sales in a 90-day window logically establish at least six sales in the containing year. A missing separate 365-day count previously blocked this strategy. Evaluation version 9 accepts that lower bound; it does not multiply counts or convert an aggregate lifetime total into velocity.
4. **The empty UI hid the cause.** The decision-list diagnostics now attribute each excluded product to one first blocker. Counts reconcile to the published product total and distinguish stale offers, missing evidence, thin margins, and demand/supply failures. These are first-blocker counts, not independent counts of every failing gate.

## Economics and evidence boundaries

The default ledger includes 9.5% purchase tax, $5 inbound shipping, $6 outbound shipping, $1 packing, 15% marketplace fees plus $0.30, 2% advertising, and 3% returns reserve. These are estimates, not a checkout quote or a guaranteed realized profit. The audit found no basis to reduce them globally. Combined shipping can improve a real basket, but must not be assumed for a standalone record.

Retail campaign banners do not prove the exact variant receives a discount. A live Sumerian cart/checkout check showed an advertised campaign candidate remaining at its full product price; the discounted price was not accepted as verified. Sold comparables must match the physical edition, condition, and measured period. Asking prices and artist familiarity are not resale-value evidence. Sparse profitable offers remain research leads rather than quota-filling buys.

No purchase, bid, payment, listing mutation, or seller message is part of this work. The six-hour eBay display window and the restriction against retaining marketplace content in the learning store are unchanged.

## Verification and delivery

Regression coverage checks source-balanced exploration with zero and sparse prior history, exact identity/query repair, the 90-day lower bound, rejection of sparse/aggregate demand as automatic buys, and reconciliation of all first-blocker counts. The full suite passes: 70 files, 639 tests. The TypeScript and Vite production build passes.

Delivery requires merging the reviewed feature branch, deploying its commit to the production alias, refreshing live evidence through the normal curation/publication path, and inspecting the production decision list. A recommendation must be supported by current evidence; deployment alone does not prove a qualifying bargain exists.
