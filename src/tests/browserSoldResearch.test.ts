import { describe, expect, it } from "vitest";
import { importBrowserSoldResearch } from "../../scripts/lib/browserSoldResearch.mjs";

const now=new Date("2026-09-05T01:00:00Z");
const candidate={id:"find-1",artist:"Example Artist",title:"Actual Album",sourceListingTitle:"Example Artist Actual Album LP",purchasePrice:10,physicalFormatConfirmed:true,identityStatus:"resolved",sourceId:"example",capturedAt:now.toISOString()};
const payload={runId:"scan-example",phase:"scan",researchCandidates:[candidate]};
const page={artist:candidate.artist,title:candidate.title,query:"Example Artist Actual Album",capturedAt:now.toISOString(),condition:"New",category:"Vinyl Records",complete:true,url:"https://www.ebay.com/sh/research?keywords=Example+Artist+Actual+Album&conditionId=1000&categoryId=176985&tabName=SOLD",rows:[]};
const captures={captureMethod:"visible_browser",pages:[page]};

describe("browser sold checkpoint import",()=>{
  it("associates a saved observation with the exact current artist/album and run",()=>{
    expect(importBrowserSoldResearch(payload,captures,{},now)).toMatchObject({runId:payload.runId,entries:[{findId:candidate.id,runs:[{query:page.query,status:"complete"}]}]});
  });
  it("can reuse the same search for multiple retailer editions while leaving pressing matching to curation",()=>{
    const result=importBrowserSoldResearch({...payload,researchCandidates:[candidate,{...candidate,id:"find-2",title:"Actual Album (Red Vinyl)"}]},captures,{},now);
    expect(result.entries.map((entry)=>entry.findId)).toEqual(["find-1","find-2"]);
  });
  it.each([
    {...page,complete:false}, {...page,condition:"Used"}, {...page,capturedAt:"2026-08-01T00:00:00Z"},
    {...page,query:"Other Artist Actual Album"}, {...page,url:page.url.replace("www.ebay.com","other.example")},
    {...page,url:page.url.replace("1000","3000")},
  ])("rejects a mismatched, stale, incomplete or wrong-filter capture",(bad)=>{
    const result=importBrowserSoldResearch(payload,{...captures,pages:[bad]}, {},now);
    expect(result.entries).toEqual([]);expect(result.importSummary.rejected).toHaveLength(1);
  });
  it("does not reuse an old scan checkpoint or import into a published final artifact",()=>{
    expect(()=>importBrowserSoldResearch(payload,captures,{runId:"scan-other"},now)).toThrow("another scan");
    expect(()=>importBrowserSoldResearch({...payload,phase:"final"},captures,{},now)).toThrow("unpublished");
  });
});
