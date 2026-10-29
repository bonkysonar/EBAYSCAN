import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RetailDealRadarView } from "../components/RetailDealRadar";
import type { RetailDealRadarPayload } from "../lib/arbitrage/dealRadar";

const now = Date.parse("2026-10-28T20:00:00Z");
const payload: RetailDealRadarPayload = {
  version: 1, status: "available", checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(),
  evidenceScope: "advertised_deals_not_retailer_or_resale_verification", sources: [],
  items: [{ id: "1", artist: "Talking Heads", title: "Little Creatures", advertisedPrice: 9.99, currency: "USD", publisher: "Slickdeals", publishedAt: new Date(now - 1000).toISOString(), discussionUrl: "https://slickdeals.net/f/20187786-album", retailerUrl: "https://www.amazon.com/dp/B0CG7WB74W" }],
};
describe("fresh deal leads", () => {
  it("shows timely advertised offers with direct checks and no buy recommendation", () => {
    const html = renderToStaticMarkup(<RetailDealRadarView payload={payload} now={now} />);
    expect(html).toContain("Talking Heads — Little Creatures");
    expect(html).toContain("$9.99 advertised");
    expect(html).toContain("needs retailer and resale checks");
    expect(html).toContain('href="https://www.amazon.com/dp/B0CG7WB74W"');
    expect(html).not.toContain("Buy now");
  });
  it("hides outdated cache and makes failed coverage explicit", () => {
    for (const props of [{ payload, now: now + 300001 }, { payload, now, error: true }, { payload: { ...payload, status: "unavailable" as const }, now }]) {
      const html = renderToStaticMarkup(<RetailDealRadarView {...props} />);
      expect(html).not.toContain("$9.99 advertised");
      expect(html).toMatch(/overdue|coverage is unknown/);
    }
  });
  it("distinguishes partial and empty results from all-market coverage", () => {
    const html = renderToStaticMarkup(<RetailDealRadarView payload={{ ...payload, status: "partial", items: [] }} now={now} />);
    expect(html).toContain("Some feeds could not be read");
    expect(html).toContain("does not establish that no deals are available");
  });
});
