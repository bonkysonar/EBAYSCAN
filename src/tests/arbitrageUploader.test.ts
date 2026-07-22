import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workspace = process.cwd();
const scriptPath = join(workspace, "scripts", "uploadLatestArbitrageFinds.mjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("arbitrage uploader CLI", () => {
  it("does not upgrade an explicitly marked draft that uses a legacy daily filename", () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "retail-arbitrage-2026-07-15.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        createdAt: "2026-07-15T12:00:00.000Z",
        finds: [],
        phase: "scan",
        publicationStatus: "draft",
        schemaVersion: 2,
        source: "daily-vinyl-retail-arbitrage-scan",
      }),
    );

    const result = runUploader(filePath);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("raw/draft artifact");
  });

  it("can still prepare an unmarked legacy daily final during migration", () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "retail-arbitrage-2026-07-15.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        createdAt: "2026-07-15T12:00:00.000Z",
        finds: [],
        source: "daily-vinyl-retail-arbitrage-scan",
      }),
    );

    const result = runUploader(filePath);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true,
      uploadedPhase: "final",
    });
  });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(workspace, ".tmp-arbitrage-uploader-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runUploader(filePath: string) {
  return spawnSync(
    process.execPath,
    [scriptPath, `--file=${filePath}`, "--dryRun"],
    {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}
