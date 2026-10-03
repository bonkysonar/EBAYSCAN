import { describe, it, expect, vi } from 'vitest';
import { assessEbayPurchaseDetail, ebayDetailReleaseIdentity, verifyEbayPurchaseCandidateDetails } from '../../scripts/lib/ebayPurchaseDiscovery.mjs';
import { retailEligibility, retailerArtistConflict } from '../../scripts/lib/retailIdentity.mjs';

describe('release identity before sold research', () => {
  it('recognizes multi-disc record types and ignores incidental packaging references', () => {
    for (const type of ['Double LP','Triple LP','10"']) {
      const detail={title:'Example Artist - Open Sky Vinyl',localizedAspects:[
        {name:'Type',value:type},{name:'Format',value:'Vinyl'},{name:'Artist',value:'Example Artist'},
        {name:'Release Title',value:'Open Sky'},{name:'Record Size',value:'12 inch'},
      ],description:'Sealed with hype sticker. I package in a proper record mailer. Grading guide: sticker residue. Fragile stickers on packaging.'};
      expect(assessEbayPurchaseDetail(detail).status).toBe('verified');
      expect(assessEbayPurchaseDetail({...detail,title:'Vinyl record mailer shipping boxes'}).status).toBe('rejected');
      expect(ebayDetailReleaseIdentity({...detail,localizedAspects:detail.localizedAspects.map(a=>a.name==='Release Title'?{...a,value:'SEE HEADING'}:a)})).toEqual({});
    }
  });
  it('uses structured release aspects instead of a promotional listing suffix', async () => {
    const detail = { localizedAspects: [
      {name:'Artist',value:'Furry Phreaks'}, {name:'Release Title',value:'Want Me Like Water Remixes'},
      {name:'Type',value:'Single'}, {name:'Format',value:'Vinyl'}, {name:'Record Size',value:'12 inch'},
    ]};
    const result = await verifyEbayPurchaseCandidateDetails([{id:'one',ebayItemId:'v1|123|0',artist:'Want Me Like Water',title:'NEW SEALED'}], {
      maxDetailRequests:1, requestOptions:{endpointRoot:'https://api.ebay.com',marketplaceId:'EBAY_US'}, token:'mock', requestTimeoutMs:1000,
      fetchImpl:vi.fn(async()=>new Response(JSON.stringify(detail),{status:200})),
    });
    expect(result.candidates[0]).toMatchObject({artist:'Furry Phreaks',title:'Want Me Like Water Remixes',identitySource:'ebay_detail_aspects'});
    expect(ebayDetailReleaseIdentity({localizedAspects:[...detail.localizedAspects,{name:'Artist',value:'Other Artist'}]})).toEqual({});
    expect(ebayDetailReleaseIdentity(detail, 'Okay Kaya - Sap Exclusive Vinyl')).toMatchObject({artist:'Unknown Artist',title:'Okay Kaya - Sap Exclusive Vinyl',identityStatus:'unresolved',identitySource:'ebay_detail_conflict'});
  });
  it('does not admit label production names or explicitly damaged stock', () => {
    expect(retailerArtistConflict('YOUNGProduction','Young Recordings')).toBe(true);
    for (const suffix of ['Minor Slv Dmg','Mnr Slv Dmg','Sealed/Pkg Flaw','BENT COVER EDGE','/ BUMP / FREE USA SHIP'])
      expect(retailEligibility({sourceListingTitle:`Artist - Album LP ${suffix}`})).toEqual({eligible:false,reason:'damaged_stock'});
    expect(retailEligibility({sourceListingTitle:'Black Flag - Damaged LP'}).eligible).toBe(true);
  });
});
