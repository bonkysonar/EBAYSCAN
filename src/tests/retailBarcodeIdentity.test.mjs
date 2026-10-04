import { describe, expect, it } from 'vitest';
import { normalizedGtin, reconciledShopifyIdentity, resolveRetailBarcodeIdentity } from '../../scripts/lib/retailBarcodeIdentity.mjs';
import { verifyRetailOffer } from '../../scripts/lib/retailOfferVerification.mjs';

const find = {id:'retail-1',artist:'Unknown Artist',title:'Example Artist Open Sky',identityStatus:'unresolved',physicalFormatConfirmed:true,sourceId:'example-label',sourceName:'Example Records',sourceDomain:'shop.example',sourceUrl:'https://shop.example/products/open-sky?variant=1',sourceListingTitle:'Example Artist Open Sky Vinyl',shopifyVariantId:1,shopifyVariantTitle:'Black LP',purchasePrice:10,sourceCurrency:'USD'};
const variant = {id:1,title:'Black LP',barcode:'848064019381',price:1000,available:true,requires_shipping:true};
const product = {handle:'open-sky',title:'Example Artist Open Sky Vinyl',vendor:'Example Records',tags:['Vinyl'],variants:[variant]};
const detail = {gtin:'0848064019381',title:'Example Artist Open Sky LP Vinyl New',localizedAspects:[{name:'Artist',value:'Example Artist'},{name:'Release Title',value:'Open Sky'},{name:'Type',value:'LP'},{name:'Format',value:'Vinyl'},{name:'Record Size',value:'12 inch'},{name:'UPC',value:'848064019381'}]};
const readers = (details = [detail], changedProduct = product) => ({readRetailJson:async()=>changedProduct,readEbayJson:async path=>path.includes('item_summary') ? {itemSummaries:details.map((_,i)=>({itemId:String(i)}))} : details[Number(path.split('/').at(-1))],now:'2026-10-03T22:00:00.000Z'});

describe('exact retailer variant barcode identity', () => {
  it('validates check digits and compares UPC/EAN leading-zero equivalents', () => {
    expect(normalizedGtin('848064019381')).toBe(normalizedGtin('0848064019381'));
    for (const invalid of ['848064019380','CAT848064019381','000000000000','84806401-9381']) expect(normalizedGtin(invalid)).toBeNull();
  });
  it('resolves artist/title from corroborated metadata without changing prices or adding sold evidence', async () => {
    const resolved = await resolveRetailBarcodeIdentity(find,readers());
    expect(resolved).toMatchObject({artist:'Example Artist',title:'Open Sky',identitySource:'retailer_barcode_ebay_aspects',purchasePrice:10,retailIdentityStatus:'resolved',barcode:variant.barcode,retailIdentityEvidence:{matchedDetailCount:1,variantId:'1'}});
    expect(resolved.averageSoldPrice).toBeUndefined();
    expect(resolved.retailIdentityEvidence.itemId).toBeUndefined();
    const withBoilerplate = await resolveRetailBarcodeIdentity(find,readers([{...detail,description:'Our grading refers to the outer sleeve only; stock photos may include stickers.'}]));
    expect(withBoilerplate.retailIdentityStatus).toBe('resolved');
    expect(withBoilerplate.purchaseOfferVerification).toBeUndefined();
  });
  it('rejects unrelated barcodes, contradictory titles and non-record metadata', async () => {
    for (const changed of [{...detail,gtin:'1234567890128',localizedAspects:detail.localizedAspects.filter(a=>a.name!=='UPC')},{...detail,title:'Different Artist Other Album Vinyl',localizedAspects:detail.localizedAspects.map(a=>a.name==='Artist'?{...a,value:'Different Artist'}:a.name==='Release Title'?{...a,value:'Other Album'}:a)},{...detail,localizedAspects:detail.localizedAspects.map(a=>a.name==='Type'?{...a,value:'Sticker'}:a)}]) {
      expect((await resolveRetailBarcodeIdentity(find,readers([changed]))).retailIdentityStatus).toBe('unknown');
    }
  });
  it('never borrows another variant barcode or supplies identity without a retailer GTIN', async () => {
    const missing = {...product,variants:[{...variant,barcode:null},{...variant,id:2}]};
    const invalid = {...product,variants:[{...variant,barcode:'SKU123'}]};
    for (const p of [missing,invalid,{...product,variants:[]},{...product,variants:[{...variant,available:false}]}]) expect((await resolveRetailBarcodeIdentity(find,readers([detail],p))).retailIdentityStatus).toBe('unknown');
    expect((await resolveRetailBarcodeIdentity({...find,sourceDomain:'other.example'},readers())).retailIdentityReason).toBe('unsupported_store_url');
    expect((await resolveRetailBarcodeIdentity(find,readers([detail],{...product,title:'Different Release Vinyl'}))).retailIdentityReason).toBe('retailer_title_changed');
  });
  it('preserves corroborated identity during price recheck only while exact variant, barcode and product title agree', async () => {
    const resolved = await resolveRetailBarcodeIdentity(find,readers());
    expect(reconciledShopifyIdentity(resolved,product,variant)).toMatchObject({artist:'Example Artist',title:'Open Sky',identityStatus:'resolved'});
    expect(reconciledShopifyIdentity(resolved,{...product,title:'Other Album Vinyl'},variant).identityStatus).toBe('unresolved');
    expect(reconciledShopifyIdentity(resolved,product,{...variant,barcode:'1234567890128'}).identityStatus).toBe('unresolved');
    const verified = await verifyRetailOffer(resolved,async url=>url.endsWith('cart.js')?{currency:'USD'}:product,'2026-10-03T22:01:00.000Z');
    expect(verified).toMatchObject({artist:'Example Artist',title:'Open Sky',retailVerification:{status:'verified'},purchasePrice:10});
  });
});
