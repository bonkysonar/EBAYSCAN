import {
  normalizeResearchArtist,
  normalizeResearchTitle,
} from "../../src/lib/arbitrage/soldResearchLinks.mjs";
import { priceCampaignBasket } from "./campaignOffers.mjs";
import { retailEligibility, shopifyIdentity } from "./retailIdentity.mjs";

/** Read-only Shopify Ajax product + currency checks, using the scan's configured same-store URLs. */
export async function verifyRetailOffer(
  find,
  fetchJson,
  now = new Date().toISOString(),
) {
  if (!find.shopifyVariantId) return find;
  const failed = (status, reason) => ({
    ...find,
    purchaseOfferVerification: "discovery_lead",
    retailVerification: { status, reason, checkedAt: now },
    ...(status === "unavailable" ? { available: false } : {}),
  });
  try {
    const url = new URL(find.sourceUrl);
    const handle = url.pathname.match(/\/products\/([^/]+)/)?.[1];
    if (!handle || !/^https:$/.test(url.protocol))
      return failed("failed", "unsupported_product_url");
    const product = await fetchJson(`${url.origin}/products/${handle}.js`);
    const variant = product.variants?.find(
      (row) => String(row.id) === String(find.shopifyVariantId),
    );
    if (!variant || product.handle !== decodeURIComponent(handle))
      return failed("failed", "variant_identity_changed");
    if (variant.available !== true || variant.requires_shipping === false)
      return failed("unavailable", "physical_variant_unavailable");
    const identity = shopifyIdentity(product, variant, find);
    const key = (value) =>
      String(value)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]/g, "");
    if (
      find.identityStatus === "resolved" &&
      (key(normalizeResearchArtist(find.artist)) !==
        key(normalizeResearchArtist(identity.artist)) ||
        key(normalizeResearchTitle(find.title)) !==
          key(normalizeResearchTitle(identity.title)))
    )
      return failed("failed", "record_identity_changed");
    const eligibility = retailEligibility({
      ...find,
      ...identity,
      sourceListingTitle: product.title,
      shopifyVariantTitle: variant.title,
    });
    if (!eligibility.eligible) return failed("unavailable", eligibility.reason);
    if (
      find.barcode &&
      variant.barcode &&
      String(find.barcode) !== String(variant.barcode)
    )
      return failed("failed", "barcode_changed");
    const cart = await fetchJson(`${url.origin}/cart.js`);
    const currency =
      typeof cart.currency === "string" ? cart.currency.toUpperCase() : null;
    if (!currency || !/^[A-Z]{3}$/.test(currency))
      return failed("failed", "currency_unverified");
    const price = Number(variant.price) / 100;
    if (!(price > 0)) return failed("failed", "invalid_price");
    const campaignEstimate = Boolean(find.appliedSaleCampaignId);
    const sameCurrency = currency === find.sourceCurrency;
    const refreshedScenario =
      find.appliedCampaign && sameCurrency
        ? priceCampaignBasket(
            [
              {
                ...find,
                purchasePrice: price,
                sourceOriginalPrice:
                  Number(variant.compare_at_price) / 100 || null,
                sourceDiscountPercent: null,
              },
            ],
            find.appliedCampaign,
            now,
          )
        : null;
    const discardCampaign =
      campaignEstimate &&
      (!sameCurrency || (refreshedScenario && !refreshedScenario.eligible));
    const expectedPrice = discardCampaign
      ? price
      : refreshedScenario?.eligible
        ? refreshedScenario.total
        : Number(find.purchasePrice);
    const confirmed =
      !campaignEstimate ||
      discardCampaign ||
      (sameCurrency && Math.abs(price - expectedPrice) <= 0.011);
    return {
      ...find,
      ...identity,
      sourceCurrency: currency,
      ...(discardCampaign
        ? {
            appliedSaleCampaignId: null,
            appliedSaleCode: null,
            appliedSaleDiscountPercent: null,
            appliedCampaign: undefined,
            sourceOriginalPrice: Number(variant.compare_at_price) / 100 || null,
            sourceDiscountPercent: null,
          }
        : {}),
      ...(!sameCurrency
        ? {
            currencyConversionRate: null,
            currencyConversionUpdatedAt: null,
            purchasePriceUsd: null,
          }
        : {}),
      available: true,
      barcode: variant.barcode || find.barcode,
      sku: variant.sku || find.sku,
      shopifyVariantTitle: variant.title,
      capturedAt: now,
      // A code that only appears at checkout stays an explicit estimate.
      purchasePrice: confirmed || !sameCurrency ? price : expectedPrice,
      purchaseOfferVerification:
        confirmed && identity.identityStatus === "resolved"
          ? "direct_retailer"
          : "campaign_advertised",
      retailVerification: {
        status: confirmed ? "verified" : "needs_confirmation",
        checkedAt: now,
        reason: confirmed
          ? "variant_price_stock_currency_confirmed"
          : "confirm_campaign_price_at_checkout",
        advertisedPrice: price,
        expectedPrice,
        currency,
      },
    };
  } catch (error) {
    return failed("failed", String(error?.message ?? error).slice(0, 200));
  }
}

export async function verifyRetailOffers(
  finds,
  fetchJson,
  { concurrency = 4, now = new Date().toISOString() } = {},
) {
  const output = [...finds];
  let cursor = 0;
  // Cache only anonymous currency reads for this bounded verification pass.
  const currency = new Map();
  const blocked = new Set();
  const deadline = Date.now() + 180000;
  const guardedRead = async (url) => {
    const host = new URL(url).host;
    if (blocked.has(host) || Date.now() > deadline)
      throw new Error(
        "Retail verification deferred after access failure or time budget",
      );
    try {
      return await fetchJson(url);
    } catch (error) {
      if (/HTTP (?:403|429)|timeout/i.test(error.message)) blocked.add(host);
      throw error;
    }
  };
  const read = (url) => {
    if (!url.endsWith("/cart.js")) return guardedRead(url);
    if (!currency.has(url)) currency.set(url, guardedRead(url));
    return currency.get(url);
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, finds.length) }, async () => {
      while (cursor < finds.length) {
        const index = cursor++;
        output[index] = await verifyRetailOffer(finds[index], read, now);
      }
    }),
  );
  return output;
}
