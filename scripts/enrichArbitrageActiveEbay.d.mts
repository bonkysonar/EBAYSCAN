import type { ActiveSearchProfile } from "../src/lib/arbitrage/activeEbayMatching.mjs";
import type { ArbitrageMatchConfidence } from "../src/lib/arbitrage/types";

export type MatchedActiveListing = {
  condition?: string;
  currency: string;
  editionSignals?: string[];
  id: string;
  itemUrl?: string;
  matchConfidence?: ArbitrageMatchConfidence;
  matchScore?: number;
  matchedVariant?: string;
  price: number;
  shippingPrice: number;
  title: string;
  totalPrice: number;
};

export type ActiveVariantResult = {
  listings: MatchedActiveListing[];
  pagesFetched: number;
  rawListingsInspected: number;
  searchComplete: boolean;
};

export function searchVariantPages(
  keyword: string,
  profile: ActiveSearchProfile,
  options?: {
    env?: {
      EBAY_ENV?: string;
      EBAY_MARKETPLACE_ID: string;
    };
    fetchImpl?: typeof fetch;
    maxPages?: number;
    pageLimit?: number;
    requestTimeoutMs?: number;
    token?: string;
  },
): Promise<ActiveVariantResult>;

export function enrichActiveEntry(
  entry: {
    key: string;
    primary: string;
    profile: ActiveSearchProfile;
    variants: string[];
  },
  options?: {
    searchOptions?: Parameters<typeof searchVariantPages>[2];
    searchVariant?: (keyword: string, profile: ActiveSearchProfile) => Promise<ActiveVariantResult>;
  },
): Promise<{
  activeListingCount?: number;
  error?: string;
  keyword?: string;
  listings?: MatchedActiveListing[];
  lowest?: MatchedActiveListing;
  matchConfidence?: ArbitrageMatchConfidence;
  rawListingsInspected: number;
  searchedVariants: string[];
  searchComplete: boolean;
  status: "available" | "failed" | "no_results";
}>;
