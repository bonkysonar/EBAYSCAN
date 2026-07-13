import { readSoldHistoryIndex, searchSoldHistory } from "../../src/server/soldHistoryApi.js";

type VercelRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
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

  const query = Array.isArray(req.query?.q) ? req.query?.q[0] : req.query?.q;

  try {
    if (!query) {
      res.status(200).json(readSoldHistoryIndex(process.cwd()));
      return;
    }

    res.status(200).json({ results: searchSoldHistory(process.cwd(), query), status: "available" });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown sold history API error" });
  }
}
