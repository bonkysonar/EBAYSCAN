import { decodeHtmlEntities } from './retailListingParsing.mjs';
const clean = value => decodeHtmlEntities(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function discoverTopshelfProducts(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  return [...new Set([...String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["']/g)].flatMap(match => {
    try {
      const url = new URL(decodeHtmlEntities(match[1]), pageUrl);
      return url.origin === origin && /^\/products\/\d+-[^/]+$/.test(url.pathname) ? [url.href] : [];
    } catch { return []; }
  }))];
}

/** The US store's enabled purchase options carry their own format and USD price. */
export function parseTopshelfVinyl(html, pageUrl) {
  const heading = String(html).match(/<h2\b[^>]*>([^<]+)<i>([\s\S]*?)<\/i>\s*<\/h2>/i);
  const artist = clean(heading?.[1]), title = clean(heading?.[2]);
  const select = String(html).match(/<select\b[^>]*id=["']cart_variation_id["'][^>]*>([\s\S]*?)<\/select>/i)?.[1];
  if (!artist || !title || !select || /\brandom\b|\bmystery\b|\bdamaged\b/i.test(title)) return [];
  const items = [];
  for (const option of select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const id = option[1].match(/\bvalue=["'](\d+)["']/)?.[1];
    const label = clean(option[2]);
    if (!id || /\bdisabled\b/i.test(option[1]) || /out.of.stock|sold.out|pre.?order|\b(?:cd|cassette|digital)\b/i.test(label)) continue;
    const match = label.match(/^(.+?)\s*[-–—]\s*\$(\d+(?:\.\d{2})?)$/);
    if (!match || !/\bvinyl\b|\b(?:\d+x\s*)?LP\b|(?:7|10|12)["″]/i.test(match[1]) || !(Number(match[2]) > 0)) continue;
    items.push({stableId:`topshelf:${id}`,productId:id,title:`${artist} - ${title} (Vinyl)`,currentPrice:Number(match[2]),currency:'USD',canonicalUrl:pageUrl,
      variantTitle:match[1], available:true, availability:'in_stock',physicalFormatConfirmed:true,recordFormat:'vinyl',
      identity:{artist,title,identityStatus:'resolved',identitySource:'retailer_product_heading',retailEditionText:match[1],physicalFormatConfirmed:true},
      sourceKinds:['topshelf_purchase_option']});
  }
  return items;
}
