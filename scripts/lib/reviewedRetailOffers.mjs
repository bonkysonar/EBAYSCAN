import { createHash } from "node:crypto";
const fresh = (value, now) => { const age = Date.parse(now) - Date.parse(value); return age >= -300000 && age <= 6 * 3600000; };
const normalized = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Bounded primary-page leads, never catalog coverage or browser observations. */
export function reviewedRetailOffers(document, now = new Date().toISOString()) {
  if (document?.version !== 1 || document.captureMethod !== "public_page_reader" || !Array.isArray(document.pages))
    throw new Error("Expected reviewed primary retailer pages");
  return document.pages.map(page => {
    const url = new URL(page.url), text = String(page.text ?? "");
    const sku = url.pathname.match(/\/sku\/(\d+)\/?$/)?.[1];
    const heading = text.match(/^#\s+(.+)$/m)?.[1];
    const price = Number(text.match(/\bAvailability\s+\$([\d.]+)/)?.[1]);
    const shipping = Number(text.match(/\$([\d.]+) shipping to/)?.[1]);
    if (url.protocol !== "https:" || url.hostname !== "www.bestbuy.com" || url.username || url.password ||
        !url.pathname.startsWith("/product/") || !sku || page.sourceId !== "best-buy" ||
        !fresh(page.capturedAt, now) || text.length > 20000 || !heading || !page.artist || !page.title ||
        !normalized(text).includes(normalized(page.artist)) || !normalized(heading).includes(normalized(page.title)) ||
        !text.includes(`SKU: ${sku}`) || !/Sold by Best Buy/.test(text) || !/Add to cart/.test(text) ||
        /sold out|out of stock|pre-order|access denied|captcha/i.test(text) ||
        !/\bLP\b|VINYL/.test(heading) || /\bCD\b|cassette/i.test(heading) ||
        !(price > 0) || !Number.isFinite(price) || !Number.isFinite(shipping) || shipping < 0)
      throw new Error("Primary retailer SKU, price, stock or capture freshness could not be verified");
    const offer = {
      id: `best-buy-${sku}`, sourceId: "best-buy", sourceName: "Best Buy", sourceUrl: url.href,
      artist: page.artist, title: page.title, sourceListingTitle: `${page.artist} - ${heading}`,
      retailEditionText: heading, recordFormat: "vinyl", identityStatus: "resolved",
      identitySource: "reviewed_primary_page", physicalFormatConfirmed: true,
      condition: "new/sealed", available: true, sku, purchasePrice: price,
      sourceCurrency: "USD", sourceCountry: "US", costs: { inboundShipping: shipping },
      capturedAt: page.capturedAt, retailObservedAt: page.capturedAt,
      retailObservationMethod: "public_page_reader", purchaseOfferVerification: "direct_retailer",
      requiresRetailVerification: true,
      retailVerification: { status: "verified", checkedAt: page.capturedAt, reason: "reviewed_primary_sku_price_stock", captureMethod: "public_page_reader", advertisedPrice: price, currency: "USD" },
      reviewedRetailEvidence: { ...page, textHash: createHash("sha256").update(text).digest("hex") },
      candidateQualityScore: 95, candidateQualityReasons: ["Fresh primary retailer SKU, stock and price; individually researched lead"],
    };
    const policy = page.shippingPolicy;
    if (policy) {
      const policyUrl = new URL(policy.url);
      if (policyUrl.origin !== url.origin || policyUrl.pathname !== "/site/help-topics/free-shipping/pcmcat276800050002.c" ||
          !fresh(policy.capturedAt, now) || !/Free standard shipping on orders \$35 and up/.test(policy.text ?? "") ||
          !/after coupons and before taxes/.test(policy.text) || !/not available for Marketplace Products/.test(policy.text))
        throw new Error("Free-shipping terms are unverified");
      offer.shippingOffer = { sourceUrl: policy.url, capturedAt: policy.capturedAt, minimumSubtotal: 35, currency: "USD", standardShipping: shipping };
    }
    return offer;
  });
}

export function refreshReviewedRetailOffer(find, now = new Date().toISOString()) {
  if (!find.reviewedRetailEvidence) return find;
  try {
    const [verified] = reviewedRetailOffers({ version: 1, captureMethod: "public_page_reader", pages: [find.reviewedRetailEvidence] }, now);
    if (verified.id !== find.id || verified.sourceUrl !== find.sourceUrl) throw new Error("Offer identity changed");
    return { ...find, ...verified };
  } catch {
    return { ...find, shippingOffer: undefined, purchaseOfferVerification: "discovery_lead",
      retailVerification: { status: "needs_confirmation", checkedAt: now, reason: "reviewed_primary_page_needs_refresh" } };
  }
}
