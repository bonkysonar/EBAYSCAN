import { describe, expect, it } from "vitest";
import { discoverVinylPriceDrop } from "../../scripts/lib/vinylPriceDropDiscovery.mjs";
import { webSaleDiscovery, publicDiscoveryUrl } from "../../scripts/lib/webSaleDiscovery.mjs";
import { isHighSignalProductFind, selectResearchCandidates } from "../../scripts/lib/candidatePipeline.mjs";
import { extractRetailCampaigns } from "../../scripts/lib/campaignOffers.mjs";
import { buildSoldResearchQueryVariants } from "../lib/arbitrage/soldResearchLinks.mjs";
import { buildProductResearchPlan } from "../../scripts/lib/productResearchCuration.mjs";

const origin = "https://vinylpricedrop.com";
const cards = (ids: number[]) => ids.map(id => `<a class="card" href="/deals/album-${id}"><h2 class="title">Artist ${id} – Album ${id}</h2></a>`).join("");
const mapConcurrent = (rows: any[], _count: number, fn: (row: any) => Promise<any>) => Promise.all(rows.map(fn));

describe("homepage-first discovery", () => {
  it("keeps signed markdown bands bound to their collections and already-marked prices", () => {
    const result = extractRetailCampaigns({id:"label",name:"Label",retailSourceType:"metal_punk_label"}, '<a href="/en/category/60-sale/1">-60% Blowout Sale</a><a href="/en/category/80-sale/2">-80% Blowout Sale</a><a href="https://other.example/category/sale">-90% Sale</a>', "https://shop.example/en/category/sale/3");
    expect(result.map((r:any)=>r.discountPercent)).toEqual([60,80]);
    expect(result.every((r:any)=>r.scope === "collection" && r.campaignTerms.priceMode === "marked")).toBe(true);
  });
  it("checks all 50 homepage cards despite a 2-item extra-feed cap, and deduplicates", async () => {
    const requested: string[] = [];
    const result = await discoverVinylPriceDrop({ mapConcurrent, extraLimit: 2, fetchPage: async url => {
      requested.push(url);
      if (url === origin + "/") return { url, html: cards(Array.from({ length: 50 }, (_, i) => i)) };
      if (url === origin + "/deals") return { url, html: cards([0, 1, 50, 51, 52]) };
      if (url.endsWith("/sitewide")) return { url, html: cards([99]) };
      return { url, html: '<h1><a href="https://www.amazon.com/dp/B000000001">Album</a></h1><p>$10.00 $20.00</p>' };
    }});
    expect(result.stats).toMatchObject({ homepageCardCount: 50, homepageCheckedCount: 50, homepageComplete: true, feedExtraDeferredCount: 1 });
    expect(result.outcomes).toHaveLength(53);
    expect(requested.filter(url => url === origin + "/deals/album-0")).toHaveLength(1);
  });
  it("keeps failures and expired rows separate; an empty parser is not complete", async () => {
    const result = await discoverVinylPriceDrop({ mapConcurrent, fetchPage: async url => {
      if (url === origin + "/") return {url, html: cards([1, 2])};
      if (url.endsWith("album-1")) throw new Error("HTTP 403");
      return {url, html: url.endsWith("album-2") ? "Drop expired" : ""};
    }});
    expect(result.stats).toMatchObject({ homepageComplete: false, homepageFailedCount: 1, expiredDealCount: 1 });
    const empty = await discoverVinylPriceDrop({mapConcurrent, fetchPage: async url => ({url, html: ""})});
    expect(empty.stats.homepageComplete).toBe(false);
  });
});

describe("open-web sale lead intake", () => {
  const now = "2026-09-30T05:00:00Z";
  const sources = [{id: "shop", baseUrl: "https://shop.example.com/"}, {id: "excluded", baseUrl: "https://excluded.example.com/", resalePolicy: "prohibited"}];
  const capture = (links: any[], capturedAt = now) => ({version: 1, captureMethod: "visible_browser", pages: [{query: "vinyl sitewide sale", url: "https://www.google.com/search?q=vinyl+sale", capturedAt, links}]});
  it("seeds only known retailers and holds genuinely new hosts for onboarding", () => {
    const result = webSaleDiscovery(capture([{url:"https://shop.example.com/collections/sale",text:"Vinyl sale"},{url:"https://new.example.com/sale",text:"New retailer sale"},{url:"https://excluded.example.com/sale",text:"Sale"}]), sources, now);
    expect(result.sourceUrls).toEqual({shop:["https://shop.example.com/collections/sale"]});
    expect(result.newRetailerLeads).toHaveLength(1);
    expect(result.leads.every(row => !row.discountPercent && !row.purchasePrice)).toBe(true);
    expect(result.leads.find(row => row.sourceId === "excluded")?.status).toBe("policy_excluded");
  });
  it("does not reuse stale searches or fetch loopback, credentials, checkout, or IP targets", () => {
    expect(webSaleDiscovery(capture([], "2026-09-28T00:00:00Z"), sources, now).status).toBe("stale");
    for (const url of ["http://example.com", "https://127.0.0.1/", "https://user:secret@example.com", "https://localhost/", "https://x.internal/", "https://example.com/cart"])
      expect(publicDiscoveryUrl(url)).toBeNull();
  });
});

describe("new-deal research allowance", () => {
  it("removes multi-LP merchandising from the single album query", () => {
    expect(buildSoldResearchQueryVariants({artist:"La Ley",title:"La Ley MTV Unplugged (2xLP)"})[0].query).toBe("La Ley MTV Unplugged");
  });
  const make = (id: string, sourceId = "shop", observed = false): any => ({id, sourceId, artist:`Artist ${id}`, title:`Album ${id}`, sourceListingTitle:`Artist ${id} - Album ${id} LP`, sourceUrl:`https://example.com/products/${id}`, purchasePrice:12,
    ...(observed ? {soldEvidence:{source:"local-own-sales-history",status:"validated",artistMatchConfirmed:true,albumMatchConfirmed:true,editionMatchConfirmed:true,matchConfidence:1,unitsSold90Days:1}} : {})});
  it("reserves half the research budget for new deals across sources", () => {
    const result = selectResearchCandidates([...Array.from({length:30}, (_, i) => make(`known-${i}`,"shop",true)), ...Array.from({length:10}, (_,i)=>make(`new-${i}`,"large-feed")), make("new-vpd","vinyl-price-drop")], {limit:20});
    expect(result.selected).toHaveLength(20);
    expect(result.diagnostics).toMatchObject({observedDemandSelectedCount:10, explorationSelectedCount:10});
    expect([...new Set(result.selected.filter((row:any)=>row.researchPriority === "unproven_exploration").map((row:any)=>row.sourceId))].sort()).toEqual(["large-feed","vinyl-price-drop"]);
  });
  it("keeps unfamiliar offers in the first research batch after evaluation reorders the pool", () => {
    const input = [...Array.from({length:30}, (_,i)=>make(`known-${i}`,"known-shop",true)),
      ...Array.from({length:30}, (_,i)=>make(`new-${i}`,i % 2 ? "new-shop-a" : "new-shop-b"))];
    const selected = selectResearchCandidates(input,{limit:40}).selected;
    // Reproduce the scanner's separate result ranking before plan generation.
    const reranked = [...selected].sort((a,b)=>Number(b.researchDemand.observed)-Number(a.researchDemand.observed));
    const prefix = buildProductResearchPlan(reranked,{maxEntries:8});
    expect(prefix.map((entry:any)=>entry.researchPriority)).toEqual([
      "observed_album_demand", "unproven_exploration", "observed_album_demand", "unproven_exploration",
      "observed_album_demand", "unproven_exploration", "observed_album_demand", "unproven_exploration",
    ]);
    expect(new Set(prefix.map((entry:any)=>entry.sourceId))).toEqual(new Set(["known-shop","new-shop-a","new-shop-b"]));
    expect(buildProductResearchPlan(input.slice(0,3)).map((entry:any)=>entry.findId)).toEqual(input.slice(0,3).map(f=>f.id));
  });
  it("admits affordable homepage drops only as research, rejecting unavailable and CD items", () => {
    const lead = {...make("vpd","vinyl-price-drop"), discoveryHomepage:true, discoveryUrl:origin+"/deals/album",purchaseOfferVerification:"discovery_lead"};
    expect(isHighSignalProductFind(lead)).toBe(true);
    expect(isHighSignalProductFind({...lead, available:false})).toBe(false);
    expect(isHighSignalProductFind({...lead, sourceListingTitle:"Artist - Album CD"})).toBe(false);
  });
});
