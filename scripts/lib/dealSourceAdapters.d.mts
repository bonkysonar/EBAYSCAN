export type RawDeal = {
  directUrl: string | null;
  discussionUrl: string | null;
  expired: boolean;
  price: number | null;
  publishedAt: string | null;
  title: string;
};

export type VinylPriceDropCard = { detailUrl: string; title: string };
export type SlickdealsDealCard = {
  currentPrice: number;
  detailUrl: string;
  discountPercent: number | null;
  expired: boolean;
  originalPrice: number | null;
  publishedAt: string | null;
  storeName: string | null;
  threadId: string;
  title: string;
};
export type VinylPriceDropDetail = {
  currentPrice: number | null;
  detailUrl: string | null;
  directUrl: string | null;
  discountPercent: number | null;
  expired: boolean;
  originalPrice: number | null;
  title: string;
};

export function parseRedditAtomFeed(xml: string): RawDeal[];
export function parseOldRedditDealPage(html: string, pageUrl?: string): RawDeal[];
export function extractVinylPriceDropCards(html: string, pageUrl?: string): VinylPriceDropCard[];
export function extractSlickdealsDealCards(html: string, pageUrl?: string): SlickdealsDealCard[];
export function parseVinylPriceDropDetail(html: string, detailUrl: string, fallbackTitle?: string): VinylPriceDropDetail;
export function splitDealArtistTitle(rawTitle: string): { artist: string; title: string };
export function canonicalizeRetailDealUrl(value: string): string;
export function extractAmazonAsin(value: string | URL): string | null;
