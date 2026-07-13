import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { list, put } from "@vercel/blob";
import type { ArbitrageImportPayload } from "../lib/arbitrage/types";

export const ARBITRAGE_FINDS_DIR = "exports/arbitrage-finds";
const BLOB_PREFIX = "arbitrage-finds/";
const UPLOAD_TOKEN_ENV = "ARBITRAGE_UPLOAD_TOKEN";

export type LatestArbitrageFindsResult =
  | {
      fileName: string;
      payload: ArbitrageImportPayload;
      status: "available";
    }
  | {
      message: string;
      status: "empty";
    };

export async function readLatestArbitrageFinds(cwd: string): Promise<LatestArbitrageFindsResult> {
  if (hasBlobStore()) {
    const blobResult = await readLatestBlobArbitrageFinds();
    if (blobResult.status === "available") return withoutNonRecordFinds(blobResult);
  }

  const localResult = readLatestLocalArbitrageFinds(cwd);
  return localResult.status === "available" ? withoutNonRecordFinds(localResult) : localResult;
}

export async function uploadArbitrageFinds(cwd: string, payload: ArbitrageImportPayload, requestToken?: string | null) {
  assertUploadAuthorized(requestToken);
  assertArbitragePayload(payload);

  const fileName = fileNameForPayload(payload);
  const body = JSON.stringify(payload, null, 2);

  if (hasBlobStore()) {
    const blob = await put(`${BLOB_PREFIX}${fileName}`, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });

    return {
      fileName,
      status: "uploaded" as const,
      storage: "vercel-blob" as const,
      url: blob.url,
    };
  }

  const directory = join(cwd, ARBITRAGE_FINDS_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), body);

  return {
    fileName,
    status: "uploaded" as const,
    storage: "local-filesystem" as const,
  };
}

function readLatestLocalArbitrageFinds(cwd: string): LatestArbitrageFindsResult {
  const directory = join(cwd, ARBITRAGE_FINDS_DIR);
  if (!existsSync(directory)) {
    return {
      message: `No ${ARBITRAGE_FINDS_DIR} folder exists yet.`,
      status: "empty",
    };
  }

  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => {
      const path = join(directory, entry.name);
      return { name: entry.name, mtimeMs: readFileStatMtime(path), path };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const latest = files[0];
  if (!latest) {
    return {
      message: `No JSON files found in ${ARBITRAGE_FINDS_DIR}.`,
      status: "empty",
    };
  }

  return {
    fileName: latest.name,
    payload: JSON.parse(readFileSync(latest.path, "utf8")) as ArbitrageImportPayload,
    status: "available",
  };
}

async function readLatestBlobArbitrageFinds(): Promise<LatestArbitrageFindsResult> {
  const { blobs } = await list({ prefix: BLOB_PREFIX });
  const latest = blobs
    .filter((blob) => blob.pathname.toLowerCase().endsWith(".json"))
    .sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime())[0];

  if (!latest) {
    return {
      message: `No JSON files found in Vercel Blob prefix ${BLOB_PREFIX}.`,
      status: "empty",
    };
  }

  const response = await fetch(latest.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to read latest arbitrage blob ${latest.pathname}: HTTP ${response.status}`);
  }

  return {
    fileName: latest.pathname.replace(BLOB_PREFIX, ""),
    payload: (await response.json()) as ArbitrageImportPayload,
    status: "available",
  };
}

function readFileStatMtime(path: string): number {
  return statSync(path).mtimeMs;
}

function withoutNonRecordFinds(result: Extract<LatestArbitrageFindsResult, { status: "available" }>): LatestArbitrageFindsResult {
  return {
    ...result,
    payload: {
      ...result.payload,
      finds: result.payload.finds.filter((find) => {
        if (find.opportunityType === "sitewide_sale" || find.purchasePrice <= 0) return false;
        if (!find.artist.trim() || !find.title.trim() || /^unknown artist$/i.test(find.artist.trim())) return false;
        return !/^(?:cheap|deals?|home|facebook page|filter amazon|click here|continue shopping|sign up|sign in|order history|premium membership|time|under|\d+% off)$/i.test(
          find.title.replace(/&nbsp;/g, " ").trim(),
        );
      }),
    },
  };
}

function hasBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function assertUploadAuthorized(requestToken?: string | null) {
  const expectedToken = process.env[UPLOAD_TOKEN_ENV];
  if (!expectedToken) {
    throw Object.assign(new Error(`${UPLOAD_TOKEN_ENV} is not configured.`), { statusCode: 503 });
  }

  if (!requestToken || requestToken !== expectedToken) {
    throw Object.assign(new Error("Unauthorized arbitrage upload."), { statusCode: 401 });
  }
}

function assertArbitragePayload(payload: ArbitrageImportPayload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("Upload body must be an arbitrage payload object."), { statusCode: 400 });
  }

  const hasValidTimestamp =
    typeof payload.createdAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(payload.createdAt) &&
    !Number.isNaN(Date.parse(payload.createdAt));
  if (!hasValidTimestamp || typeof payload.source !== "string" || !payload.source.trim() || !Array.isArray(payload.finds)) {
    throw Object.assign(new Error("Upload body must include an ISO createdAt timestamp, source, and finds."), { statusCode: 400 });
  }
}

function fileNameForPayload(payload: ArbitrageImportPayload): string {
  const timestamp = new Date(payload.createdAt).toISOString().replace(/[:.]/g, "-");
  return `retail-arbitrage-${timestamp}.json`;
}
