import { fetchSellerActiveListings } from "../../src/server/sellerListingsApi.js";

type VercelRequest = {
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
    const result = await fetchSellerActiveListings(process.env);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown seller listings API error" });
  }
}
