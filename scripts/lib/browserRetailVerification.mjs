import { normalizeResearchArtist, normalizeResearchTitle } from "../../src/lib/arbitrage/soldResearchLinks.mjs";
import { retailEligibility } from "./retailIdentity.mjs";

const key = (value) => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const isRoughTrade = (url) => /^(?:www\.)?roughtrade\.com$/.test(url.hostname);
const productPath = (url) => {
  const shopify = url.pathname.match(/^\/products\/([^/]+)\/?$/);
  if (shopify) return `/products/${shopify[1]}`;
  if (isRoughTrade(url) && /^\/en-us\/product\/[^/]+\/[^/]+\/?$/.test(url.pathname)) return url.pathname.replace(/\/$/, "");
  return null;
};
const urlVariant = (url) => url.searchParams.get("variant") || (isRoughTrade(url) && /^#\d+$/.test(url.hash) ? url.hash.slice(1) : null);

// Browser evidence is a fresh observation of this exact offer, never a way to
// grant a healthy catalog status from an unrelated successful homepage visit.
export function browserVerifiedRetailOffer(find, captures, now = new Date()) {
  if (captures?.captureMethod !== "visible_browser") return null;
  for (const page of captures.pages ?? []) {
    const p = page.productEvidence;
    if (!p || page.sourceId !== find.sourceId || page.outcome !== "available") continue;
    const age = Number(now) - Date.parse(page.capturedAt);
    if (!(age >= -300000 && age <= 86400000)) continue;
    const text = String(page.visibleText).split(/You may also like|Recently viewed/i)[0];
    let purchaseBlock = text.split(/\bDescription\b|\bTracklist\b|\bShips on\b/i)[0];
    try {
      const target = new URL(find.sourceUrl), observed = new URL(page.url);
      if (target.protocol !== "https:" || observed.protocol !== "https:" || target.hostname !== observed.hostname ||
          !productPath(target) || productPath(target) !== productPath(observed)) continue;
      const targetVariant = urlVariant(target), observedVariant = urlVariant(observed);
      const knownVariants = [find.shopifyVariantId, targetVariant, observedVariant, p.variantId].filter(Boolean).map(String);
      if (new Set(knownVariants).size > 1) continue;
      const sameVariant = p.variantId && (find.shopifyVariantId || targetVariant) && observedVariant === String(p.variantId);
      const sameBarcode = p.barcode && find.barcode && key(p.barcode) === key(find.barcode) &&
        String(page.visibleText).split(/You may also like|Recently viewed/i)[0].includes(String(p.barcode));
      if (!sameVariant && !sameBarcode) continue;
      if (isRoughTrade(observed)) {
        const selected = page.selectedVariantEvidence;
        // The expanded DOM panel binds price and stock to the URL's variant.
        // Other formats, merchandising navigation and RSD history are outside it.
        if (!sameVariant || !page.purchaseBlockText || !text.includes(page.purchaseBlockText) ||
            !selected || selected.expanded !== true || String(selected.variantId) !== String(p.variantId) ||
            !selected.visibleText || !page.purchaseBlockText.includes(selected.visibleText) ||
            !key(page.purchaseBlockText).includes(key(p.artist)) || !key(page.purchaseBlockText).includes(key(p.title)) ||
            key(selected.visibleText.split(/\r?\n/)[0]) !== key(p.format)) continue;
        purchaseBlock = selected.visibleText;
      }
    } catch { continue; }
    if (key(normalizeResearchArtist(p.artist)) !== key(normalizeResearchArtist(find.artist)) ||
        key(normalizeResearchTitle(p.title)) !== key(normalizeResearchTitle(find.title))) continue;
    const currencyEvidence = String(page.visibleText);
    const currencyPattern = new RegExp(`\\b${p.currency}\\b`);
    if (!currencyPattern.test(currencyEvidence)) continue;
    if (!key(text).includes(key(p.artist)) || !key(text).includes(key(p.title))) continue;
    if (/\b(?:compact\s+disc|cd|cassette|dvd|blu[- ]?ray)\b/i.test(purchaseBlock)) continue;
    const priceLines = purchaseBlock.split(/\r?\n/).filter((line) => !/\b(?:shipping|save|savings|coupon|spend|over|minimum)\b/i.test(line));
    const displayedPrices = priceLines.flatMap((line) => [...line.matchAll(/(?:^\s*|\b(?:regular\s+price|sale\s+price|price)\s*:?\s*)[$£€]\s*([0-9]+(?:\.[0-9]{2})?)/gi)].map((m) => Number(m[1])));
    const price = Number(p.price);
    if (!displayedPrices.length || Math.abs(Math.min(...displayedPrices) - price) > .001) continue;
    if (!(price > 0) || !/^[A-Z]{3}$/.test(p.currency ?? "") || p.available !== true ||
        !/add to cart|buy now/i.test(purchaseBlock) || /sold out|out of stock|pre[- ]?order/i.test(purchaseBlock)) continue;
    const pricePattern = new RegExp(`(?:\\$\\s*|\\b)${price.toFixed(2).replace(".", "\\.")}(?:\\b|\\s)`);
    if (!pricePattern.test(purchaseBlock)) continue;
    const candidate = {...find,physicalFormatConfirmed:true,available:true,recordFormat:p.format,
      sourceListingTitle:`${p.artist} - ${p.title} ${p.format}`,shopifyVariantTitle:p.format};
    if (!retailEligibility(candidate).eligible || !/vinyl|\blp\b|\d\s*lp|\d\s*[x-]\s*lp/i.test(p.format ?? "")) continue;
    return {
      ...candidate,
      sourceCurrency:p.currency,
      purchasePrice:price,
      purchasePriceUsd:p.currency === "USD" ? price : null,
      sourceOriginalPrice:displayedPrices.includes(Number(p.originalPrice)) ? Number(p.originalPrice) : null,
      sourceDiscountPercent:p.originalPrice > price && displayedPrices.includes(Number(p.originalPrice)) ? Math.round((1-price/p.originalPrice)*100) : null,
      appliedSaleCampaignId:null,appliedSaleCode:null,appliedSaleDiscountPercent:null,appliedCampaign:undefined,
      capturedAt:page.capturedAt,
      purchaseOfferVerification:"direct_retailer",
      requiresRetailVerification:true,
      retailVerification:{status:"verified",checkedAt:page.capturedAt,reason:"exact_offer_observed_in_browser",captureMethod:"visible_browser",advertisedPrice:price,currency:p.currency,availabilityEvidence:p.availabilityEvidence,
        ...(p.customerLimit > 0 && new RegExp(`Customer Limit\\s+${p.customerLimit}(?:\\s|$)`, "i").test(purchaseBlock) ? {customerLimit:p.customerLimit} : {})},
    };
  }
  return null;
}
