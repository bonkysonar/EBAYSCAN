/** A proposed same-retailer basket. A single item never silently ships free. */
export function shippingOfferScenario(find, now = new Date()) {
  const offer = find.shippingOffer;
  if (!offer || find.sourceCountry !== "US" || find.sourceCurrency !== "USD" || offer.currency !== "USD" ||
      !(offer.minimumSubtotal > 0) || !(offer.standardShipping > 0) || !(find.purchasePrice > 0) ||
      find.available !== true || find.retailVerification?.status !== "verified") return null;
  const age = Number(new Date(now)) - Date.parse(offer.capturedAt);
  if (!(age >= -300000 && age <= 6 * 3600000)) return null;
  try { if (new URL(offer.sourceUrl).origin !== new URL(find.sourceUrl).origin) return null; } catch { return null; }
  const quantity = Math.ceil(offer.minimumSubtotal / find.purchasePrice);
  if (quantity < 2 || quantity > 10 || (find.quantityAvailable != null && find.quantityAvailable < quantity)) return null;
  return { quantity, minimumSubtotal: offer.minimumSubtotal, subtotal: Math.round(quantity * find.purchasePrice * 100) / 100,
    additionalSpend: Math.round((quantity - 1) * find.purchasePrice * 100) / 100,
    standardShipping: offer.standardShipping, sourceUrl: offer.sourceUrl,
    condition: `Requires a qualifying ${find.sourceName} order of $${offer.minimumSubtotal.toFixed(2)} before tax. Confirm free shipping and quantity at checkout.` };
}
