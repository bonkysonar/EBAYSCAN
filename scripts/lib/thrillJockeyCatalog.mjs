import { decodeHtmlEntities } from './retailListingParsing.mjs';
const clean = (value) => decodeHtmlEntities(String(value ?? '').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();

export function discoverThrillJockeyProducts(html, pageUrl) {
  return [...new Set([...String(html).matchAll(/<a\b[^>]*itemprop=["']url["'][^>]*href=["']([^"']+)["']/g)].map(m=>new URL(m[1],pageUrl))
    .filter(url=>url.origin===new URL(pageUrl).origin && /^\/products\/[^/]+$/.test(url.pathname)).map(url=>url.href))];
}

export function parseThrillJockeyVinyl(html, pageUrl) {
  const title = clean(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const artist = clean(String(html).match(/<h2\b[^>]*>\s*<a\b[^>]*href=["']\/artists\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]);
  if (!title || !artist) return [];
  const items = [];
  for (const match of String(html).matchAll(/<div\b[^>]*id=["']variant-(\d+)["'][^>]*>([\s\S]*?)<\/form>\s*<\/div>/gi)) {
    const row = match[2];
    const format = clean(row.match(/<span\b[^>]*class=["']font-bold["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    if (!/\bLP\b|\bvinyl\b/i.test(format) || /preorder|\bCD\b|MP3|out.of.stock|sold.out/i.test(clean(row))) continue;
    const button = row.match(/<button\b[^>]*id=["']add-to-cart-button["'][^>]*>/i)?.[0];
    if (!button || /\bdisabled\b/i.test(button)) continue;
    const price = Number(row.match(/<span>\s*\$(\d+\.\d{2})\s*<\/span>/)?.[1]);
    if (!(price > 0)) continue;
    items.push({stableId:`thrill:${match[1]}`,productId:match[1],title:`${artist} - ${title} (${format})`,currentPrice:price,currency:'USD',canonicalUrl:pageUrl,
      variantTitle:format,available:true,availability:'in_stock',physicalFormatConfirmed:true,recordFormat:'vinyl',sourceKinds:['thrill_jockey_format_row']});
  }
  return items;
}
