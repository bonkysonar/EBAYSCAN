import { readArbitrageFindsHistory } from "../../src/server/arbitrageFindsApi.js";

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

  try {
    res.status(200).json(
      await readArbitrageFindsHistory(process.cwd(), {
        limit: firstQueryValue(req.query?.limit) ? Number(firstQueryValue(req.query?.limit)) : undefined,
        sourceId: firstQueryValue(req.query?.sourceId) ?? undefined,
        status: firstQueryValue(req.query?.status) as
          | "changed"
          | "ended"
          | "evergreen"
          | "new"
          | "ongoing"
          | "unknown"
          | undefined,
      }),
    );
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown arbitrage history API error" });
  }
}

function firstQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
