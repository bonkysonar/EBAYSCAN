import type { DiscogsSalesStats } from "../lib/ebay/types";
import { parseDiscogsSalesStats } from "../lib/discogs/parseSalesStats";

type FetchDiscogsSalesStatsInput = {
  releaseId?: number;
  releaseUrl?: string;
};

export async function fetchDiscogsSalesStatsPage(input: FetchDiscogsSalesStatsInput): Promise<DiscogsSalesStats> {
  const url = buildDiscogsReleaseUrl(input);
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "RecordScanner/0.1 single-release-stats",
    },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(buildDiscogsFetchError(response.status, body));
  }

  const stats = parseDiscogsSalesStats(body);
  if (!stats) {
    throw new Error("Discogs page loaded, but the sales statistics table was not found in the returned HTML.");
  }

  return {
    ...stats,
    source: "page_fetch",
  };
}

function buildDiscogsReleaseUrl(input: FetchDiscogsSalesStatsInput): string {
  if (input.releaseUrl) {
    const normalized = input.releaseUrl.startsWith("http") ? input.releaseUrl : `https://www.discogs.com${input.releaseUrl}`;
    const url = new URL(normalized);
    if (url.hostname !== "www.discogs.com" && url.hostname !== "discogs.com") {
      throw new Error("Discogs stats pull only accepts discogs.com release URLs.");
    }
    return url.toString();
  }

  if (input.releaseId) {
    return `https://www.discogs.com/release/${input.releaseId}`;
  }

  throw new Error("Missing Discogs release URL or release ID.");
}

function buildDiscogsFetchError(status: number, body: string): string {
  const blocked = /just a moment|enable javascript and cookies|cloudflare/i.test(body);
  if (blocked) {
    return `Discogs blocked the automatic page pull (${status}) with a browser challenge. Open the Discogs link or use the import box for this one.`;
  }

  return `Discogs page fetch failed (${status}).`;
}
