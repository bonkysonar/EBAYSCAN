import type { SellerListingsResult } from "./types";

const SELLER_LISTINGS_PAGES_PER_REQUEST = 5;

export class SellerListingsClient {
  async listActive(): Promise<SellerListingsResult> {
    const listings: SellerListingsResult["listings"] = [];
    const warnings: string[] = [];
    let pageNumber = 1;
    let latest: SellerListingsResult | null = null;

    do {
      latest = await this.listActivePage(pageNumber);
      listings.push(...latest.listings);
      warnings.push(...latest.warnings);
      pageNumber = latest.nextPageNumber ?? 0;
    } while (latest.hasMore && latest.nextPageNumber);

    const dedupedListings = dedupeListings(listings);
    return {
      hasMore: false,
      listings: dedupedListings,
      pageCount: undefined,
      source: "ebay-trading",
      timestamp: latest?.timestamp ?? new Date().toISOString(),
      total: dedupedListings.length,
      warnings,
    };
  }

  private async listActivePage(pageNumber: number): Promise<SellerListingsResult> {
    const response = await fetch("/api/ebay/seller-listings", {
      body: JSON.stringify({ maxPages: SELLER_LISTINGS_PAGES_PER_REQUEST, pageNumber }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const text = await response.text();
    const payload = parseJsonResponse(text);

    if (!response.ok) {
      throw new Error(payload.error ?? "Seller listings lookup failed.");
    }

    return payload as SellerListingsResult;
  }
}

function dedupeListings(listings: SellerListingsResult["listings"]): SellerListingsResult["listings"] {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    if (seen.has(listing.id)) return false;
    seen.add(listing.id);
    return true;
  });
}

function parseJsonResponse(text: string): { error?: string } & Partial<SellerListingsResult> {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Seller listings endpoint returned non-JSON: ${text.slice(0, 120)}`);
  }
}
