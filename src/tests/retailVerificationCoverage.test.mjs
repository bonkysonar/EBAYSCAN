import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyRetailOffers } from '../../scripts/lib/retailOfferVerification.mjs';
afterEach(() => vi.useRealTimers());
const product = { title: 'Artist - Album Vinyl', handle: 'album', vendor: 'Artist', type: 'Vinyl', variants: [{ id: 1, title: 'Vinyl LP', available: true, requires_shipping: true, price: 2000 }] };
const offer = { id: 'one', artist: 'Artist', title: 'Album', sourceName: 'Store', sourceUrl: 'https://shop.example/products/album', shopifyVariantId: 1, purchasePrice: 20, sourceCurrency: 'USD', identityStatus: 'resolved' };
describe('retail verification completes its full cohort', () => {
  it('rechecks the same format without borrowing cheaper or unavailable variants', async () => {
    const find={...offer,shopifyVariantId:undefined,sourceId:'topshelf-records',sourceUrl:'https://www.topshelfrecords.com/products/123-example',artist:'Example Artist',title:'Open Sky',sku:'10',purchasePrice:25};
    const html=`<h2>Example Artist <i>Open Sky</i></h2><select id="cart_variation_id"><option value="10">Black Vinyl - $30.00</option><option value="11">CD - $10.00</option></select>`;
    const [verified]=await verifyRetailOffers([find],async()=>{}, {readPage:async()=>({html})});
    expect(verified).toMatchObject({purchasePrice:30,sourceCurrency:'USD',purchaseOfferVerification:'direct_retailer',retailEditionText:'Black Vinyl',retailVerification:{status:'verified'}});
    const [gone]=await verifyRetailOffers([find],async()=>{}, {readPage:async()=>({html:html.replace('value="10"','disabled="disabled"')})});
    expect(gone.purchaseOfferVerification).toBe('discovery_lead');
    const [redirect]=await verifyRetailOffers([find],async()=>{}, {readPage:async()=>({html,url:'https://other.example/product'})});
    expect(redirect.retailVerification.reason).toBe('Product redirected outside configured store');
  });
  it('does not reuse sold evidence when a Buy Button product is replaced in place', async () => {
    const find = {...offer, artist:'Example Artist', title:'Open Sky', shopifyVariantId:undefined, buyButtonProductId:'gid://shopify/Product/123', buyButtonVariantId:'gid://shopify/ProductVariant/456', barcode:'123456789012'};
    const variant = {id:find.buyButtonVariantId,title:'Vinyl LP',availableForSale:true,requiresShipping:true,price:{amount:'18',currencyCode:'USD'},barcode:find.barcode};
    const current = {id:find.buyButtonProductId,title:'Example Artist - Open Sky',productType:'Vinyl',variants:{nodes:[variant]}};
    const html = `ShopifyBuy.buildClient({domain:'example.myshopify.com', storefrontAccessToken:'public-test-token'}); ui.createComponent('product', {id:'123'});`;
    for (const [changed, reason] of [
      [{...current,title:'Other Artist - Another Album'},'record_identity_changed'],
      [{...current,variants:{nodes:[{...variant,barcode:'999999999999'}]}},'barcode_changed'],
    ]) {
      const [result] = await verifyRetailOffers([find], async()=>{}, {readPage:async url=>({html:url.includes('/graphql.json') ? JSON.stringify({data:{nodes:[changed]}}) : html})});
      expect(result).toMatchObject({artist:'Example Artist',title:'Open Sky',purchaseOfferVerification:'discovery_lead',retailVerification:{status:'failed',reason}});
    }
    const [noReader] = await verifyRetailOffers([find], async()=>{});
    expect(noReader.retailVerification.status).toBe('failed');
  });
  it('does not silently stop after three minutes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T19:00:00Z'));
    const results = await verifyRetailOffers([offer, { ...offer, id: 'two' }], async url => {
      vi.setSystemTime(Date.now() + 181000);
      return url.endsWith('/cart.js') ? { currency: 'USD' } : product;
    }, { concurrency: 1 });
    expect(results.every(row => row.retailVerification.status === 'verified')).toBe(true);
  });
  it('withholds buyable preorder variants when the retailer tags them preorder', async () => {
    const [result] = await verifyRetailOffers([offer], async url => url.endsWith('/cart.js') ? { currency: 'USD' } : { ...product, tags: ['preorder'] });
    expect(result.retailVerification).toMatchObject({ status: 'unavailable', reason: 'preorder' });
  });
  it('continues other hosts while stopping a host that refuses access', async () => {
    const reads = [];
    const results = await verifyRetailOffers([offer, { ...offer, id: 'same' }, { ...offer, id: 'other', sourceUrl: 'https://other.example/products/album' }], async url => {
      reads.push(url);
      if (url.includes('shop.example')) throw new Error('HTTP 429');
      return url.endsWith('/cart.js') ? { currency: 'USD' } : product;
    }, { concurrency: 1 });
    expect(reads.filter(url => url.includes('shop.example'))).toHaveLength(1);
    expect(results[2].retailVerification.status).toBe('verified');
  });
});
