import { decodeHtmlEntities } from './retailListingParsing.mjs';
import { parseStructuredRetailCatalog } from './structuredRetailCatalog.mjs';

const clean = value => decodeHtmlEntities(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/&pound;/gi, '£').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const uncomment = html => String(html).replace(/<!--[\s\S]*?-->/g, '');
const vinyl = value => /\b(?:\d+x)?LP\b|\bvinyl\b|(?:7|10|12)["″]/i.test(value) && !/\b(?:CD|cassette|download|digital|storage|cleaner|sleeves?)\b/i.test(value);

function observedLinks(html, pageUrl, pattern) {
  const origin = new URL(pageUrl).origin;
  return [...new Set([...uncomment(html).matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].flatMap(match => {
    try {
      const url = new URL(decodeHtmlEntities(match[1]), pageUrl);
      return url.origin === origin && pattern.test(url.pathname) ? [url.origin + url.pathname] : [];
    } catch { return []; }
  }))];
}

export const discoverHonestJonsProducts = (html, url) => observedLinks(html, url, /^\/shop\/artist\/[^/]+\/release\/[^/]+\/?$/);
export const discoverResidentProducts = (html, url) => observedLinks(html, url, /^\/product\/[^/]+\/?$/);
export const discoverZavviProducts = (html, url) => observedLinks(html, url, /^\/p\/merch-vinyl\/[^/]+\/\d+\/?$/);
export const discoverPlasticHeadProducts = (html, url) => observedLinks(html, url, /^\/[^/]+-vinyl-(?:lp|7|10|12)[^/]*$/i);

/** Read only the main release's enabled format button, never a related album or commented-out form. */
export function parseHonestJonsVinyl(html, pageUrl) {
  const source = uncomment(String(html).split(/<!--\s*end detail\.php\s*-->/i)[0]);
  const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(source);
  if (!heading) return [];
  const artist = clean(heading[1]), title = clean(heading[2]);
  const forms = source.slice(heading.index + heading[0].length).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi);
  const form = [...forms].find(match => /\baction=["']https:\/\/honestjons\.com\/cart\/add_cart_item\/shop["']/i.test(match[1]));
  if (!artist || !title || !form) return [];
  return [...form[2].matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].flatMap(button => {
    const id = button[1].match(/\bname=["']add\[(\d+)\]["']/)?.[1];
    const label = clean(button[2]);
    const match = label.match(/^(.+?)\s*£(\d+(?:\.\d{2})?)$/);
    if (!id || /\bdisabled\b/i.test(button[1]) || !/\btitle=["']Add to basket["']/i.test(button[1]) || !match || !vinyl(match[1]) || /pre.?order|back.?order|out.of.stock/i.test(label) || !(Number(match[2]) > 0)) return [];
    return [{stableId:`honest-jons:${id}`, productId:id, sku:id, title:`${artist} - ${title} (${match[1]})`, currentPrice:Number(match[2]), currency:'GBP', canonicalUrl:pageUrl,
      variantTitle:match[1], available:true, availability:'in_stock', physicalFormatConfirmed:true, recordFormat:'vinyl',
      identity:{artist,title,identityStatus:'resolved',identitySource:'retailer_product_heading',retailEditionText:match[1],physicalFormatConfirmed:true}, sourceKinds:['honest_jons_format_button']}];
  });
}

// Astro's public HTML encodes primitives/objects with 0 and arrays with 1.
// Do not evaluate JavaScript, or guess at unknown serialized types.
function decodeAstro(value, depth = 0) {
  if (depth > 30 || !Array.isArray(value) || value.length !== 2) throw new Error('Unsupported public variant data');
  const [type, data] = value;
  if (type === 1 && Array.isArray(data)) return data.map(item => decodeAstro(item, depth + 1));
  if (type !== 0) throw new Error('Unsupported public variant type');
  if (data && typeof data === 'object' && !Array.isArray(data)) return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, decodeAstro(item, depth + 1)]));
  if (data === null || ['string','number','boolean'].includes(typeof data)) return data;
  throw new Error('Unsupported public variant value');
}

export function parseResidentVinyl(html, pageUrl) {
  const source = uncomment(html);
  const artist = clean(source.match(/<h2\b[^>]*class=["'][^"']*\bartist\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
  const title = clean(source.match(/<h1\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if (!artist || !title) return [];
  const island = [...source.matchAll(/<astro-island\b([^>]*)>/gi)].find(match => /\bcomponent-export=["']VariantAccordion["']/.test(match[1]));
  if (!island) return [];
  let props;
  try {
    const raw = island[1].match(/\bprops="([^"]*)"/)?.[1];
    props = decodeAstro([0, JSON.parse(decodeHtmlEntities(raw))]);
  } catch { return []; }
  if (new URL(pageUrl).pathname.replace(/\/$/, '') !== `/product/${props.productHandle}` || !Array.isArray(props.variants)) return [];
  return props.variants.flatMap(variant => {
    const listing = variant.listOnWebsite;
    // availableForSale alone also includes backorders at this merchant.
    if (!variant.id || variant.availableForSale !== true || variant.currentlyNotInStock !== false || listing?.canBuy !== true || listing?.canList !== true || listing?.isPreorder !== false || !vinyl(variant.title)) return [];
    const price = Number(variant.price?.amount), currency = variant.price?.currencyCode;
    if (!(price > 0) || !/^[A-Z]{3}$/.test(currency)) return [];
    const regular = variant.compareAtPrice?.currencyCode === currency ? Number(variant.compareAtPrice.amount) : null;
    return [{stableId:`resident:${variant.id}`,productId:props.productId,sku:variant.id,gtin:variant.barcode || null,title:`${artist} - ${title} (${variant.title})`, currentPrice:price,regularPrice:regular > price ? regular : null,currency,canonicalUrl:pageUrl,
      variantTitle:variant.title,available:true,availability:'in_stock',physicalFormatConfirmed:true,recordFormat:'vinyl',
      identity:{artist,title,identityStatus:'resolved',identitySource:'retailer_product_heading',retailEditionText:variant.title,physicalFormatConfirmed:true},sourceKinds:['resident_public_variant']}];
  });
}

/** This merchant publishes exact PDP offer/stock in Product JSON-LD. */
export function parseZavviVinyl(html, pageUrl) {
  const sku = new URL(pageUrl).pathname.match(/^\/p\/merch-vinyl\/[^/]+\/(\d+)\/?$/)?.[1];
  if (!sku) return [];
  const items = parseStructuredRetailCatalog(html, pageUrl).items.filter(item => String(item.sku) === sku && item.available === true && item.availability === 'in_stock' && vinyl(item.title) && item.currentPrice > 0 && /^[A-Z]{3}$/.test(item.currency));
  // Conflicting structured offers cannot verify an exact purchase price.
  if (items.length !== 1) return [];
  return [{...items[0],stableId:`zavvi:${sku}`,canonicalUrl:pageUrl,physicalFormatConfirmed:true,recordFormat:'vinyl'}];
}

export function parsePlasticHeadVinyl(html, pageUrl) {
  const source = uncomment(html).split(/<div\b[^>]*class=["']product-rows["']/i)[0];
  const heading = source.match(/<div\b[^>]*class=["']product-page-title["'][^>]*>\s*<div>\s*<h1>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<br\s*\/?>\s*([\s\S]*?)<\/h1>/i);
  if (!heading) return [];
  const artist = clean(heading[1]), title = clean(heading[2]);
  const product = source.slice(heading.index);
  const format = clean(product.match(/<div\b[^>]*class=["']ptype["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  const price = clean(product.match(/<div\b[^>]*class=["']price["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]).match(/^£(\d+(?:\.\d{2})?)$/);
  const sku = clean(product.match(/Item no\.\s*:\s*<span>([^<]+)<\/span>/i)?.[1]);
  const buy = [...product.matchAll(/<input\b([^>]*)>/gi)].find(match => /\bvalue=["']ADD TO BASKET["']/i.test(match[1]) && /\bid=["'][^"']+_ButAddToCart["']/i.test(match[1]));
  const stock = clean(product.match(/<div\b[^>]*class=["']instock["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  if (!artist || !title || !sku || !vinyl(format) || !price || !(Number(price[1]) > 0) || stock.toLowerCase() !== 'in stock' || !buy || /\bdisabled\b/i.test(buy[1])) return [];
  return [{stableId:`plastic-head:${sku}`,sku,productId:sku,title:`${artist} - ${title} (${format})`,currentPrice:Number(price[1]),currency:'GBP',canonicalUrl:pageUrl,
    variantTitle:format,available:true,availability:'in_stock',physicalFormatConfirmed:true,recordFormat:'vinyl',
    identity:{artist,title,identityStatus:'resolved',identitySource:'retailer_product_heading',retailEditionText:`${title} ${format}`,physicalFormatConfirmed:true},sourceKinds:['plastic_head_purchase_controls']}];
}
