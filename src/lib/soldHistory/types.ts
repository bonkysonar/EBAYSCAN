export type SoldConditionBucket = "new_sealed" | "used" | "unknown";

export type SoldHistoryRecord = {
  conditionBucket: SoldConditionBucket;
  customLabel?: string;
  inferredArtist?: string;
  inferredReleaseTitle?: string;
  itemNumber?: string;
  mediaGrade?: string;
  normalizedKey: string;
  orderNumber?: string;
  quantity: number;
  saleDate?: string;
  shippingPaid: number;
  sleeveGrade?: string;
  soldFor: number;
  sourceSheet: string;
  title: string;
  totalBuyerPaid: number;
};

export type SoldHistoryComp = {
  averageShipping: number;
  averageSoldFor: number;
  averageTotal: number;
  conditionCounts: Record<SoldConditionBucket, number>;
  count: number;
  exampleTitles: string[];
  inferredArtist?: string;
  inferredReleaseTitle?: string;
  latestSaleDate?: string;
  maxTotal: number;
  medianTotal: number;
  minTotal: number;
  normalizedKey: string;
  records: SoldHistoryRecord[];
};

export type SoldHistoryIndex = {
  comps: SoldHistoryComp[];
  createdAt: string;
  recordCount: number;
  source: string;
  sourceSheets: string[];
  version: 1;
};

export type SoldHistorySearchResult = {
  matchScore: number;
  comp: SoldHistoryComp;
};
