import { describe, expect, it } from 'vitest';
import { parseDominoVinyl } from '../../scripts/lib/dominoCatalog.mjs';
const url='https://m.dominomusic.com/releases/example/open-sky/lp';
const release={id:1,artist:'Example',title:'Open Sky',sku:'SKU1',format:'LP',status:{available:true,main:'Buy'},ga_data:{currency:'USD',value:30}};
const offer={sku:'SKU1',description:'LP',price:'30',priceCurrency:'USD',availability:'https://schema.org/InStock',url};
const html=(r=release,offers=[offer])=>`<script type="application/ld+json">${JSON.stringify({'@graph':[{'@type':'Product',brand:'Example',name:'Open Sky',offers}]})}</script><script>data: ${JSON.stringify({releases:[r]})}, selected:1</script>`;
describe('Domino purchase controls and structured offers',()=>{
  it('joins exact format, price, currency and availability',()=>{
    const items=parseDominoVinyl(html(release,[offer,{...offer,price:'9',description:'Download'}, {...offer,price:'25',priceCurrency:'GBP'}]),url);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({currentPrice:30,currency:'USD',sku:'SKU1',identity:{artist:'Example',title:'Open Sky'}});
  });
  it('rejects preorder, unavailable, ambiguous and mismatched-price evidence',()=>{
    expect(parseDominoVinyl(html({...release,status:{available:true,main:'Preorder'}}),url)).toEqual([]);
    expect(parseDominoVinyl(html({...release,status:{available:false,main:'Buy'}}),url)).toEqual([]);
    expect(parseDominoVinyl(html(release,[offer,offer]),url)).toEqual([]);
    expect(parseDominoVinyl(html(release,[{...offer,price:'20'}]),url)).toEqual([]);
  });
});
