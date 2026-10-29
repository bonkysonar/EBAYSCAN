import { readRetailDealRadar } from "../../src/server/retailDealRadarApi.js";

export default async function handler(req: { method?: string }, res: { setHeader(name: string, value: string): void; status(code: number): { json(value: unknown): void } }) {
  res.setHeader("Cache-Control", "private, no-store");
  if ((req.method ?? "GET") !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    res.status(200).json(await readRetailDealRadar());
  } catch {
    res.status(503).json({ error: "Live deal discovery is temporarily unavailable" });
  }
}
