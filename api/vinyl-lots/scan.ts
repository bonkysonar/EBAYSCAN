import { timingSafeEqual } from "node:crypto";
import {
  scanVinylLots,
  VinylLotDiscoveryError,
  type VinylLotDiscoveryEnv,
} from "../../src/server/vinylLotDiscoveryApi.js";

type VercelRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
};

type VercelResponse = {
  setHeader?(name: string, value: string): void;
  status(statusCode: number): {
    json(payload: unknown): void;
  };
};

type ScanHandlerDependencies = {
  env?: NodeJS.ProcessEnv;
  scan?: typeof scanVinylLots;
};

type AuthorizationResult =
  | { authorized: true }
  | { authorized: false; message: string; statusCode: 401 | 503 };

export function createVinylLotScanHandler(dependencies: ScanHandlerDependencies = {}) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader?.("Cache-Control", "private, no-store, max-age=0");

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const env = dependencies.env ?? process.env;
    const authorization = authorizeVinylLotScanRequest(req.headers, env);
    if (!authorization.authorized) {
      res.status(authorization.statusCode).json({ error: authorization.message });
      return;
    }

    try {
      const scan = dependencies.scan ?? scanVinylLots;
      res.status(200).json(await scan(env, { scanRequest: parseRequestBody(req.body) }));
    } catch (error) {
      const statusCode =
        error instanceof VinylLotDiscoveryError
          ? error.statusCode
          : typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : 500;
      res.status(Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500).json({
        error: error instanceof Error ? error.message : "Unknown vinyl-lot scan error",
      });
    }
  };
}

function parseRequestBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  if (!body.trim()) return {};
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new VinylLotDiscoveryError("Vinyl-lot scan options must be valid JSON.", 400);
  }
}

export function authorizeVinylLotScanRequest(
  headers: VercelRequest["headers"],
  env: NodeJS.ProcessEnv,
): AuthorizationResult {
  const expected = cleanText(env.VINYL_LOT_SCAN_TOKEN);
  if (!expected) {
    if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") {
      return {
        authorized: false,
        message: "VINYL_LOT_SCAN_TOKEN must be configured before production scans are enabled.",
        statusCode: 503,
      };
    }
    return { authorized: true };
  }

  const authorization = readHeader(headers, "authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const provided = cleanText(bearer) ?? cleanText(readHeader(headers, "x-vinyl-lot-scan-token"));
  if (!provided || !safeEqual(provided, expected)) {
    return { authorized: false, message: "Unauthorized vinyl-lot scan request.", statusCode: 401 };
  }
  return { authorized: true };
}

function readHeader(headers: VercelRequest["headers"], name: string): string | null {
  if (!headers) return null;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

export default createVinylLotScanHandler();
