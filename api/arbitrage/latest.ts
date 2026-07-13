import { readLatestArbitrageFinds } from "../../src/server/arbitrageFindsApi.js";

type VercelRequest = {
  method?: string;
};

type VercelResponse = {
  status(statusCode: number): {
    json(payload: unknown): void;
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    res.status(200).json(await readLatestArbitrageFinds(process.cwd()));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown arbitrage finds API error" });
  }
}
