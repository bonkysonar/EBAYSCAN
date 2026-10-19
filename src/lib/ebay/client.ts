import type { MarketplaceClient, SearchInput, SearchResult } from "./types";

export class EbayClient implements MarketplaceClient {
  async search(input: SearchInput): Promise<SearchResult> {
    const response = await fetch("/api/ebay/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(60_000),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "eBay search failed.");
    }

    return payload as SearchResult;
  }
}
