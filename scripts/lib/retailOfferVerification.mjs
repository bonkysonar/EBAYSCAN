import {
  normalizeResearchArtist,
  normalizeResearchTitle,
} from "../../src/lib/arbitrage/soldResearchLinks.mjs";
import { priceCampaignBasket } from "./campaignOffers.mjs";
import { retailEligibility } from "./retailIdentity.mjs";
import { readBuyButtonVinylProduct } from "./shopifyBuyButtonCatalog.mjs";
import { formatRetailAdapter } from "./formatRetailAdapters.mjs";
import { reconciledShopifyIdentity } from "./retailBarcodeIdentity.mjs";

const identityKey = (value) => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const recordIdentityChanged = (before, after) => before.identityStatus === "resolved" && (
  identityKey(normalizeResearchArtist(before.artist)) !== identityKey(normalizeResearchArtist(after.artist)) ||
  identityKey(normalizeResearchTitle(before.title)) !== identityKey(normalizeResearchTitle(after.title))
);

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
    const identity = reconciledShopifyIdentity(find, product, variant);
    if (recordIdentityChanged(find, identity))
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
  { concurrency = 4, now = new Date().toISOString(), readPage } = {},
) {
  const output = [...finds];
  let cursor = 0;
  // Cache only anonymous currency reads for this bounded verification pass.
  const currency = new Map();
  const blocked = new Set();
  const guardedRead = async (url) => {
    const host = new URL(url).host;
    if (blocked.has(host))
      throw new Error(
        "Retail verification deferred after access failure",
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
  const guardedPage = async (url, init) => {
    const host = new URL(url).host;
    if (blocked.has(host)) throw new Error('Retail verification deferred after access failure');
    try {
      const response = await readPage(url, init);
      if (response.url && new URL(response.url).origin !== new URL(url).origin) throw new Error('Product redirected outside configured store');
      return response;
    }
    catch (error) {
      if (/HTTP (?:403|429)|timeout/i.test(error.message)) blocked.add(host);
      throw error;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, finds.length) }, async () => {
      while (cursor < finds.length) {
        const index = cursor++;
        const find = finds[index];
        if (find.buyButtonProductId) {
          try {
            if (!readPage) throw new Error('Public Storefront verification reader unavailable');
            const page = await guardedPage(find.sourceUrl);
            const parsed = await readBuyButtonVinylProduct(page.html, find.sourceUrl, guardedPage, find);
            const item = parsed.items.find((item) => item.buyButtonProductId === find.buyButtonProductId && item.buyButtonVariantId === find.buyButtonVariantId);
            if (!item) throw new Error('Exact public Storefront vinyl variant unavailable');
            if (recordIdentityChanged(find, item.identity)) throw new Error('record_identity_changed');
            if (find.barcode && item.gtin && String(find.barcode) !== String(item.gtin)) throw new Error('barcode_changed');
            output[index] = { ...find, ...item.identity, purchasePrice:item.currentPrice, sourceCurrency:item.currency,
              barcode:item.gtin || find.barcode, sku:item.sku || find.sku, retailVariantTitle:item.variantTitle,
              ...(item.currency !== find.sourceCurrency ? {purchasePriceUsd:null,currencyConversionRate:null,currencyConversionUpdatedAt:null} : {}),
              available:true, capturedAt:now, retailVerification:{...item.retailVerification,checkedAt:now},
              purchaseOfferVerification:item.identity.identityStatus === 'resolved' ? 'direct_retailer' : 'discovery_lead' };
          } catch (error) {
            output[index] = {...find, purchaseOfferVerification:'discovery_lead',retailVerification:{status:'failed',checkedAt:now,reason:String(error?.message ?? error).slice(0,200)}};
          }
        } else if (formatRetailAdapter(find.sourceId)) {
          try {
            const adapter = formatRetailAdapter(find.sourceId);
            if (!readPage) throw new Error('Format-specific verification reader unavailable');
            const url = new URL(find.sourceUrl);
            if (url.protocol !== 'https:' || url.hostname !== adapter.host) throw new Error('Unsupported format-specific retailer URL');
            const page = await guardedPage(url.href);
            const items = adapter.parse(page.html,url.href);
            const matches = items.filter(item => find.retailFormatVariantId
              ? item.stableId === find.retailFormatVariantId
              : find.sku && String(item.sku ?? item.productId) === String(find.sku));
            if (matches.length !== 1) throw new Error('Exact format-specific vinyl variant unavailable');
            const item = matches[0];
            if (item.available !== true || item.physicalFormatConfirmed !== true) throw new Error('Physical vinyl availability unverified');
            if (item.identity ? recordIdentityChanged(find,item.identity) : identityKey(item.title) !== identityKey(find.sourceListingTitle)) throw new Error('record_identity_changed');
            if (find.barcode && item.gtin && String(find.barcode) !== String(item.gtin)) throw new Error('barcode_changed');
            output[index] = {...find, ...(item.identity ?? {}), purchasePrice:item.currentPrice,sourceCurrency:item.currency,
              sourceListingTitle:item.title,barcode:item.gtin || find.barcode,sku:item.sku ?? item.productId,
              retailVariantTitle:item.variantTitle,retailEditionText:item.identity?.retailEditionText ?? item.variantTitle,
              available:true,stockStatus:'in_stock',capturedAt:now,retailFormatVariantId:item.stableId,
              purchasePriceUsd:item.currency === 'USD' ? item.currentPrice : null,
              ...(item.currency !== find.sourceCurrency ? {currencyConversionRate:null,currencyConversionUpdatedAt:null} : {}),
              sourceOriginalPrice:item.regularPrice ?? null,sourceDiscountPercent:item.regularPrice > item.currentPrice ? Math.round((1-item.currentPrice/item.regularPrice)*100) : null,
              appliedSaleCampaignId:null,appliedSaleCode:null,appliedSaleDiscountPercent:null,appliedCampaign:undefined,
              purchaseOfferVerification:'direct_retailer',
              retailVerification:{status:'verified',checkedAt:now,reason:'exact_format_price_stock_currency_confirmed',advertisedPrice:item.currentPrice,currency:item.currency}};
          } catch (error) {
            output[index] = {...find,purchaseOfferVerification:'discovery_lead',retailVerification:{status:'failed',checkedAt:now,reason:String(error?.message ?? error).slice(0,200)}};
          }
        } else {
          output[index] = await verifyRetailOffer(find, read, now);
        }
      }
    }),
  );
  return output;
}
