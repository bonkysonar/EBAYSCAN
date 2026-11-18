import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { latestRetailScan } from "../../scripts/lib/latestRetailScan.mjs";

it("selects the latest readable acquisition and ignores backups and corrupt files", () => {
  const dir = mkdtempSync(join(tmpdir(), "retail-acquisition-"));
  try {
    const write = (name, date) => writeFileSync(join(dir, name), JSON.stringify({ createdAt: date }));
    write("retail-arbitrage-2026-11-16T12-00Z.json", "2026-11-16T12:00:00Z");
    write("retail-arbitrage-final-scan-2026-11-17T04-00Z.json", "2026-11-17T04:00:00Z");
    write("retail-arbitrage-2026-11-17T17-00Z.json", "2026-11-17T17:00:00Z");
    write("retail-arbitrage-2026-11-18T04-00Z.json.backup.json", "2026-11-18T04:00:00Z");
    writeFileSync(join(dir, "retail-arbitrage-2026-11-18T05-00Z.json"), "{");
    expect(latestRetailScan(dir).createdAt).toBe("2026-11-17T17:00:00Z");
    write("retail-arbitrage-legacy.json", "2026-11-18T09:00:00Z");
    expect(latestRetailScan(dir).createdAt).toBe("2026-11-18T09:00:00Z");
  } finally {
    for (const name of readdirSync(dir)) unlinkSync(join(dir, name));
    rmdirSync(dir);
  }
});
