import { describe, expect, it, vi } from 'vitest';
import { buyButtonIdentity, readBuyButtonVinylProduct } from '../../scripts/lib/shopifyBuyButtonCatalog.mjs';
const html = `ShopifyBuy.buildClient({ domain: 'example.myshopify.com', storefrontAccessToken: 'public-test-token' }); ui.createComponent('product', { id: '123' });`;
const variant = { id:'gid://shopify/ProductVariant/456', title:'Vinyl LP', availableForSale:true, currentlyNotInStock:false, requiresShipping:true, sku:'SKU', barcode:'123456789012', price:{amount:'18.0',currencyCode:'USD'} };
const product = { id:'gid://shopify/Product/123',title:'Example Artist - Open Sky',vendor:'Record Label',productType:'Vinyl',variants:{nodes:[variant],pageInfo:{hasNextPage:false}} };
const read = (value) => vi.fn(async()=>({html:JSON.stringify({data:{nodes:[value]}})}));

describe('public Buy Button product API', () => {
  it('keeps Barsuk pressing metadata separate from the album identity', () => {
    expect(buyButtonIdentity({...product,title:'PHANTOGRAM - Nightlife - LP purple wave vinyl [bark123lpc]'},variant,{id:'barsuk-records'})).toMatchObject({artist:'PHANTOGRAM',title:'Nightlife',retailEditionText:'LP purple wave vinyl'});
  });
  it('queries only embedded products and preserves exact vinyl price, currency and stock', async () => {
    const fetch = read(product);
    const result = await readBuyButtonVinylProduct(html,'https://label.example/shop/album',fetch);
    expect(fetch.mock.calls[0][0]).toBe('https://example.myshopify.com/api/2026-07/graphql.json');
    expect(JSON.parse(fetch.mock.calls[0][1].body).variables.ids).toEqual(['gid://shopify/Product/123']);
    expect(result.items[0]).toMatchObject({currentPrice:18,currency:'USD',available:true,physicalFormatConfirmed:true,buyButtonVariantId:variant.id,identity:{artist:'Example Artist',title:'Open Sky'}});
    expect(JSON.stringify(result)).not.toContain('public-test-token');
  });
  it('rejects unavailable, digital, non-vinyl and backorder variants', async () => {
    for (const changed of [{availableForSale:false},{requiresShipping:false},{currentlyNotInStock:true},{title:'CD'}]) {
      const result = await readBuyButtonVinylProduct(html,'https://label.example/shop/album',read({...product,variants:{nodes:[{...variant,...changed}]}}));
      expect(result.items).toEqual([]);
    }
  });
  it('does not follow an arbitrary token destination or accept unrequested products', async () => {
    const fetch = read(product);
    expect((await readBuyButtonVinylProduct(html.replace('example.myshopify.com','untrusted.example'),'https://label.example/shop/album',fetch)).supported).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect((await readBuyButtonVinylProduct(html,'https://label.example/shop/album',read({...product,id:'gid://shopify/Product/999'}))).items).toEqual([]);
  });
});
