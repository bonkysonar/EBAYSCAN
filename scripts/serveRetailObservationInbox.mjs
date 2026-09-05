import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const port = Number(
  process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? 4319,
);
const outputPath = resolve(
  process.argv.find((arg) => arg.startsWith("--file="))?.slice(7) ??
    "exports/arbitrage-finds/browser-source-observations.json",
);
const page = `<!doctype html><html><head><title>Retail observation inbox</title></head><body><h1>Retail observation inbox</h1><p>Save public, visible retailer page observations captured through the normal browser. This stores local evidence only.</p><form method="post"><label>Observation JSON<textarea name="observations" rows="15" cols="100"></textarea></label><button>Save observations</button></form></body></html>`;
createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${port}`;
  if (
    req.headers.host !== `127.0.0.1:${port}` ||
    (req.headers.origin && req.headers.origin !== origin)
  ) {
    res.writeHead(403).end("Loopback origin required");
    return;
  }
  if (req.method === "GET") {
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(page);
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8_000_000) throw new Error("Observation too large");
    }
    const value = JSON.parse(new URLSearchParams(body).get("observations"));
    const incoming = Array.isArray(value) ? value : [value];
    const research = req.url === "/research";
    if (
      !incoming.every(
        (entry) =>
          entry &&
          /^https:\/\//.test(entry.url) &&
          Number.isFinite(Date.parse(entry.capturedAt)) &&
          (research
            ? typeof entry.query === "string" && Array.isArray(entry.rows)
            : typeof entry.sourceId === "string" &&
              typeof entry.visibleText === "string"),
      )
    )
      throw new Error("Fresh visible observation fields required");
    const targetPath = research
      ? resolve(dirname(outputPath), "browser-product-research.json")
      : outputPath;
    const previous = existsSync(targetPath)
      ? JSON.parse(readFileSync(targetPath, "utf8")).pages
      : [];
    const pages = [
      ...new Map(
        [...previous, ...incoming].map((entry) => [
          `${entry.sourceId ?? entry.query}:${entry.url}`,
          entry,
        ]),
      ).values(),
    ];
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(
      targetPath,
      JSON.stringify(
        { version: 1, captureMethod: "visible_browser", pages },
        null,
        2,
      ),
    );
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        `<h1>Saved ${incoming.length} observations</h1><p>${pages.length} total pages</p><a href="/">Capture more</a>`,
      );
  } catch (error) {
    res
      .writeHead(400, { "content-type": "text/plain; charset=utf-8" })
      .end(error.message);
  }
}).listen(port, "127.0.0.1", () =>
  console.log(
    `Retail observation inbox: http://127.0.0.1:${port}; output ${outputPath}`,
  ),
);
