import { describe, expect, it } from "vitest";
import { createMarketplaceAlbumDemandIndex } from "../../scripts/lib/marketplaceAlbumDemand.mjs";
import { researchDemand } from "../../scripts/lib/albumDemand.mjs";

const now = "2026-09-05T01:00:00Z";
const candidate={artist:"Example Artist",title:"Actual Album (Red Vinyl)"};
const page={query:"Example Artist Actual Album",complete:true,capturedAt:now,url:"https://www.ebay.com/sh/research?keywords=Example+Artist+Actual+Album&categoryId=176985&conditionId=1000&tabName=SOLD",rows:[{title:"Example Artist Actual Album Black Vinyl New Sealed",avgSoldPrice:30,totalSold:5,dateLastSold:"2026-08-01",itemUrl:"https://www.ebay.com/itm/123456789012"}]};
const captures={captureMethod:"visible_browser",pages:[page]};
describe("saved marketplace album demand",()=>{
  it("keeps an observed album in future research without transferring another pressing's price or velocity",()=>{
    const albumDemand=createMarketplaceAlbumDemandIndex(captures,now).match(candidate);
    expect(albumDemand).toMatchObject({source:"ebay-product-research",unitsSold:5,unitsSold90Days:null,transactionCount:null});
    expect(albumDemand).not.toHaveProperty("averageSoldPrice");
    expect(researchDemand({...candidate,albumDemand})).toMatchObject({observed:true,source:"marketplace_sold",units:5,recentUnits:0});
  });
  it("does not count a similar but different album or repeated copies of the same captured listing",()=>{
    const index=createMarketplaceAlbumDemandIndex({...captures,pages:[{...page,rows:[...page.rows,...page.rows,{...page.rows[0],title:"Example Artist Actual Album II Vinyl",itemUrl:"https://www.ebay.com/itm/123456789013"}]}]},now);
    expect(index.match(candidate)?.unitsSold).toBe(5);
  });
  it("deduplicates the same eBay listing across slug and tracking URL variants",()=>{
    const rows=[page.rows[0], {...page.rows[0],itemUrl:"https://www.ebay.com/itm/123456789012?nordt=true"}, {...page.rows[0],itemUrl:"https://ebay.com/itm/Example-Artist-LP/123456789012?rt=nc"}];
    expect(createMarketplaceAlbumDemandIndex({...captures,pages:[{...page,rows}]},now).match(candidate)?.unitsSold).toBe(5);
  });
  it("rejects malformed or non-eBay listing URLs and dates after the captured results",()=>{
    for(const change of [
      {itemUrl:"https://example.com/itm/123456789012"},
      {itemUrl:"https://www.ebay.com.example.com/itm/123456789012"},
      {itemUrl:"https://www.ebay.com/sch/i.html"},
      {itemUrl:"https://www.ebay.com/itm/not-an-item"},
      {itemUrl:"http://www.ebay.com/itm/123456789012"},
      {itemUrl:"https://user:pass@www.ebay.com/itm/123456789012"},
      {itemUrl:"https://www.ebay.com:444/itm/123456789012"},
      {dateLastSold:"not a date"},
      {dateLastSold:"2026-09-06"},
    ]) expect(createMarketplaceAlbumDemandIndex({...captures,pages:[{...page,rows:[{...page.rows[0],...change}]}]},now).match(candidate)).toBeUndefined();
    expect(createMarketplaceAlbumDemandIndex({...captures,pages:[{...page,capturedAt:"2026-09-01T00:00:00Z",rows:[{...page.rows[0],dateLastSold:"2026-09-02"}]}]},now).match(candidate)).toBeUndefined();
  });
  it("does not promote old, incomplete, wrong-filter or failed browser observations",()=>{
    for(const change of [{complete:false},{capturedAt:"2026-08-01T00:00:00Z"},{rows:[]},{url:page.url.replace("1000","3000")}]) {
      expect(createMarketplaceAlbumDemandIndex({...captures,pages:[{...page,...change}]},now).match(candidate)).toBeUndefined();
    }
  });
});
