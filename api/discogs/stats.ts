import { fetchDiscogsSalesStatsPage } from "../../src/server/discogsStatsPage.js";

type VercelRequest = {
  body?: unknown;
  method?: string;
};

type VercelResponse = {
  status(statusCode: number): {
    json(payload: unknown): void;
  };
};

type StatsRequestBody = {
  releaseId?: number;
  releaseUrl?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const stats = await fetchDiscogsSalesStatsPage(parseStatsInput(req.body));
    res.status(200).json(stats);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Unknown Discogs stats pull error" });
  }
}

function parseStatsInput(body: unknown): StatsRequestBody {
  if (typeof body === "string") {
    return JSON.parse(body) as StatsRequestBody;
  }

  return body as StatsRequestBody;
}
