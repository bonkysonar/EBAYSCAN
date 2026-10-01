const positive = n => Number.isFinite(n) && n > 0;
const fresh = (at, now) => {
  const age = Number(now) - Date.parse(at);
  return age >= -300000 && age <= 6 * 3600000;
};

/** Asking prices constrain a sold-backed estimate; they never establish value. */
export function resalePricing(find, sold, active, historicalPrice, now, minimumConfidence) {
  const lowest = active.matchConfidence >= minimumConfidence && fresh(active.capturedAt, now) &&
    positive(find.lowestActivePrice) ? find.lowestActivePrice : null;
  const quotes = new Map();
  for (const row of find.ebayActiveListings ?? []) {
    if (!row.id || row.currency !== "USD" || !/^(?:new|brand new|new\/sealed)$/i.test(row.condition ?? "") || !positive(row.totalPrice) ||
        !positive(row.price) || !Number.isFinite(row.shippingPrice) || row.shippingPrice < 0 ||
        Math.abs(row.price + row.shippingPrice - row.totalPrice) > .011 ||
        !(row.matchConfidence === "high" || row.matchScore >= minimumConfidence)) continue;
    quotes.set(row.id, Math.min(quotes.get(row.id) ?? Infinity, row.totalPrice));
  }
  const prices = [...quotes.values()].sort((a, b) => a - b);
  // Require a complete exact search and broad priced coverage. The API retains
  // the cheapest ten quotes, so truncation can only lower this percentile.
  const supported = lowest !== null && historicalPrice !== null && active.searchComplete &&
    active.status === "available" && active.exactCount >= prices.length &&
    prices.length >= 4 && prices.length / Math.min(active.exactCount, 10) >= .8 &&
    Math.abs(prices[0] - lowest) < .011 && sold.status === "validated" &&
    sold.velocityValidated && sold.units90 >= 3 && sold.matchConfidence >= minimumConfidence &&
    fresh(sold.capturedAt, now);
  const cap = supported ? prices[Math.ceil(prices.length * .25) - 1] :
    lowest === null ? null : Math.round(lowest * .98 * 100) / 100;
  return {
    basis: supported ? "sold_and_active_lower_quartile" : "lowest_active_undercut",
    activeResaleCap: cap,
    resalePrice: historicalPrice === null ? null : Math.min(historicalPrice, cap ?? historicalPrice),
    lowestActivePrice: lowest,
    quoteCount: prices.length,
  };
}

/** A double LP should not inherit the single-LP label allowance. */
export function sellingCostsForFormat(find, settings) {
  const text = `${find.sourceListingTitle ?? ""} ${find.recordFormat ?? ""}`;
  const doubleLp = /\b2\s*[x×]?\s*LP\b|\bdouble\s+(?:LP|vinyl)\b/i.test(text);
  if (!doubleLp || Number.isFinite(find.costs?.outboundShipping)) return find.costs;
  return { ...find.costs, outboundShipping: Math.max(settings.defaultOutboundShipping, 6) };
}
