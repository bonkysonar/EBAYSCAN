import {expect,it} from 'vitest';
import {parseThrillJockeyVinyl} from '../../scripts/lib/thrillJockeyCatalog.mjs';
it('takes the available LP row rather than the cheaper CD or future preorder',()=>{
  const row=(id,format,price,disabled='')=>`<div id="variant-${id}"><span class="font-bold">${format}</span> / <span>$${price}</span><form><button id="add-to-cart-button" ${disabled}>Add to Cart</button></form></div>`;
  const html='<h2><a href="/artists/example">Example Artist</a></h2><h1>Open Sky</h1>'+row(1,'CD','11.00')+row(2,'LP','22.00')+row(3,'LP (preorder)','21.00')+row(4,'Color LP','23.00','disabled');
  expect(parseThrillJockeyVinyl(html,'https://www.thrilljockey.com/products/open-sky')).toEqual([expect.objectContaining({productId:'2',currentPrice:22,title:'Example Artist - Open Sky (LP)',available:true})]);
});
