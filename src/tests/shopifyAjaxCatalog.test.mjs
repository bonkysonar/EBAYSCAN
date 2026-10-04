import { describe, expect, it } from 'vitest';
import { readShopifyAjaxCatalog } from '../../scripts/lib/shopifyAjaxCatalog.mjs';
import { normalizeShopifyProducts } from '../../scripts/lib/shopifyCatalog.mjs';
import { assessRecordCandidate } from '../../scripts/lib/candidatePipeline.mjs';
const source = { id: 'shop', name: 'Shop', url: 'https://shop.example/collections/vinyl' };
const response = (url, data) => ({ url, html: JSON.stringify(data) });
const product = { handle: 'artist-album', title: 'Artist - Album', vendor: 'Artist', type: 'Music', variants: [
  { id: 1, title: 'CD', available: true, requires_shipping: true, price: 998 },
  { id: 2, title: 'Vinyl LP', available: true, requires_shipping: true, price: 2498, compare_at_price: 3298, barcode: '123456789012' },
  { id: 3, title: 'Vinyl LP Red', available: false, requires_shipping: true, price: 1500 },
] };
describe('documented Shopify discovery and verification', () => {
  it('uses individual variant prices, never a cheaper CD or stale predictive price', async () => {
    const read = async url => response(url, url.includes('suggest') ? { resources: { results: { products: [{ url: '/products/artist-album', price: '9.98' }] } } } : url.endsWith('/cart.js') ? { currency: 'USD' } : product);
    const result = await readShopifyAjaxCatalog(source, read);
    const items = normalizeShopifyProducts({ assessment: assessRecordCandidate, source, origin: 'https://shop.example', products: result.products, currency: result.currency });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ price: 24.98, compareAtPrice: 32.98, variantId: 2, currency: 'USD' });
    expect(result.discoveryScope).toBe('bounded_predictive_and_observed_products');
  });
  it('stops on a rate limit without making alternative requests to the same host', async () => {
    const urls = [];
    const result = await readShopifyAjaxCatalog(source, async url => { urls.push(url); throw Object.assign(new Error('HTTP 429'), { status: 429 }); }, { seedUrls: ['https://shop.example/products/artist-album'] });
    expect(urls).toHaveLength(1);
    expect(result).toMatchObject({ products: [], stopped: true });
  });
  it('rejects cross-origin and account links and checks only observed product handles', async () => {
    const urls = [];
    await readShopifyAjaxCatalog(source, async url => { urls.push(url); return response(url, url.includes('suggest') ? { resources: { results: { products: [] } } } : url.endsWith('/cart.js') ? { currency: 'USD' } : product); }, { seedUrls: ['https://evil.example/products/private', 'https://shop.example/account', 'https://shop.example/collections/sale/products/artist-album'] });
    expect(urls.some(url => url.includes('evil.example') || url.includes('/account'))).toBe(false);
    expect(urls.filter(url => url.includes('/products/'))).toEqual(['https://shop.example/products/artist-album.js']);
  });
  it('withholds mismatched product identities', async () => {
    const result = await readShopifyAjaxCatalog(source, async url => response(url, url.includes('suggest') ? { resources: { results: { products: [{ url: '/products/artist-album' }] } } } : url.endsWith('/cart.js') ? { currency: 'USD' } : { ...product, handle: 'different-record' }));
    expect(result.products).toEqual([]);
  });
  it('discovers catalog links beyond predictive results and reports bounded omissions', async () => {
    const urls = [];
    const result = await readShopifyAjaxCatalog(source, async url => {
      urls.push(url);
      if (url === source.url) return { url, html: '<a href="/products/second">Second</a><a href="/products/third">Third</a><a href="https://other.example/products/private">Other</a>' };
      if (url.includes('suggest')) return response(url, { resources: { results: { products: [{ url: '/products/artist-album' }] } } });
      if (url.endsWith('/cart.js')) return response(url, { currency: 'USD' });
      return response(url, { ...product, handle: new URL(url).pathname.split('/').at(-1).replace(/\.js$/, '') });
    }, { maxProducts: 2 });
    expect(result.products.map(p => p.handle)).toEqual(['artist-album', 'second']);
    expect(result).toMatchObject({ discoveredProductCount: 3, omittedProductCount: 1 });
    expect(urls.filter(url => url.endsWith('/products/artist-album.js'))).toHaveLength(1);
    expect(urls.some(url => url.includes('other.example'))).toBe(false);
  });
});
