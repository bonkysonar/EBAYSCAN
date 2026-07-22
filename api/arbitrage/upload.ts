import { uploadArbitrageFinds } from "../../src/server/arbitrageFindsApi.js";

type VercelRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
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
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    res.status(200).json(await uploadArbitrageFinds(process.cwd(), payload, readUploadToken(req.headers)));
  } catch (error) {
    const statusCode =
      error instanceof SyntaxError
        ? 400
        : typeof error === "object" && error !== null && "statusCode" in error
          ? Number(error.statusCode)
          : 500;
    res.status(Number.isFinite(statusCode) ? statusCode : 500).json({
      error: error instanceof Error ? error.message : "Unknown arbitrage upload API error",
    });
  }
}

function readUploadToken(headers: VercelRequest["headers"]): string | null {
  const authorization = readHeader(headers, "authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  return readHeader(headers, "x-arbitrage-upload-token");
}

function readHeader(headers: VercelRequest["headers"], name: string): string | null {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
