import { fetchSellerActiveListings } from "../../src/server/sellerListingsApi.js";

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
    const result = await fetchSellerActiveListings(process.env, parseSellerListingsOptions(req.body));
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown seller listings API error" });
  }
}

function parseSellerListingsOptions(body: unknown): { maxPages?: number; pageNumber?: number } {
  const payload = typeof body === "string" ? parseJson(body) : body;
  if (!payload || typeof payload !== "object") return {};
  const input = payload as { maxPages?: unknown; pageNumber?: unknown };
  return {
    maxPages: typeof input.maxPages === "number" ? input.maxPages : undefined,
    pageNumber: typeof input.pageNumber === "number" ? input.pageNumber : undefined,
  };
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
