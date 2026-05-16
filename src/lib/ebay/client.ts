import type { MarketplaceClient, SearchInput, SearchResult } from "./types";

export class EbayClient implements MarketplaceClient {
  async search(input: SearchInput): Promise<SearchResult> {
    void input;
    throw new Error(
      "Real eBay Browse API support is not implemented yet. Use MockEbayClient until official credentials and request patterns are configured.",
    );
  }
}
