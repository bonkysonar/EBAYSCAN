import { existsSync, readFileSync } from "node:fs";
for (const line of (existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
  : ""
).split(/\r?\n/)) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
}
const response = await fetch(
  new URL(
    "/api/arbitrage/operations?action=feedback",
    process.env.ARBITRAGE_UPLOAD_URL,
  ),
  {
    headers: { Authorization: "Bearer " + process.env.ARBITRAGE_UPLOAD_TOKEN },
    signal: AbortSignal.timeout(20000),
  },
);
if (!response.ok)
  throw new Error(`Feedback report unavailable: HTTP ${response.status}`);
const { entries = [] } = await response.json();
const week = entries.filter(
  (e) =>
    e.listRank >= 1 &&
    e.listRank <= 10 &&
    Date.now() - Date.parse(e.updatedAt) <= 7 * 86400000 &&
    e.outcome,
);
const useful = week.filter((e) =>
  ["worth_opening", "bought", "listed", "sold"].includes(e.outcome),
).length;
console.log(
  JSON.stringify(
    {
      windowDays: 7,
      reviewedTopTen: week.length,
      useful,
      precision: week.length ? useful / week.length : null,
      target: 0.7,
      interpretation: week.length
        ? "Explicit outcomes only; unreviewed recommendations are not counted as successes."
        : "Not enough reviewed recommendations to measure precision yet.",
      byOutcome: week.reduce(
        (counts, e) => (
          (counts[e.outcome] = (counts[e.outcome] ?? 0) + 1),
          counts
        ),
        {},
      ),
    },
    null,
    2,
  ),
);
