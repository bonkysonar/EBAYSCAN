import { type IncomingMessage, type ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import {
  readArbitrageFindsHistory,
  readLatestArbitrageFinds,
  uploadArbitrageFinds,
} from "./src/server/arbitrageFindsApi";
import type { ArbitrageImportPayload } from "./src/lib/arbitrage/types";
import { fetchDiscogsSalesStatsPage } from "./src/server/discogsStatsPage";
import { readLocalEnv, searchMarketplace } from "./src/server/marketplaceApi";
import { fetchSellerActiveListings } from "./src/server/sellerListingsApi";
import { readSoldHistoryIndex, searchSoldHistory } from "./src/server/soldHistoryApi";
import { scanVinylLots } from "./src/server/vinylLotDiscoveryApi";
import {
  saveVinylLotFeedback,
  VINYL_LOT_FEEDBACK_MAX_BYTES,
} from "./src/server/vinylLotFeedbackApi";
import type { SearchInput } from "./src/lib/ebay/types";

function ebayLocalApiPlugin(): Plugin {
  return {
    name: "record-scanner-ebay-local-api",
    configureServer(server) {
      server.middlewares.use("/api/ebay/search", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const input = JSON.parse(await readBody(req)) as SearchInput;
          const result = await searchMarketplace(input, readLocalEnv(process.cwd()));
          sendJson(res, 200, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown marketplace API error";
          sendJson(res, isRateLimitError(message) ? 429 : 500, { error: message });
        }
      });

      server.middlewares.use("/api/vinyl-lots/scan", async (req, res) => {
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const body = await readBody(req);
          const scanRequest = body.trim() ? JSON.parse(body) as unknown : {};
          sendJson(res, 200, await scanVinylLots(readLocalEnv(process.cwd()), { scanRequest }));
        } catch (error) {
          const statusCode =
            typeof error === "object" && error !== null && "statusCode" in error
              ? Number(error.statusCode)
              : 500;
          sendJson(res, Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500, {
            error: error instanceof Error ? error.message : "Unknown vinyl-lot scan error",
          });
        }
      });

      server.middlewares.use("/api/vinyl-lots/feedback", async (req, res) => {
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }
        if (!isLoopbackRequest(req)) {
          sendJson(res, 403, { error: "Vinyl-lot feedback can only be saved from this computer." });
          return;
        }

        try {
          const body = await readBody(req, VINYL_LOT_FEEDBACK_MAX_BYTES);
          const payload = body.trim() ? JSON.parse(body) as unknown : {};
          sendJson(res, 200, await saveVinylLotFeedback(payload, { workspaceRoot: process.cwd() }));
        } catch (error) {
          const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 400;
          sendJson(res, Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 400, {
            error: error instanceof Error ? error.message : "Unknown vinyl-lot feedback error",
          });
        }
      });

      server.middlewares.use("/api/discogs/stats", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const input = JSON.parse(await readBody(req)) as { releaseId?: number; releaseUrl?: string };
          const stats = await fetchDiscogsSalesStatsPage(input);
          sendJson(res, 200, stats);
        } catch (error) {
          sendJson(res, 502, { error: error instanceof Error ? error.message : "Unknown Discogs stats pull error" });
        }
      });

      server.middlewares.use("/api/ebay/seller-listings", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const result = await fetchSellerActiveListings(readLocalEnv(process.cwd()), parseSellerListingsOptions(await readBody(req)));
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown seller listings API error" });
        }
      });

      server.middlewares.use("/api/arbitrage/latest", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          sendJson(res, 200, await readLatestArbitrageFinds(process.cwd()));
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown arbitrage finds API error" });
        }
      });

      server.middlewares.use("/api/arbitrage/history", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const url = new URL(req.url ?? "", "http://localhost");
          sendJson(
            res,
            200,
            await readArbitrageFindsHistory(process.cwd(), {
              limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
              sourceId: url.searchParams.get("sourceId") ?? undefined,
              status: (url.searchParams.get("status") as
                | "changed"
                | "ended"
                | "evergreen"
                | "new"
                | "ongoing"
                | "unknown"
                | null) ?? undefined,
            }),
          );
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Unknown arbitrage history API error",
          });
        }
      });

      server.middlewares.use("/api/arbitrage/upload", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const payload = JSON.parse(await readBody(req)) as ArbitrageImportPayload;
          sendJson(res, 200, await uploadArbitrageFinds(process.cwd(), payload, readUploadToken(req.headers)));
        } catch (error) {
          const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 500;
          sendJson(res, Number.isFinite(statusCode) ? statusCode : 500, {
            error: error instanceof Error ? error.message : "Unknown arbitrage upload API error",
          });
        }
      });

      server.middlewares.use("/api/sold-history/search", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const url = new URL(req.url ?? "", "http://localhost");
          const query = url.searchParams.get("q");
          if (!query) {
            sendJson(res, 200, readSoldHistoryIndex(process.cwd()));
            return;
          }

          sendJson(res, 200, { results: searchSoldHistory(process.cwd(), query), status: "available" });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown sold history API error" });
        }
      });
    },
  };
}

function readBody(req: IncomingMessage, maximumBytes = Number.POSITIVE_INFINITY): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let byteCount = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      byteCount += Buffer.byteLength(chunk, "utf8");
      if (byteCount > maximumBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function isRateLimitError(message: string): boolean {
  return /\b429\b|too many requests|rate limit/i.test(message);
}

function parseSellerListingsOptions(body: string): { maxPages?: number; pageNumber?: number } {
  try {
    const payload = body ? JSON.parse(body) : {};
    return {
      maxPages: typeof payload.maxPages === "number" ? payload.maxPages : undefined,
      pageNumber: typeof payload.pageNumber === "number" ? payload.pageNumber : undefined,
    };
  } catch {
    return {};
  }
}

function readUploadToken(headers: IncomingMessage["headers"]): string | null {
  const authorization = headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  const token = headers["x-arbitrage-upload-token"];
  if (Array.isArray(token)) return token[0] ?? null;
  return token ?? null;
}

export default defineConfig({
  plugins: [react(), ebayLocalApiPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
