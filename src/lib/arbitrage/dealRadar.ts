export type RetailDealRadarItem = {
  id: string;
  artist: string;
  title: string;
  advertisedPrice: number;
  currency: "USD";
  publishedAt: string;
  publisher: "Slickdeals";
  discussionUrl: string;
  retailerUrl: string | null;
};

export type RetailDealRadarPayload = {
  version: 1;
  status: "available" | "partial" | "unavailable";
  checkedAt: string;
  expiresAt: string;
  items: RetailDealRadarItem[];
  sources: { url: string; status: "available" | "error"; reason: string | null }[];
  evidenceScope: "advertised_deals_not_retailer_or_resale_verification";
};
