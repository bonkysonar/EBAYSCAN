import type { SellerListingsResult } from "./types";

export class SellerListingsClient {
  async listActive(): Promise<SellerListingsResult> {
    const response = await fetch("/api/ebay/seller-listings", { method: "POST" });
    const text = await response.text();
    const payload = parseJsonResponse(text);

    if (!response.ok) {
      throw new Error(payload.error ?? "Seller listings lookup failed.");
    }

    return payload as SellerListingsResult;
  }
}

function parseJsonResponse(text: string): { error?: string } & Partial<SellerListingsResult> {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Seller listings endpoint returned non-JSON: ${text.slice(0, 120)}`);
  }
}
