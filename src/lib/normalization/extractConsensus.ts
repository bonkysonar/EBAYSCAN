import type { CandidateListing } from "../ebay/types";
import { normalizeTitle } from "./normalizeTitle";

export type ConsensusSummary = {
  clusterKey: string | null;
  clusterCount: number;
  clusterRatio: number;
};

export function extractConsensus(listings: CandidateListing[]): ConsensusSummary {
  if (listings.length === 0) {
    return { clusterKey: null, clusterCount: 0, clusterRatio: 0 };
  }

  const counts = new Map<string, number>();

  for (const listing of listings) {
    const key = listing.matchSignals.sameAlbumCluster ?? normalizeTitle(listing.title).split(" ").slice(0, 4).join(" ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const [clusterKey, clusterCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { clusterKey, clusterCount, clusterRatio: clusterCount / listings.length };
}
