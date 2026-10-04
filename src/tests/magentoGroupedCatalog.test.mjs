import { describe, expect, it } from 'vitest';
import { discoverMagentoGroupedProducts, parseMagentoGroupedVinyl } from '../../scripts/lib/magentoGroupedCatalog.mjs';

const row = (title, price, stock) => `<tr><td>${title}</td><td><span class="price">$${price}</span></td><td>${stock}</td></tr>`;
const qty = '<input name="super_group[123]" value="0" title="Qty">';
const page = (rows) => `<h1>Example Artist - Example Album</h1><p>Availability: In stock</p><table id="super-product-table">${rows}</table>`;

describe('format-specific grouped retail offers', () => {
  it('rejects a sold-out LP even when the cheaper CD and digital versions are in stock', () => {
    const html = page(row('Example Album - LP', '15.99', 'Out of stock') + row('Example Album - CD', '9.99', qty) + row('Example Album - DIGITAL', '9.99', qty));
    expect(parseMagentoGroupedVinyl(html, 'https://store.example/album.html', 'USD')).toMatchObject({ supported: true, items: [], vinylRows: 1, unavailableRows: 1 });
  });
  it('uses the buyable LP row price and ignores the parent minimum', () => {
    const html = page(row('Example Album - LP', '25.99', qty) + row('Example Album - CD', '9.99', qty));
    expect(parseMagentoGroupedVinyl(html, 'https://store.example/album.html', 'USD').items).toEqual([expect.objectContaining({currentPrice:25.99, available:true, physicalFormatConfirmed:true, productId:'123', title:'Example Artist - Example Album (Vinyl)'})]);
    expect(parseMagentoGroupedVinyl(html, 'https://store.example/album.html').items).toEqual([]);
  });
  it('does not assume a generic catalog card or disabled quantity is a buyable vinyl variant', () => {
    expect(parseMagentoGroupedVinyl('<h1>Album Vinyl</h1>$9.99', 'https://store.example/', 'USD').supported).toBe(false);
    expect(parseMagentoGroupedVinyl(page(row('Album LP', '25.99', qty.replace('value=', 'disabled value='))), 'https://store.example/', 'USD').items).toEqual([]);
  });
  it('only follows observed same-store product-name anchors', () => {
    expect(discoverMagentoGroupedProducts('<a href="/unobserved.html">Navigation</a><h2 class="product-name"><a href="/album.html">Album</a></h2><h2 class="product-name"><a href="https://other.example/album.html">Other</a></h2>', 'https://store.example/music/vinyl.html')).toEqual(['https://store.example/album.html']);
  });
});
