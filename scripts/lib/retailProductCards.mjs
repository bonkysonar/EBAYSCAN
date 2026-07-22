const PRODUCT_PATH = /\/(?:music\/vinyl|p|product|products|release|releases)\//i;

export function extractRetailProductCards(html, pageUrl) {
  const source = String(html ?? "");
  const blocks = [
    ...source.matchAll(/<li\b[^>]*class=["'][^"']*\bproduct\b[^"']*["'][^>]*>[\s\S]{0,12000}?<\/li>/gi),
    ...source.matchAll(/<article\b[^>]*class=["'][^"']*\bcard\b[^"']*["'][^>]*>[\s\S]{0,12000}?<\/article>/gi),
    ...source.matchAll(/<a\b[^>]*href=["'][^"']*\/p\/[^"']+["'][^>]*>[\s\S]{0,6000}?<\/a>/gi),
  ].map((match) => match[0]);

  const byIdentity = new Map();
  for (const block of blocks) {
    const item = normalizeProductCard(block, pageUrl);
    if (!item) continue;
    const identity = item.productId ? `id:${item.productId}` : `url:${item.canonicalUrl.toLowerCase()}`;
    const current = byIdentity.get(identity);
    if (!current || productCardQuality(item) > productCardQuality(current)) {
      byIdentity.set(identity, current ? mergeProductCards(current, item) : item);
    } else {
      byIdentity.set(identity, mergeProductCards(current, item));
    }
  }
  return [...byIdentity.values()];
}

function normalizeProductCard(block, pageUrl) {
  const openingTag = block.match(/^<[^>]+>/)?.[0] ?? "";
  const anchors = [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const productAnchor =
    anchors.find((anchor) => {
      const href = attribute(anchor[1], "href");
      return PRODUCT_PATH.test(safePathname(href, pageUrl));
    }) ?? null;
  if (!productAnchor) return null;

  const canonicalUrl = normalizeHttpUrl(attribute(productAnchor[1], "href"), pageUrl);
  if (!canonicalUrl || !PRODUCT_PATH.test(new URL(canonicalUrl).pathname)) return null;
  const explicitOutOfStock = /\b(?:discontinued|out\s+of\s+stock|sold\s+out|unavailable)\b/i.test(
    cleanText(stripTags(block)),
  );

  const productId = cleanIdentifier(
    attribute(openingTag, "data-product-id") ||
      attribute(openingTag, "data-entity-id") ||
      attribute(openingTag, "data-id") ||
      attribute(productAnchor[1], "data-product-id") ||
      new URL(canonicalUrl).pathname.match(/\/p\/(\d+)(?:\/|$)/i)?.[1],
  );
  const title = productCardTitle(block, openingTag, productAnchor);
  if (!title) return null;

  const prices = productCardPrices(block, openingTag, productAnchor[1]);
  if (prices.currentPrice === null || prices.currentPrice < 2 || prices.currentPrice > 250) return null;

  return {
    available: explicitOutOfStock ? false : null,
    availability: explicitOutOfStock ? "out_of_stock" : "unknown",
    canonicalUrl,
    currency: currencyFromText(block),
    currentPrice: prices.currentPrice,
    imageUrl: productCardImage(block, pageUrl),
    productId,
    regularPrice: prices.regularPrice,
    sourceKinds: ["html_product_card"],
    stableId: productId ? `product:${productId.toLowerCase()}` : `url:${canonicalUrl.toLowerCase()}`,
    title,
  };
}

function productCardTitle(block, openingTag, productAnchor) {
  const namedTitle =
    cleanText(attribute(openingTag, "data-name")) ||
    cleanText(attribute(productAnchor[1], "title")) ||
    cleanText(attribute(productAnchor[1], "aria-label"));
  const artist = classText(block, "product-title");
  const release = classText(block, "product-artist");
  const format = classText(block, "see-more-format");
  const cardTitle = classText(block, "card-title");
  const imageAlt = cleanText(block.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1]);
  let title =
    namedTitle ||
    (artist && release
      ? `${artist} - ${release}`
      : cardTitle || imageAlt || cleanText(stripTags(productAnchor[2])));
  title = title
    .replace(/\s*,?\s*\$\s*[0-9][0-9,.]*\s*$/i, "")
    .replace(/^(.{2,100}?)\/([^/].+)$/, "$1 - $2")
    .replace(/\s*@\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  if (format && !title.toLowerCase().includes(format.toLowerCase())) {
    title = `${title} (${format})`;
  }
  return title.length >= 3 && title.length <= 300 ? title : null;
}

function productCardPrices(block, openingTag, anchorAttributes) {
  const salePrices = [
    ...classPrices(block, "sale-price"),
    ...attributePrices(openingTag, "data-product-price"),
    ...attributePrices(anchorAttributes, "data-product-price"),
    ...itempropPrices(block),
  ];
  const visiblePrices = [
    ...classPrices(block, "price"),
    ...moneyValues(cleanText(stripTags(block))),
  ];
  const originalPrices = [
    ...classPrices(block, "normal-price"),
    ...classPrices(block, "price--rrp"),
    ...classPrices(block, "price--non-sale"),
    ...classPrices(block, "price-was"),
  ];
  const currentPool = [...salePrices, ...visiblePrices].filter(validPrice);
  const currentPrice = currentPool.length ? Math.min(...currentPool) : null;
  const regularPool = [...originalPrices, ...visiblePrices].filter(
    (price) => validPrice(price) && (currentPrice === null || price > currentPrice),
  );
  return {
    currentPrice,
    regularPrice: regularPool.length ? Math.max(...regularPool) : null,
  };
}

function classPrices(block, className) {
  const pattern = new RegExp(
    `<[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>([\\s\\S]{0,300}?)<\\/[^>]+>`,
    "gi",
  );
  return [...block.matchAll(pattern)].flatMap((match) => moneyValues(cleanText(stripTags(match[1]))));
}

function attributePrices(attributes, name) {
  const value = attribute(attributes, name);
  const price = Number(String(value).replace(/[$,\s]/g, ""));
  return validPrice(price) ? [price] : [];
}

function itempropPrices(block) {
  return [...block.matchAll(/<[^>]*itemprop=["']price["'][^>]*>([\s\S]{0,80}?)<\//gi)]
    .map((match) => Number(cleanText(stripTags(match[1])).replace(/[$,\s]/g, "")))
    .filter(validPrice);
}

function moneyValues(value) {
  return [...String(value ?? "").matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter(validPrice);
}

function productCardImage(block, pageUrl) {
  const image = block.match(
    /<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i,
  )?.[1];
  return normalizeHttpUrl(image?.startsWith("//") ? `https:${image}` : image, pageUrl);
}

function classText(block, className) {
  const match = block.match(
    new RegExp(
      `<[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>([\\s\\S]{0,600}?)<\\/[^>]+>`,
      "i",
    ),
  );
  return cleanText(stripTags(match?.[1]));
}

function mergeProductCards(left, right) {
  const currentPrice = Math.min(left.currentPrice, right.currentPrice);
  const regularPrices = [left.regularPrice, right.regularPrice].filter(
    (price) => validPrice(price) && price > currentPrice,
  );
  return {
    ...left,
    ...right,
    available: left.available === false && right.available === false ? false : left.available ?? right.available,
    canonicalUrl: left.canonicalUrl ?? right.canonicalUrl,
    currentPrice,
    imageUrl: left.imageUrl ?? right.imageUrl,
    productId: left.productId ?? right.productId,
    regularPrice: regularPrices.length ? Math.max(...regularPrices) : null,
    title: right.title.length > left.title.length ? right.title : left.title,
  };
}

function productCardQuality(item) {
  return (
    (item.productId ? 10 : 0) +
    (item.regularPrice ? 5 : 0) +
    (item.imageUrl ? 2 : 0) +
    Math.min(10, item.title.length / 30)
  );
}

function currencyFromText(value) {
  return /\$/.test(String(value ?? "")) ? "USD" : null;
}

function normalizeHttpUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const parsed = new URL(decodeHtml(value), baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function safePathname(value, baseUrl) {
  try {
    return new URL(decodeHtml(value), baseUrl).pathname;
  } catch {
    return "";
  }
}

function attribute(attributes, name) {
  const match = String(attributes ?? "").match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function stripTags(value) {
  return decodeHtml(
    String(value ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function cleanIdentifier(value) {
  const cleaned = cleanText(value);
  return cleaned && cleaned.length <= 160 ? cleaned : null;
}

function cleanText(value) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function validPrice(value) {
  return Number.isFinite(value) && value >= 2 && value <= 250;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
