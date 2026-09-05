import { buildSoldResearchQueryVariants } from "../../src/lib/arbitrage/soldResearchLinks.mjs";
import { ownSaleMatchesAlbum } from "./albumDemand.mjs";
import { parseProductResearchRow } from "./productResearchCuration.mjs";

const key=(value)=>String(value??"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
// Observed marketplace purchases are an album-demand prior only. This index
// deliberately does not return prices, exact pressing counts, or recent velocity.
export function createMarketplaceAlbumDemandIndex(captures={}, now=Date.now()) {
  const pages=new Map();
  for (const page of captures.pages??[]) {
    try {
      const url=new URL(page.url),age=Number(new Date(now))-Date.parse(page.capturedAt);
      if(captures.captureMethod!=="visible_browser" || url.hostname!=="www.ebay.com" ||
        url.pathname!=="/sh/research" || url.searchParams.get("categoryId")!=="176985" ||
        url.searchParams.get("conditionId")!=="1000" || url.searchParams.get("tabName")!=="SOLD" ||
        key(url.searchParams.get("keywords"))!==key(page.query) || page.complete!==true ||
        !(age>=0 && age<=7*86400000) || !Array.isArray(page.rows)) continue;
      const group=pages.get(key(page.query))??[];group.push(page);pages.set(key(page.query),group);
    } catch { /* No demand is inferred from malformed observations. */ }
  }
  return {match(candidate) {
    const query=buildSoldResearchQueryVariants(candidate)[0]?.query;
    const candidates=(pages.get(key(query))??[]).map((page)=>{
      const seen=new Set();
      const capturedDay=Date.parse(page.capturedAt.slice(0,10)+"T00:00:00Z");
      const rows=page.rows.map(parseProductResearchRow).filter((row)=>{
        const listingId=ebayListingIdentity(row.itemUrl);
        const soldDay=Date.parse(row.dateLastSold+"T00:00:00Z");
        if(!listingId || seen.has(listingId) || !(row.totalSold>0) || !Number.isFinite(soldDay) || soldDay>capturedDay ||
          !ownSaleMatchesAlbum(candidate,{title:row.title})) return false;
        seen.add(listingId);return true;
      });
      return {version:1,status:"observed",source:"ebay-product-research",scope:"album_across_conditions_and_editions",
        artistMatchConfirmed:true,albumMatchConfirmed:true,capturedAt:page.capturedAt,
        latestSaleDate:rows.map((row)=>row.dateLastSold).sort().at(-1)??null,
        unitsSold:rows.reduce((total,row)=>total+row.totalSold,0),unitsSold90Days:null,unitsSold365Days:null,transactionCount:null};
    }).filter((evidence)=>evidence.unitsSold>0).sort((a,b)=>b.unitsSold-a.unitsSold);
    return candidates[0];
  }};
}

function ebayListingIdentity(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=="https:" || !["www.ebay.com","ebay.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return url.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/)?.[1]??null;
  } catch { return null; }
}
