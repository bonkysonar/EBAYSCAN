import type { RawDeal } from "./dealSourceAdapters.mjs";
export const SLICKDEALS_FEED_URLS: readonly string[];
export type PublisherDeal = RawDeal & { priceSource: "publisher_item_price" | "publisher_title" | null };
export type PublisherDealOutcome = PublisherDeal & { feedUrl: string; status: "discovery_lead" | "expired" | "stale" | "undated" | "price_missing" };
export function parseSlickdealsFeed(xml: string): PublisherDeal[];
export function discoverSlickdealsFeeds(options: { fetchPage: (url: string) => Promise<{url: string; html: string}>; now?: number | string | Date; maxAgeHours?: number }): Promise<{ outcomes: PublisherDealOutcome[]; pages: any[]; stats: Record<string, any> }>;
