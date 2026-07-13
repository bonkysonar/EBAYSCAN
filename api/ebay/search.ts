import { searchMarketplace } from "../../src/server/marketplaceApi.js";
import type { SearchInput } from "../../src/lib/ebay/types";

type VercelRequest = {
  body?: unknown;
  method?: string;
};

type VercelResponse = {
  status(statusCode: number): {
    json(payload: unknown): void;
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const input = parseSearchInput(req.body);
    const result = await searchMarketplace(input, process.env);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown marketplace API error";
    res.status(isRateLimitError(message) ? 429 : 500).json({ error: message });
  }
}

function parseSearchInput(body: unknown): SearchInput {
  if (typeof body === "string") {
    return JSON.parse(body) as SearchInput;
  }

  return body as SearchInput;
}

function isRateLimitError(message: string): boolean {
  return /\b429\b|too many requests|rate limit/i.test(message);
}
