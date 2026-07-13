import { type IncomingMessage, type ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { readLatestArbitrageFinds, uploadArbitrageFinds } from "./src/server/arbitrageFindsApi";
import type { ArbitrageImportPayload } from "./src/lib/arbitrage/types";
import { fetchDiscogsSalesStatsPage } from "./src/server/discogsStatsPage";
import { readLocalEnv, searchMarketplace } from "./src/server/marketplaceApi";
import { fetchSellerActiveListings } from "./src/server/sellerListingsApi";
import { readSoldHistoryIndex, searchSoldHistory } from "./src/server/soldHistoryApi";
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
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
