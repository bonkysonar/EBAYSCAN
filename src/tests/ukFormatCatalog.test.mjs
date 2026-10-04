import { describe, expect, it } from 'vitest';
import { discoverHonestJonsProducts, discoverResidentProducts, discoverZavviProducts, discoverPlasticHeadProducts, parseHonestJonsVinyl, parseResidentVinyl, parseZavviVinyl, parsePlasticHeadVinyl } from '../../scripts/lib/ukFormatCatalog.mjs';

const honestUrl = 'https://honestjons.com/shop/artist/Example/release/Album';
const honestForm = body => `<form action="https://honestjons.com/cart/add_cart_item/shop">${body}</form>`;
const button = (id, label, attrs = '') => `<button name="add[${id}]" title="Add to basket" ${attrs}>${label}</button>`;
const astro = value => Array.isArray(value) ? [1,value.map(astro)] : value && typeof value === 'object' ? [0,Object.fromEntries(Object.entries(value).map(([k,v])=>[k,astro(v)]))] : [0,value];
const residentUrl = 'https://www.resident-music.com/product/example-album';
const variant = {id:'101',title:'LP',price:{amount:'12.99',currencyCode:'GBP'},compareAtPrice:{amount:'24.99',currencyCode:'GBP'},availableForSale:true,currentlyNotInStock:false,listOnWebsite:{canList:true,canBuy:true,isPreorder:false}};
const residentPage = (variants, handle = 'example-album') => `<h2 class="artist"><a>Example Artist</a></h2><h1 class="title">Album</h1><astro-island component-export="VariantAccordion" props="${JSON.stringify(astro({productHandle:handle,productId:'1',variants})[1]).replace(/"/g,'&quot;')}"></astro-island>`;
const zavviUrl = 'https://www.zavvi.com/p/merch-vinyl/example-album/123456/';
const zavviPage = (product = {}) => `<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Example Artist - Album Vinyl',sku:'123456',offers:{'@type':'Offer',price:'15.99',priceCurrency:'GBP',availability:'https://schema.org/InStock'},...product})}</script>`;

describe('UK public format-specific offers', () => {
  it('keeps Honest Jon vinyl price separate from CD and commented or related album prices', () => {
    const html = `<h2>Example Artist</h2><h3>Album</h3><!--${honestForm(button(9,'LP £1.99'))}-->${honestForm(button(1,'CD £5.99') + button(2,'LP &pound;19.99') + button(3,'LP £9.99','disabled'))}<!-- end detail.php -->${honestForm(button(4,'LP £2.99'))}`;
    expect(parseHonestJonsVinyl(html,honestUrl)).toMatchObject([{stableId:'honest-jons:2',currentPrice:19.99,currency:'GBP',identity:{artist:'Example Artist',title:'Album'}}]);
  });
  it('rejects Honest Jon preorder, unrelated forms and absent enabled purchase controls', () => {
    for (const html of [honestForm(button(2,'LP preorder £19.99')), '<form action="https://other.example/cart">'+button(2,'LP £19.99')+'</form>', '<p>LP £19.99</p>']) {
      expect(parseHonestJonsVinyl('<h2>Example</h2><h3>Album</h3>'+html,honestUrl)).toEqual([]);
    }
  });
  it('reads Resident stock and currency for each exact variant', () => {
    const items = parseResidentVinyl(residentPage([variant,{...variant,id:'102',title:'CD',price:{amount:'4.99',currencyCode:'GBP'}}]),residentUrl);
    expect(items).toMatchObject([{stableId:'resident:101',currentPrice:12.99,regularPrice:24.99,currency:'GBP',identity:{artist:'Example Artist',title:'Album'}}]);
  });
  it('rejects Resident backorders, preorders, unavailable and unverified stock', () => {
    for (const changes of [{currentlyNotInStock:true},{currentlyNotInStock:null},{availableForSale:false},{listOnWebsite:{canBuy:true,canList:true,isPreorder:true}},{listOnWebsite:{canBuy:false,canList:true,isPreorder:false}}]) {
      expect(parseResidentVinyl(residentPage([{...variant,...changes}]),residentUrl)).toEqual([]);
    }
    expect(parseResidentVinyl(residentPage([variant],'different-album'),residentUrl)).toEqual([]);
    expect(parseResidentVinyl(residentPage([variant]).replace('[0,&quot;101&quot;]','[7,&quot;101&quot;]'),residentUrl)).toEqual([]);
  });
  it('requires Zavvi exact SKU, vinyl and in-stock structured offer', () => {
    expect(parseZavviVinyl(zavviPage(),zavviUrl)).toMatchObject([{stableId:'zavvi:123456',currentPrice:15.99,currency:'GBP',canonicalUrl:zavviUrl,physicalFormatConfirmed:true}]);
    for (const changes of [{sku:'987654'},{name:'Example Artist - Album CD'},{name:'Vinyl Storage Box'},{offers:{price:'5.99',priceCurrency:'GBP',availability:'https://schema.org/OutOfStock'}}]) expect(parseZavviVinyl(zavviPage(changes),zavviUrl)).toEqual([]);
  });
  it('discovers only observed same-origin product links, ignoring comments and accessories', () => {
    expect(discoverHonestJonsProducts(`<a href="${honestUrl}">Album</a><!--<a href="/shop/artist/Other/release/Hidden">Old</a>--><a href="https://other.example/shop/artist/A/release/B">Other</a>`,honestUrl)).toEqual([honestUrl]);
    expect(discoverResidentProducts('<a href="/product/example-album?variant=1">Album</a><a href="/collection/bargains">Category</a>',residentUrl)).toEqual([residentUrl]);
    expect(discoverZavviProducts('<a href="/p/merch-vinyl/example-album/123456/">Album</a><a href="/p/merch/storage-box/222/">Box</a>',zavviUrl)).toEqual([zavviUrl]);
    expect(discoverPlasticHeadProducts('<a href="/artist-album-vinyl-lp-cat1">LP</a><a href="/artist-album-compact-disc-cat2">CD</a>', 'https://www.plastichead.com/music/vinyl/new')).toEqual(['https://www.plastichead.com/artist-album-vinyl-lp-cat1']);
  });
  it('requires Plastic Head enabled purchase button and explicit in-stock status on the main product', () => {
    const html = '<div class="product-page-title"><div><h1><a href="artist/example">Example Artist</a><br />Album (Red)</h1></div><div class="ptype">Vinyl LP</div><div class="price">£25.00</div></div><input id="product_ButAddToCart" value="ADD TO BASKET"/><div class="instock">In Stock</div><div>Item no. : <span>CAT1</span></div><div class="product-rows"><div class="price">£3.99</div></div>';
    expect(parsePlasticHeadVinyl(html,'https://www.plastichead.com/artist-album-vinyl-lp-cat1')).toMatchObject([{stableId:'plastic-head:CAT1',currentPrice:25,currency:'GBP',identity:{artist:'Example Artist',title:'Album (Red)'}}]);
    for (const changed of [html.replace('In Stock','Pre-order'),html.replace('In Stock','Available to order'),html.replace('id="product_ButAddToCart"','disabled id="product_ButAddToCart"'),html.replace('Vinyl LP','Compact Disc')]) expect(parsePlasticHeadVinyl(changed,'https://www.plastichead.com/artist-album-vinyl-lp-cat1')).toEqual([]);
  });
});
