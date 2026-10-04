import { shopifyIdentity, retailEligibility } from './retailIdentity.mjs';

// Shopify documents this public browser token interface at
// https://shopify.dev/docs/storefronts/headless/additional-sdks/buy-button
// Read only the product IDs actually embedded by the merchant. Never persist tokens.
export async function readBuyButtonVinylProduct(html, pageUrl, readPage, source = {}) {
  const client = String(html).match(/ShopifyBuy\.buildClient\(\{([\s\S]{0,1500}?)\}\)/)?.[1];
  const domain = client?.match(/domain:\s*['"]([a-z0-9-]+\.myshopify\.com)['"]/i)?.[1];
  const token = client?.match(/storefrontAccessToken:\s*['"]([a-zA-Z0-9_-]+)['"]/)?.[1];
  const ids = [...new Set([...String(html).matchAll(/createComponent\(['"]product['"][\s\S]{0,200}?id:\s*['"](\d+)['"]/g)].map((m) => `gid://shopify/Product/${m[1]}`))];
  if (!domain || !token || !ids.length) return { supported: false, items: [] };
  const result = await readPage(`https://${domain}/api/2026-07/graphql.json`, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
    body: JSON.stringify({query: 'query($ids:[ID!]!){nodes(ids:$ids){... on Product{id title vendor productType handle tags variants(first:100){nodes{id title availableForSale currentlyNotInStock requiresShipping sku barcode price{amount currencyCode} selectedOptions{name value}} pageInfo{hasNextPage}}}}}', variables: { ids } }),
  });
  const payload = JSON.parse(result.html);
  if (payload.errors?.length) throw new Error('Public Storefront product query failed');
  const items = [];
  for (const product of payload.data?.nodes ?? []) {
    if (!product || !ids.includes(product.id) || product.variants?.pageInfo?.hasNextPage) continue;
    for (const variant of product.variants?.nodes ?? []) {
      if (!variant.availableForSale || variant.currentlyNotInStock || variant.requiresShipping !== true) continue;
      const identity = buyButtonIdentity(product, variant, source);
      const price = Number(variant.price?.amount), currency = variant.price?.currencyCode;
      if (identity.physicalFormatConfirmed !== true || !retailEligibility({...identity, sourceListingTitle:product.title, shopifyVariantTitle:variant.title}).eligible || !(price > 0) || !/^[A-Z]{3}$/.test(currency)) continue;
      items.push({ stableId:variant.id, productId:product.id, sku:variant.sku, gtin:variant.barcode,
        title: product.title, canonicalUrl:pageUrl, currentPrice:price, currency,
        available:true, availability:'in_stock', sourceKinds:['shopify_public_buy_button_api'],
        physicalFormatConfirmed:true, recordFormat:'vinyl', variantTitle:variant.title,
        identity, buyButtonProductId:product.id, buyButtonVariantId:variant.id,
        retailVerification:{status:'verified', checkedAt:new Date().toISOString(), reason:'public_storefront_variant_price_stock_currency_confirmed'},
      });
    }
  }
  return { supported: true, items };
}

export function buyButtonIdentity(product, variant, source = {}) {
  const identity = shopifyIdentity({...product, product_type:product.productType}, variant, source);
  // Barsuk's API appends " - LP <color> [sku]" to the actual release name.
  // Preserve that exact edition for matching, but keep it out of the album query.
  if ((source.id ?? source.sourceId) === 'barsuk-records') {
    const match = product.title.match(/^(.+?)\s+[-–—]\s+(.+?)\s+[-–—]\s+((?:(?:\d+\s*x)?LP\b|(?:7|10|12)["″]).*)$/i);
    if (match) return {...identity, artist:match[1].trim(),title:match[2].trim(),retailEditionText:match[3].replace(/\s*\[[^\]]+\]\s*$/, '').trim(),identityStatus:'resolved'};
  }
  return identity;
}

export function discoverBarsukProductUrls(html, pageUrl) {
  return [...new Set([...String(html).matchAll(/<div\b[^>]*class=["']ub-img["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["']/g)]
    .map((m) => new URL(m[1], pageUrl)).filter((url) => url.origin === new URL(pageUrl).origin && /^\/shop\/[^/]+$/.test(url.pathname)).map((url) => url.href))];
}
