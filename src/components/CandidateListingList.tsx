import type { CandidateListing } from "../lib/ebay/types";

type Props = { listings: CandidateListing[] };

export function CandidateListingList({ listings }: Props) {
  return (
    <section className="panel listings-panel">
      <h2>Top Candidate Listings</h2>
      <div className="listing-list">
        {listings.map((listing) => (
          <article className="listing-row" key={listing.id}>
            <div>
              <h3>{listing.title}</h3>
              <p>{listing.condition} · {listing.source}</p>
            </div>
            <strong>${listing.totalPrice.toFixed(2)}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}
