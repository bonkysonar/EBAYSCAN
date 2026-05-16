import { fixtureForInput } from "../../fixtures/ebaySearchExamples";
import type { MarketplaceClient, SearchInput, SearchResult } from "./types";

export class MockEbayClient implements MarketplaceClient {
  async search(input: SearchInput): Promise<SearchResult> {
    const listings = fixtureForInput(input);

    return {
      input,
      listings,
      source: "ebay-mock",
      timestamp: new Date().toISOString(),
      warnings: input.type === "image" ? ["Image search is currently a placeholder using mock data."] : [],
      rawSummary: `Returned ${listings.length} deterministic mock listings.`,
    };
  }
}
