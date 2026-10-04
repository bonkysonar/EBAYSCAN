import { describe, expect, it, vi } from 'vitest';
import { refreshEbayPurchaseOffers, verifiedEbayOffer } from '../../scripts/lib/ebayOfferVerification.mjs';
const oldTime = '2026-10-01T12:00:00.000Z', now = '2026-10-03T22:00:00.000Z';
const find = {id:'scan-stable-id',sourceId:'ebay-purchase',ebayItemId:'v1|123|0',artist:'Example Artist',title:'Open Sky',sourceListingTitle:'Example Artist - Open Sky Vinyl LP New',identityStatus:'resolved',purchasePrice:10,sourceShippingPrice:0,purchaseOfferVerification:'official_api',capturedAt:oldTime,soldEvidence:{status:'validated',units90:8},costs:{inboundShipping:4}};
const detail = {itemId:find.ebayItemId,title:find.sourceListingTitle,categoryId:'176985',conditionId:'1000',buyingOptions:['FIXED_PRICE'],price:{value:'18',currency:'USD'},shippingOptions:[{shippingCostType:'FIXED',shippingCost:{value:'3',currency:'USD'}}],itemLocation:{country:'US'},itemWebUrl:'https://www.ebay.com/itm/123',seller:{username:'example',feedbackScore:100,feedbackPercentage:'99'},estimatedAvailabilities:[{estimatedAvailabilityStatus:'IN_STOCK',estimatedRemainingQuantity:2}],localizedAspects:[{name:'Artist',value:'Example Artist'},{name:'Release Title',value:'Open Sky'},{name:'Type',value:'LP'},{name:'Format',value:'Vinyl'},{name:'Record Size',value:'12 inch'}]};
const options = {deliveryCountry:'US',deliveryPostalCode:'12345',now};
const env = {EBAY_BROWSE_ACCESS_TOKEN:'test-token',EBAY_DELIVERY_POSTAL_CODE:'12345'};
const json = (payload,status = 200) => new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});

describe('final eBay acquisition refresh', () => {
  it('refreshes exact price plus shipping and availability while preserving sold evidence and candidate identity', () => {
    const updated = verifiedEbayOffer(find,detail,options);
    expect(updated).toMatchObject({id:find.id,artist:find.artist,title:find.title,purchasePrice:21,sourceItemPrice:18,sourceShippingPrice:3,purchasePriceIncludesShipping:true,capturedAt:now,quantityAvailable:2,purchaseOfferVerification:'official_api',costs:{inboundShipping:0},retailVerification:{status:'verified'}});
    expect(updated.soldEvidence).toBe(find.soldEvidence);
  });
  it('does not refresh old timestamps or retain approval after listing, identity, category, stock or shipping conflicts', () => {
    const changes = [{itemId:'v1|other|0'},{title:'Different Artist - Other Record LP New'},{categoryId:'123'},{estimatedAvailabilities:[]},{estimatedAvailabilities:[{estimatedAvailabilityStatus:'IN_STOCK',estimatedRemainingQuantity:0}]},{shippingOptions:[{shippingCostType:'CALCULATED',shippingCost:{value:'3',currency:'USD'}}]},{price:{value:'18',currency:'EUR'}},{localizedAspects:detail.localizedAspects.map(a=>a.name==='Artist'?{...a,value:'Wrong Artist'}:a)}];
    for (const change of changes) {
      const updated = verifiedEbayOffer(find,{...detail,...change},options);
      expect(updated.purchaseOfferVerification).toBe('discovery_lead');
      expect(updated.capturedAt).toBe(oldTime);
      expect(updated.purchasePrice).toBe(10);
    }
  });
  it('requires an actual configured shipping destination', () => {
    expect(verifiedEbayOffer(find,detail,{now,deliveryCountry:'US'}).retailVerification.reason).toBe('shipping_destination_unverified');
  });
  it('passes the configured destination to the official API and changes only eBay offers', async () => {
    const other = {...find,id:'other',sourceId:'shopify'};
    const fetchImpl = vi.fn(async (url,init) => {
      expect(String(url)).toBe('https://api.ebay.com/buy/browse/v1/item/v1%7C123%7C0');
      expect(init.headers['X-EBAY-C-ENDUSERCTX']).toBe('contextualLocation=country%3DUS%2Czip%3D12345');
      return json(detail);
    });
    const result = await refreshEbayPurchaseOffers([find,other],{env,fetchImpl,now});
    expect(result.progress).toEqual({planned:1,checked:1,verified:1,failed:0,deferred:0});
    expect(result.finds[1]).toBe(other);
  });
  it('invalidates every remaining old approval after an access/rate failure without retrying', async () => {
    const fetchImpl = vi.fn(async()=>json({},429));
    const result = await refreshEbayPurchaseOffers([find,{...find,id:'second',ebayItemId:'v1|456|0'}],{env,fetchImpl,now});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.progress).toEqual({planned:2,checked:1,verified:0,failed:1,deferred:1});
    expect(result.finds.every(f=>f.purchaseOfferVerification==='discovery_lead'&&f.capturedAt===oldTime)).toBe(true);
  });
  it('marks removed items unavailable and fails closed on missing authentication', async () => {
    const result = await refreshEbayPurchaseOffers([find],{env,fetchImpl:async()=>json({},404),now});
    expect(result.finds[0]).toMatchObject({available:false,purchaseOfferVerification:'discovery_lead',capturedAt:oldTime});
    const fetchImpl = vi.fn();
    const missing = await refreshEbayPurchaseOffers([find],{env:{},fetchImpl,now});
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(missing.progress.deferred).toBe(1);
    expect(missing.finds[0].purchaseOfferVerification).toBe('discovery_lead');
  });
});
