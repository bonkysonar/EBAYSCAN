import { type IncomingMessage, type ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { readLocalEnv, searchMarketplace } from "./src/server/marketplaceApi";
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
          sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown marketplace API error" });
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

export default defineConfig({
  plugins: [react(), ebayLocalApiPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
