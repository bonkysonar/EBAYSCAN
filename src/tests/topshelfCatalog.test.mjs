import { describe, expect, it } from 'vitest';
import { discoverTopshelfProducts, parseTopshelfVinyl } from '../../scripts/lib/topshelfCatalog.mjs';

describe('Topshelf format-specific purchase options', () => {
  it('keeps each available vinyl pressing separate from cheaper CDs and unavailable options', () => {
    const html = `<h2>Example Artist <i>Open Sky</i></h2><select id="cart_variation_id">
      <option value="10">Blossom Vinyl - $30.00</option><option value="11">Black Vinyl - $32.00</option>
      <option disabled="disabled">Green Vinyl - $29.00 (Out of Stock)</option><option value="12">CD - $15.00</option>
      <option value="13">Vinyl Preorder - $20.00</option></select>`;
    const items = parseTopshelfVinyl(html,'https://www.topshelfrecords.com/products/123-example');
    expect(items.map(item=>[item.productId,item.currentPrice,item.identity.retailEditionText])).toEqual([['10',30,'Blossom Vinyl'],['11',32,'Black Vinyl']]);
    expect(items[0].identity).toMatchObject({artist:'Example Artist',title:'Open Sky'});
    expect(parseTopshelfVinyl(html.replace('Open Sky','Random Vinyl LPs'),'https://www.topshelfrecords.com/products/123-example')).toEqual([]);
  });
  it('only follows observed same-store product links', () => {
    expect(discoverTopshelfProducts(`<a href="/products/123-example">Album</a><a href="/products/search?q=vinyl">Search</a><a href="https://other.example/products/123-example">Other</a>`, 'https://www.topshelfrecords.com/categories/vinyl')).toEqual(['https://www.topshelfrecords.com/products/123-example']);
  });
});
