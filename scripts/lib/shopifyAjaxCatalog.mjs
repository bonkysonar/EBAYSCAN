/** Documented, read-only Shopify Ajax discovery and per-variant price/stock checks.
 * Predictive results are discovery only: their minimum price can belong to a CD.
 * https://shopify.dev/docs/api/ajax/reference/predictive-search
 * https://shopify.dev/docs/api/ajax/reference/product
 */
export async function readShopifyAjaxCatalog(source, fetchPage, { seedUrls = [], maxProducts = 60 } = {}) {
  const origin = new URL(source.url).origin;
  const reports = [], products = [], handles = new Set();
  const addHandle = value => {
    try {
      const url = new URL(value, origin);
      if (url.origin !== origin || url.username || url.password) return;
      const handle = url.pathname.match(/\/(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/)?.[1];
      if (handle && !/\.(?:js|json)$/.test(handle)) handles.add(handle);
    } catch { /* Invalid or unrelated links cannot become API requests. */ }
  };
  seedUrls.forEach(addHandle);
  const search = new URL('/search/suggest.json', origin);
  search.searchParams.set('q', 'vinyl');
  search.searchParams.set('resources[type]', 'product');
  search.searchParams.set('resources[limit]', '10');
  search.searchParams.set('resources[options][unavailable_products]', 'hide');
  let stopped = false, currency = null, supported = false;
  try {
    const result = await read(search.href, 'shopify-predictive-discovery');
    const suggestions = result.resources?.results?.products;
    if (!Array.isArray(suggestions)) {
      reports.at(-1).status = 'error';
      reports.at(-1).failureKind = 'invalid_response';
      reports.at(-1).error = 'Not a Shopify predictive product response';
      throw new Error('Not a Shopify predictive product response');
    }
    supported = true;
    suggestions.forEach(product => addHandle(product.url));
  } catch (error) { stopped = accessFailure(error); }
  if (!stopped && (supported || handles.size)) {
    try {
      const cart = await read(new URL('/cart.js', origin).href, 'shopify-currency');
      if (/^[A-Z]{3}$/.test(cart.currency ?? '')) currency = cart.currency;
    } catch (error) { stopped = accessFailure(error); }
  }
  const checked = new Set();
  await checkHandles();
  // Predictive search exposes at most ten products. Supplement those observed
  // handles with links from the configured catalog, while keeping every price
  // and stock decision on the documented per-product API.
  if (supported && !stopped) {
    try {
      const page = await fetchPage(source.url);
      const resolved = new URL(page.url);
      if (resolved.origin !== origin) throw new Error('Catalog discovery redirected to a different origin');
      for (const anchor of String(page.html).matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
        addHandle(anchor[1].replace(/&amp;/g, '&'));
      }
    } catch (error) {
      stopped = accessFailure(error);
      reports.push({ purpose: 'shopify-catalog-product-links', requestedUrl: source.url,
        role: 'catalog', status: 'error', error: String(error.message), failureKind: error.failureKind ?? 'invalid_response' });
    }
    await checkHandles();
  }
  return { products, currency, pageReports: reports, supported, stopped,
    discoveryScope: 'bounded_predictive_and_observed_products', discoveredProductCount: handles.size,
    checkedProductCount: products.length, omittedProductCount: Math.max(0, handles.size - products.length) };

  async function checkHandles() {
  for (const handle of [...handles].slice(0, maxProducts)) {
    if (stopped) break;
    if (checked.has(handle)) continue;
    checked.add(handle);
    try {
      const product = await read(new URL(`/products/${handle}.js`, origin).href, 'shopify-ajax-product');
      if (product.handle !== decodeURIComponent(handle) || !Array.isArray(product.variants) || !product.title) {
        reports.at(-1).status = 'error';
        reports.at(-1).error = 'Product handle or variant identity mismatch';
        reports.at(-1).failureKind = 'identity_mismatch';
        continue;
      }
      products.push({ ...product, body_html: product.description ?? '', product_type: product.type ?? '', currency,
        variants: product.variants.filter(variant => variant.available === true && variant.requires_shipping !== false)
          .map(variant => ({ ...variant,
            // Ajax prices are in currency subunits, unlike products.json prices.
            price: Number(variant.price) / 100,
            compare_at_price: variant.compare_at_price == null ? null : Number(variant.compare_at_price) / 100,
          })),
      });
    } catch (error) { stopped = accessFailure(error); }
  }
  }

  async function read(url, purpose) {
    try {
      const page = await fetchPage(url, { headers: { accept: 'application/json' } });
      const resolved = new URL(page.url), requested = new URL(origin);
      if (resolved.protocol !== requested.protocol || resolved.port !== requested.port || resolved.hostname.replace(/^www\./, '') !== requested.hostname.replace(/^www\./, '')) throw new Error('Shopify API redirected to a different origin');
      const data = JSON.parse(page.html);
      reports.push({ purpose, requestedUrl: url, resolvedUrl: page.url, role: purpose === 'shopify-currency' ? 'metadata' : 'catalog', status: 'available' });
      return data;
    } catch (error) {
      reports.push({ purpose, requestedUrl: url, role: purpose === 'shopify-currency' ? 'metadata' : 'catalog', status: 'error',
        error: String(error.message), failureKind: error.failureKind ?? 'invalid_response' });
      throw error;
    }
  }
}

function accessFailure(error) {
  return [403, 429].includes(error.status) || error.failureKind === 'blocked';
}
