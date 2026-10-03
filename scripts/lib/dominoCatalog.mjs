import { balancedJsonAfter, extractStructuredRetailPayloads } from './structuredRetailCatalog.mjs';
import { decodeHtmlEntities } from './retailListingParsing.mjs';

export function discoverDominoProducts(html, pageUrl) {
  const releases = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["']/g)) {
    try {
      const url = new URL(decodeHtmlEntities(match[1]), pageUrl);
      if (url.origin !== new URL(pageUrl).origin || !/^\/releases\/[^/]+\/[^/]+\/[^/]*(?:lp|vinyl)[^/]*$/i.test(url.pathname)) continue;
      const album = url.pathname.split('/').slice(0,4).join('/');
      if (!releases.has(album)) releases.set(album,url.href);
    } catch { /* Ignore malformed public links. */ }
  }
  return [...releases.values()];
}

/** Join the public purchase controls to the same SKU's structured offer.
 * A parent "From" price, another currency, or a download is never vinyl evidence. */
export function parseDominoVinyl(html, pageUrl) {
  const marker = /\bdata:\s*(?=\{"releases":)/.exec(String(html));
  if (!marker) return [];
  let data;
  try { data = JSON.parse(balancedJsonAfter(String(html),marker.index + marker[0].length)); }
  catch { return []; }
  const products = extractStructuredRetailPayloads(html).flatMap(p=>p['@graph'] ?? [p]).filter(p=>p['@type']==='Product');
  const items = [];
  for (const release of data.releases ?? []) {
    if (release.status?.available !== true || release.status?.main !== 'Buy' || release.status?.shipping_date || release.status?.unsellable_country) continue;
    if (!/\b(?:\d+x)?LP\b|\bvinyl\b/i.test(release.format) || /\b(?:CD|Download|Cassette)\b/i.test(release.format)) continue;
    const currency = release.ga_data?.currency;
    const product = products.find(p=>p.name === release.title && (typeof p.brand === 'string' ? p.brand : p.brand?.name) === release.artist);
    const offers = (Array.isArray(product?.offers) ? product.offers : [product?.offers]).filter(o=>o && o.sku === release.sku && o.priceCurrency === currency && o.description === release.format && /\/InStock$/.test(o.availability));
    if (offers.length !== 1 || !/^[A-Z]{3}$/.test(currency)) continue;
    const offer = offers[0], price = Number(offer.price);
    if (!(price > 0) || Math.abs(price - Number(release.ga_data.value)) > .001) continue;
    let url;
    try { url = new URL(offer.url,pageUrl); } catch { continue; }
    if (url.origin !== new URL(pageUrl).origin || !url.pathname.startsWith(new URL(pageUrl).pathname.split('/').slice(0,4).join('/')+'/')) continue;
    items.push({stableId:`domino:${release.sku}:${currency}`,productId:release.id,sku:release.sku,gtin:offer.gtin12 ?? offer.gtin13,
      title:`${release.artist} - ${release.title} (${release.format})`,currentPrice:price,currency,canonicalUrl:url.href,
      variantTitle:release.format,available:true,availability:'in_stock',physicalFormatConfirmed:true,recordFormat:'vinyl',
      identity:{artist:release.artist,title:release.title,identityStatus:'resolved',identitySource:'retailer_purchase_controls',retailEditionText:release.format,physicalFormatConfirmed:true},
      sourceKinds:['domino_format_offer']});
  }
  return items;
}
