import { expect, it } from "vitest";
import { topAlbums } from "../lib/arbitrage/topDeals";
import { defaultArbitrageSettings } from "../lib/arbitrage/rules";
import type { ArbitrageScoredFind } from "../lib/arbitrage/types";
import type { RetailMarkdownPayload } from "../lib/arbitrage/dealRadar";

it("keeps a freshly researched loss out of the unverified list while allowing a lower price or another pressing", () => {
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const first = { artist: "Artist", title: "Album", url: "https://shop.example/products/album?variant=1",
    price: 18, compareAt: 30, retailer: "Shop" };
  const other = { ...first, url: "https://shop.example/products/album?variant=2", price: 19 };
  const feed: RetailMarkdownPayload = { version: 1, status: "available", evidenceScope: "in_stock_retail_markdowns",
    sources: [], checkedAt: stamp, expiresAt: new Date(now + 300000).toISOString(), items: [first, other] };
  const loss = { id: "loss", artist: first.artist, title: first.title, sourceUrl: first.url, purchasePrice: 18,
    soldEvidence: { capturedAt: stamp }, activeEvidence: { capturedAt: stamp }, expectedNetProfit: -2,
    gates: { matchConfidence: true, soldEvidence: true, activeEvidence: true }, decision: "REJECT" } as ArbitrageScoredFind;
  const rank = () => topAlbums([loss], null, { recordOutcomes: {}, saleOutcomes: {} }, defaultArbitrageSettings, now, feed);
  expect(rank().map(row => row.url)).toEqual([other.url]);
  first.price = 12;
  expect(rank().map(row => row.url)).toEqual([first.url]);
  expect(rank()[0].terms).toContain("resale unverified");
});
