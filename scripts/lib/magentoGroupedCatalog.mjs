import { decodeHtmlEntities } from "./retailListingParsing.mjs";

const text = (value) => decodeHtmlEntities(String(value ?? "").replace(/<[^>]*>/g, " "))
  .replace(/\s+/g, " ").trim();

/** Public Magento grouped-product rows. Parent prices and parent stock are never variant evidence. */
export function parseMagentoGroupedVinyl(html, pageUrl, currency = null) {
  const table = String(html).match(/<table\b[^>]*\bid=["']super-product-table["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) return { supported: false, items: [], vinylRows: 0, unavailableRows: 0 };
  const heading = text(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const items = [];
  let vinylRows = 0;
  let unavailableRows = 0;
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 3) continue;
    const title = text(cells[0]);
    if (!/\b(?:vinyl|(?:\d+\s*)?LP)\b|\b(?:7|10|12)\s*["″]/i.test(title)) continue;
    if (/\b(?:CD|DVD|cassette)\b/i.test(title)) continue;
    vinylRows += 1;
    const input = [...cells[2].matchAll(/<input\b[^>]*>/gi)]
      .map((row) => row[0]).find((row) => /\bname=["']super_group\[\d+\]["']/i.test(row));
    if (!input || /\bdisabled\b/i.test(input) || /out.of.stock|unavailable|sold.out/i.test(text(cells[2]))) {
      unavailableRows += 1;
      continue;
    }
    const productId = input.match(/super_group\[(\d+)\]/i)?.[1];
    const priceBlock = cells[1].match(/<p\b[^>]*class=["'][^"']*special-price[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? cells[1];
    const prices = [...priceBlock.matchAll(/<span\b[^>]*class=["']price["'][^>]*>\s*\$([\d,]+\.\d{2})\s*<\/span>/gi)]
      .map((row) => Number(row[1].replace(/,/g, "")));
    // Ambiguous row prices require review; never pick the cheapest format or option.
    const uniquePrices = [...new Set(prices)];
    if (uniquePrices.length !== 1 || !currency) continue;
    items.push({
      stableId: `magento:${productId}`, productId, sku: productId,
      title: heading ? `${heading} (Vinyl)` : title,
      variantTitle: title, canonicalUrl: pageUrl, currentPrice: uniquePrices[0],
      currency, available: true, availability: "in_stock",
      physicalFormatConfirmed: true, recordFormat: "vinyl",
      sourceKinds: ["magento_grouped_vinyl_row"],
    });
  }
  return { supported: true, items, vinylRows, unavailableRows };
}

/** Links must come from observed catalog product-name anchors on the configured store. */
export function discoverMagentoGroupedProducts(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const urls = [];
  for (const match of String(html).matchAll(/<h[23]\b[^>]*class=["'][^"']*\bproduct-name\b[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const href = match[1].match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const url = new URL(decodeHtmlEntities(href), pageUrl);
      if (url.origin === origin && url.pathname.endsWith(".html")) urls.push(url.href);
    } catch { /* Ignore malformed public links. */ }
  }
  return [...new Set(urls)];
}
