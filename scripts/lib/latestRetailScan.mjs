import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Scanner filenames contain their acquisition date, even for finals curated
// later. Backup copies must never become the authoritative acquisition.
export function latestRetailScan(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(name =>
    /^retail-arbitrage-.*\.json$/i.test(name) && !/\.json\./i.test(name),
  ).map(name => {
    const day = name.match(/^retail-arbitrage-(?:final-(?:scan-|evidence-))?(\d{4}-\d{2}-\d{2})(?:T|\.json$)/i)?.[1];
    return { name, endOfDay: day ? Date.parse(day + "T23:59:59.999Z") : Infinity };
  }).sort((a, b) => b.endOfDay - a.endOfDay || a.name.localeCompare(b.name));

  let latest = null;
  let latestTime = -Infinity;
  for (const { name, endOfDay } of files) {
    if (endOfDay < latestTime) break;
    const path = join(dir, name);
    try {
      const payload = JSON.parse(readFileSync(path, "utf8"));
      const time = Date.parse(payload.createdAt);
      if (time > latestTime) {
        latestTime = time;
        latest = { ...payload, path };
      }
    } catch { /* A partially written artifact cannot supersede a readable one. */ }
  }
  return latest;
}
