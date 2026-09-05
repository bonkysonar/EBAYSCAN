import { describe, expect, it } from "vitest";
import { curateResearchForFind, parseProductResearchRow, productResearchRowMatchScore, researchVariants } from "../../scripts/lib/productResearchCuration.mjs";
import { mergeResearchSoldEvidence, verifiedWindowSales } from "../../scripts/lib/soldResearchWindow.mjs";

const now = new Date("2026-09-05T01:00:00Z");
const find = {id:"find-test",artist:"Example Artist",title:"An Actual Album",sourceListingTitle:"Example Artist - An Actual Album LP",purchasePrice:10};
const row = {title:"Example Artist - An Actual Album [New Vinyl LP]",avgSoldPrice:25,avgShipping:5,totalSold:9,dateLastSold:"2026-08-25",itemUrl:"https://www.ebay.com/itm/123456789012"};
const run = {query:"Example Artist An Actual Album",url:"https://www.ebay.com/sh/research?categoryId=176985&conditionId=1000&tabName=SOLD",periodDays:90,capturedAt:"2026-09-05T00:00:00Z",observedWindow:{startDate:"2026-06-06",endDate:"2026-09-04"},condition:"New",category:"Vinyl Records",complete:true,rows:[row]};

describe("observed sold research windows", () => {
  it("uses the album title instead of the longer retail listing for research", () => {
    expect(researchVariants({artist:"Thrice",title:"Identity Crisis (25th Anniversary Edition)",sourceListingTitle:"Thrice - Identity Crisis (25th Anniversary Edition) LP - Ghostly Blue",purchasePrice:9.99})).toEqual(["Thrice Identity Crisis"]);
  });
  it("does not reuse a different album's research for a self-titled release", () => {
    const selfTitled = {id:"elton-self",artist:"Elton John",title:"Elton John",sourceListingTitle:"Elton John Elton John 1LP",purchasePrice:14};
    const result = curateResearchForFind(selfTitled,{entries:[{findId:"madman",title:"Madman Across The Water",runs:[{...run,query:"Elton John Madman Across The Water",rows:[{...row,title:"Elton John Madman Across The Water New Vinyl LP"}]}]}]},now);
    expect(result).toMatchObject({status:"pending",rows:[]});
  });
  it("does not add paid-only shipping averages to every sale when most shipped free", () => {
    const result = parseProductResearchRow({cells:["Example Artist An Actual Album","Edit","$24.63","$15.49\n88% Free shipping","8","$197.05","-","Aug 30, 2026"]});
    expect(result).toMatchObject({avgPaidShipping:15.49,freeShippingPercent:88,avgShipping:1.86});
    expect(parseProductResearchRow(result)).toMatchObject({avgShipping:1.86});
  });
  it("credits a complete verified 90-day quantity without inventing other windows", () => {
    const result = curateResearchForFind(find,{entries:[{findId:find.id,runs:[run]}]},now);
    expect(result).toMatchObject({status:"validated",velocityStatus:"verified_window_totals",sales90Days:9,sales30Days:null,sales365Days:null});
    expect(mergeResearchSoldEvidence(null,result,now.toISOString())).toMatchObject({unitsSold90Days:9,unitsSold30Days:null,unitsSold365Days:null,unitsSold1095Days:null,transactionCount:null,velocityEvidence:"verified_window_totals"});
  });
  it("retains individual 90-day observations even without annual coverage", () => {
    const result = curateResearchForFind(find,{entries:[{findId:find.id,runs:[{...run,observedWindow:undefined,rows:[{...row,totalSold:1}]}]}]},now);
    expect(mergeResearchSoldEvidence(null,result,now.toISOString())).toMatchObject({unitsSold90Days:1,unitsSold365Days:null,velocityEvidence:"dated_transactions"});
  });
  it("withholds dated velocity when an alleged sold listing is not an eBay item", () => {
    const result = curateResearchForFind(find,{entries:[{findId:find.id,runs:[{...run,observedWindow:undefined,rows:[{...row,totalSold:1,itemUrl:"https://example.com/itm/123456789012"}]}]}]},now);
    expect(result).toMatchObject({sales90Days:null,velocityStatus:"unknown_from_aggregate_rows"});
  });
  it.each([
    {observedWindow:undefined}, {complete:false}, {condition:"Used"}, {category:"Music"},
    {observedWindow:{startDate:"2023-09-05",endDate:"2026-09-04"}},
    {capturedAt:"2026-09-08T00:00:00Z"},
    {rows:[row,row]}, {url:"https://example.com/sh/research?categoryId=176985&conditionId=1000&tabName=SOLD"},
  ])("withholds window velocity for incomplete or unverifiable capture %j", (change) => {
    expect(verifiedWindowSales([row],{...run,...change},now)).toBeNull();
  });
  it("rejects quantities whose latest sale is outside the observed interval", () => {
    expect(verifiedWindowSales([{...row,dateLastSold:"2026-05-01"}],run,now)).toBeNull();
  });
  it.each([{complete:false},{condition:"Used"},{capturedAt:"2026-08-01T00:00:00Z"},{url:"https://example.com/sh/research"}])("cannot rescue an invalid window through individual-row fallback %j", (change) => {
    const result = curateResearchForFind(find,{entries:[{findId:find.id,runs:[{...run,...change,rows:[{...row,totalSold:1}]}]}]},now);
    expect(result.sales90Days).toBeNull();
  });
  it("does not transfer rare or incompatible pressing prices onto a standard reissue", () => {
    const ordinary={artist:"Sonny Clark",title:"Cool Struttin'",sourceListingTitle:"Sonny Clark Cool Struttin' Blue Note Classic Vinyl LP"};
    expect(productResearchRowMatchScore(ordinary,"Sonny Clark Cool Struttin' PROMO SEALED 1984 Japan RARE Blue Note")).toBe(0);
    expect(productResearchRowMatchScore(ordinary,"Sonny Clark Cool Struttin' 2 LP 45 RPM Music Matters Blue Note Limited")).toBe(0);
    expect(productResearchRowMatchScore(ordinary,"Sonny Clark Cool Struttin' Blue Note Classic Vinyl LP")).toBeGreaterThan(.88);
  });
  it("requires the observed color while keeping colors in album and artist names", () => {
    const colored = {artist:"Creedence Clearwater Revival",title:"Bayou Country",sourceListingTitle:"Creedence Clearwater Revival Bayou Country Tangerine LP"};
    expect(productResearchRowMatchScore(colored,"Creedence Clearwater Revival Bayou Country Orange LP")).toBe(0);
    expect(productResearchRowMatchScore(colored,"Creedence Clearwater Revival Bayou Country LP")).toBe(0);
    expect(productResearchRowMatchScore(colored,"Creedence Clearwater Revival Bayou Country Tangerine LP")).toBeGreaterThan(.85);
    expect(productResearchRowMatchScore({...colored,title:"Bayou Country (Tangerine LP)"},"Creedence Clearwater Revival Bayou Country LP")).toBe(0);
    const blue = {artist:"John Coltrane",title:"Blue Train",sourceListingTitle:"John Coltrane Blue Train Blue Note Essential LP"};
    expect(productResearchRowMatchScore(blue,"John Coltrane Blue Train New Vinyl LP")).toBeGreaterThan(.85);
    expect(productResearchRowMatchScore(blue,"John Coltrane Blue Train Classic Records Audiophile 180g LP")).toBe(0);
    expect(productResearchRowMatchScore(blue,'John Coltrane Blue Train (Vinyl) 12" Album Coloured Vinyl (Limited Edition)')).toBe(0);
    expect(productResearchRowMatchScore(find,"Example Artist An Actual Album [New Vinyl LP] Anni")).toBe(0);
    const splatter = {artist:"Cavetown",title:"Running With Scissors",sourceListingTitle:"Cavetown Running With Scissors LP Blue w/ Black Splatter"};
    expect(productResearchRowMatchScore(splatter,"Cavetown Running With Scissors LP Sky Blue")).toBe(0);
    expect(productResearchRowMatchScore(splatter,"Cavetown Running With Scissors LP Blue Black Splatter")).toBeGreaterThan(.85);
  });
});
