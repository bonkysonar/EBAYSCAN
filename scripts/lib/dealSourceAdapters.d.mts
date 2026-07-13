export type RawDeal = {
  directUrl: string | null;
  discussionUrl: string | null;
  expired: boolean;
  price: number | null;
  publishedAt: string | null;
  title: string;
};

export type VinylPriceDropCard = { detailUrl: string; title: string };
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
export function parseVinylPriceDropDetail(html: string, detailUrl: string, fallbackTitle?: string): VinylPriceDropDetail;
export function splitDealArtistTitle(rawTitle: string): { artist: string; title: string };
