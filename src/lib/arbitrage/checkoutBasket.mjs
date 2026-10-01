const cents = value => Math.round(value * 100);
const normalize = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A cost-only checkout observation, bound to one public product/variant. */
export function validatedCheckoutQuote(quote, product, now = new Date()) {
  if (!quote || quote.captureMethod !== "visible_browser" || quote.currency !== "USD" || product.currency !== "USD") return null;
  const age = Number(new Date(now)) - Date.parse(quote.capturedAt);
  if (!(age >= -300000 && age <= 6 * 3600000) || !Number.isInteger(quote.quantity) || quote.quantity < 2 || quote.quantity > 10) return null;
  try {
    const source = new URL(product.url), observed = new URL(quote.productUrl);
    if (source.protocol !== "https:" || observed.protocol !== "https:" || source.origin !== observed.origin ||
        source.pathname !== observed.pathname || !/^\/products\/[^/]+\/?$/.test(source.pathname) ||
        source.username || source.password || observed.username || observed.password ||
        !product.variantId || String(product.variantId) !== String(quote.variantId) ||
        source.searchParams.get("variant") !== String(quote.variantId) || observed.searchParams.get("variant") !== String(quote.variantId)) return null;
  } catch { return null; }
  const amounts = [quote.unitPrice, quote.subtotal, quote.shipping, quote.tax, quote.total];
  if (!amounts.every(n => Number.isFinite(n) && n >= 0 && n <= 10000) || quote.unitPrice <= 0 ||
      cents(quote.unitPrice) !== cents(product.price) ||
      cents(quote.subtotal) !== cents(quote.unitPrice) * quote.quantity ||
      cents(quote.total) !== cents(quote.subtotal) + cents(quote.shipping) + cents(quote.tax)) return null;
  if (!quote.productTitle || !quote.variantTitle || !normalize(product.visibleText).includes(normalize(quote.productTitle)) ||
      !normalize(product.visibleText).includes(normalize(quote.variantTitle))) return null;
  if (typeof quote.productLineText !== "string" || quote.productLineText.length > 500 ||
      !normalize(quote.productLineText).includes(normalize(quote.productTitle)) ||
      !normalize(quote.productLineText).includes(normalize(quote.variantTitle)) ||
      !new RegExp(`Quantity\\s+${quote.quantity}\\b`, "i").test(quote.productLineText) ||
      !quote.productLineText.includes(quote.subtotal.toFixed(2))) return null;
  if (typeof quote.costSummaryText !== "string" || quote.costSummaryText.length > 500 ||
      !/Subtotal/i.test(quote.costSummaryText) || !/Shipping/i.test(quote.costSummaryText) || !/Tax/i.test(quote.costSummaryText) ||
      !/USD/.test(quote.costSummaryText) || ![quote.subtotal, quote.shipping, quote.tax, quote.total].every(n => quote.costSummaryText.includes(n.toFixed(2)))) return null;
  // Whitelist only item/cost fields. No address, account, payment or checkout URL.
  return Object.fromEntries(["captureMethod", "capturedAt", "productUrl", "variantId", "currency", "quantity", "unitPrice", "subtotal", "shipping", "tax", "total", "productTitle", "variantTitle", "productLineText", "costSummaryText"].map(key => [key, quote[key]]));
}

export function checkoutBasketScenario(find, now = new Date()) {
  if (find.sourceCountry !== "US" || find.available !== true || find.retailVerification?.status !== "verified") return null;
  const quote = validatedCheckoutQuote(find.checkoutQuote, { url: find.sourceUrl, variantId: find.shopifyVariantId,
    currency: find.sourceCurrency, price: find.purchasePrice, visibleText: `${find.sourceListingTitle} ${find.shopifyVariantTitle}` }, now);
  if (!quote || (find.quantityAvailable != null && find.quantityAvailable < quote.quantity) ||
      (find.retailVerification.customerLimit != null && find.retailVerification.customerLimit < quote.quantity)) return null;
  return { quantity: quote.quantity, subtotal: quote.subtotal, orderShipping: quote.shipping,
    perRecordShipping: Math.ceil(quote.shipping * 100 / quote.quantity) / 100,
    observedTax: quote.tax, observedTotal: quote.total, capturedAt: quote.capturedAt, sourceUrl: quote.productUrl };
}
