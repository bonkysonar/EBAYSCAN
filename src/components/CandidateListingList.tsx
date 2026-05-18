import type { CandidateListing } from "../lib/ebay/types";

type Props = { listings: CandidateListing[] };

export function CandidateListingList({ listings }: Props) {
  const sortedListings = [...listings].sort((a, b) => a.totalPrice - b.totalPrice);
  const cheapestListing = sortedListings[0];

  return (
    <section className="panel listings-panel">
      <div className="section-heading">
        <h2>Top Candidate Listings</h2>
        {cheapestListing ? <span>Cheapest: ${cheapestListing.totalPrice.toFixed(2)}</span> : null}
      </div>
      {cheapestListing?.imageUrl ? (
        <a className="cheapest-listing" href={cheapestListing.itemUrl} rel="noreferrer" target="_blank">
          <img alt="" src={cheapestListing.imageUrl} />
          <div>
            <span>Lowest visible match</span>
            <strong>${cheapestListing.totalPrice.toFixed(2)}</strong>
            <p>{cheapestListing.title}</p>
          </div>
        </a>
      ) : null}
      <div className="listing-tile-grid">
        {sortedListings.map((listing) => (
          <a className="listing-tile" href={listing.itemUrl} key={listing.id} rel="noreferrer" target="_blank">
            {listing.imageUrl ? <img alt="" src={listing.imageUrl} /> : <div className="listing-image-placeholder">No image</div>}
            <div className="listing-tile-body">
              <strong>${listing.totalPrice.toFixed(2)}</strong>
              <h3>{listing.title}</h3>
              <p>{listing.condition} · {listing.source}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
