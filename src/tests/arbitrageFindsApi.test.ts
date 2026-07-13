import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uploadArbitrageFinds } from "../server/arbitrageFindsApi";

describe("arbitrage finds upload", () => {
  const originalUploadToken = process.env.ARBITRAGE_UPLOAD_TOKEN;
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  let workspace = "";

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "record-scanner-arbitrage-"));
    process.env.ARBITRAGE_UPLOAD_TOKEN = "test-upload-token";
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true });
    restoreEnv("ARBITRAGE_UPLOAD_TOKEN", originalUploadToken);
    restoreEnv("BLOB_READ_WRITE_TOKEN", originalBlobToken);
  });

  it("writes a validated payload beneath the local finds directory", async () => {
    const result = await uploadArbitrageFinds(
      workspace,
      {
        createdAt: "2026-07-13T12:45:44.923Z",
        finds: [],
        source: "test-scan",
      },
      "test-upload-token",
    );

    const path = join(workspace, "exports", "arbitrage-finds", result.fileName);
    expect(result).toMatchObject({ status: "uploaded", storage: "local-filesystem" });
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ source: "test-scan" });
  });

  it("rejects timestamps that could escape the upload directory", async () => {
    await expect(
      uploadArbitrageFinds(
        workspace,
        {
          createdAt: "../../outside",
          finds: [],
          source: "test-scan",
        },
        "test-upload-token",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires the configured upload token", async () => {
    await expect(
      uploadArbitrageFinds(
        workspace,
        {
          createdAt: "2026-07-13T12:45:44.923Z",
          finds: [],
          source: "test-scan",
        },
        "wrong-token",
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
