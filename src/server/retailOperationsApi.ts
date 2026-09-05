import { createHmac, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { put, list } from "@vercel/blob";
import { readCurrentPublicBlobJson, preservePublicBlobVersion } from "./readCurrentPublicBlobJson.js";
import {
  learningIdentity,
  REVIEW_OUTCOMES,
} from "../../scripts/lib/retailLearning.mjs";
import type { ArbitrageFind } from "../lib/arbitrage/types";

type Receipt = NonNullable<ArbitrageFind["feedbackReceipt"]>;
const fail = (code: number, message: string) =>
  Object.assign(new Error(message), { statusCode: code });
const sign = (value: unknown) =>
  createHmac("sha256", process.env.ARBITRAGE_UPLOAD_TOKEN ?? "")
    .update(JSON.stringify(value))
    .digest("hex");
export function feedbackReceipt(
  find: ArbitrageFind,
  rank: number | null = null,
  runId: string = "",
): Receipt | undefined {
  if (
    !process.env.ARBITRAGE_UPLOAD_TOKEN ||
    find.opportunityType === "sitewide_sale"
  )
    return undefined;
  const fields = {
    ...learningIdentity(find),
    listRank: rank,
    run: sign(runId),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  return { ...fields, signature: sign(fields) };
}
export async function retailOperations(
  cwd: string,
  method: string,
  body: unknown,
  token?: string | null,
  action = "status",
) {
  if (method === "GET" && action === "status")
    return (await read(cwd, "status.json")) ?? { status: "unknown" };
  if (method === "POST" && action === "feedback") {
    const input = body as { receipt?: Receipt; outcome?: string | null };
    const receipt = input?.receipt;
    if (
      !receipt ||
      !/^[a-f0-9]{64}$/.test(receipt.key) ||
      !/^[a-f0-9]{64}$/.test(receipt.observation) ||
      !/^[a-f0-9]{64}$/.test(receipt.signature) ||
      !(Date.parse(receipt.expiresAt) > Date.now()) ||
      !process.env.ARBITRAGE_UPLOAD_TOKEN
    )
      throw fail(
        400,
        "Invalid or expired review receipt. Refresh the record first.",
      );
    const fields = {
      key: receipt.key,
      observation: receipt.observation,
      listRank: receipt.listRank,
      run: receipt.run,
      expiresAt: receipt.expiresAt,
    };
    if (
      !timingSafeEqual(
        Buffer.from(receipt.signature),
        Buffer.from(sign(fields)),
      )
    )
      throw fail(403, "Invalid review signature.");
    if (
      input.outcome !== null &&
      !REVIEW_OUTCOMES.includes(input.outcome ?? "")
    )
      throw fail(400, "Unknown review outcome.");
    // No titles, prices, URLs, seller names, IDs, descriptions, or raw marketplace data.
    const entry = {
      version: 1,
      key: receipt.key,
      observation: receipt.observation,
      listRank: receipt.listRank,
      run: receipt.run,
      outcome: input.outcome,
      updatedAt: new Date().toISOString(),
    };
    await write(cwd, `feedback/${receipt.key}.json`, entry);
    return { status: "saved" };
  }
  if (
    !process.env.ARBITRAGE_UPLOAD_TOKEN ||
    token !== process.env.ARBITRAGE_UPLOAD_TOKEN
  )
    throw fail(401, "Scanner authorization required.");
  if (method === "GET" && action === "feedback")
    return { entries: await feedbackEntries(cwd) };
  if (method !== "POST" || action !== "status")
    throw fail(405, "Method not allowed.");
  const input = body as Record<string, unknown>;
  if (
    !input ||
    !["running", "research", "published", "partial", "failed"].includes(
      String(input.status),
    ) ||
    !/^[a-z0-9._-]{3,128}$/i.test(String(input.runId))
  )
    throw fail(400, "Invalid scan attempt.");
  const previous = await read(cwd, "status.json");
  const value = {
    version: 1,
    runId: input.runId,
    status: input.status,
    mode: input.mode === "full" ? "full" : "refresh",
    startedAt: validDate(input.startedAt),
    updatedAt: new Date().toISOString(),
    sourceCount: bounded(input.sourceCount),
    updatedSourceCount: bounded(input.updatedSourceCount),
    researchProgress: boundedResearchProgress(input.researchProgress),
    lastPublishedAt: ["published", "partial"].includes(String(input.status))
      ? new Date().toISOString()
      : (previous?.lastPublishedAt ?? null),
    message:
      input.status === "failed"
        ? "The latest scan did not publish. Older observations retain their original verification times."
        : null,
  };
  if (
    previous?.startedAt &&
    Date.parse(String(previous.startedAt)) > Date.parse(value.startedAt)
  )
    throw fail(409, "A newer scan attempt is already recorded.");
  await write(cwd, "status.json", value);
  // Daily shadow metrics contain counters and opaque identities only.
  if (input.funnel && typeof input.funnel === "object") {
    const funnel = input.funnel as Record<string, unknown>;
    const metrics = Object.fromEntries(
      [
        "retained",
        "eligible",
        "identityResolved",
        "priced",
        "evidenceCompleted",
        "economicallyQualified",
        "displayed",
      ].map((key) => [key, bounded(funnel[key])]),
    );
    await write(
      cwd,
      `metrics/${value.startedAt.slice(0, 10)}-${String(input.runId)}.json`,
      { ...value, ...metrics },
    );
  }
  return value;
}
function validDate(value: unknown) {
  const date = new Date(String(value));
  if (
    !Number.isFinite(+date) ||
    +date > Date.now() + 300000 ||
    Date.now() - +date > 7 * 86400000
  )
    throw fail(400, "Invalid scan time.");
  return date.toISOString();
}
function bounded(value: unknown) {
  return Math.max(0, Math.min(1000000, Math.floor(Number(value) || 0)));
}
function boundedResearchProgress(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const planned = Math.min(240, bounded(input.planned));
  const completed = Math.min(planned, bounded(input.completed));
  const validated = Math.min(completed, bounded(input.validated));
  const noRows = Math.min(completed - validated, bounded(input.noRows));
  const failed = Math.min(planned - validated - noRows, bounded(input.failed));
  const pending = Math.max(bounded(input.pending), planned - validated - noRows - failed);
  const outsidePlan = bounded(input.outsidePlan);
  const complete = planned > 0 && completed === planned && validated + noRows === planned && failed === 0 && pending === 0 && outsidePlan === 0;
  return { planned, completed, validated, noRows, failed, pending: Math.min(planned, pending), researchedRows: bounded(input.researchedRows), limit: 240, outsidePlan, complete, status: planned === 0 ? "not_needed" : complete ? "complete" : "incomplete" };
}
async function read(
  cwd: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const result=await readCurrentPublicBlobJson(`retail-operations/${path}`);
    return result?.value as Record<string,unknown>|null ?? null;
  }
  const file = join(cwd, "exports", "retail-operations", path);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
async function write(cwd: string, path: string, value: unknown) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const pathname = `retail-operations/${path}`;
    const body = JSON.stringify(value);
    const stored = await put(pathname, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    await preservePublicBlobVersion(pathname, stored.etag, body);
    return;
  }
  const file = join(cwd, "exports", "retail-operations", path);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, file);
}
async function feedbackEntries(cwd: string) {
  let paths: string[] = [];
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: "retail-operations/feedback/",
        cursor,
        limit: 1000,
      });
      paths.push(
        ...page.blobs.map((b) => b.pathname.replace("retail-operations/", "")),
      );
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && paths.length < 10000);
  } else {
    const dir = join(cwd, "exports", "retail-operations", "feedback");
    if (existsSync(dir))
      paths = readdirSync(dir)
        .filter((p) => /^[a-f0-9]{64}\.json$/.test(p))
        .map((p) => `feedback/${p}`);
  }
  const entries = [];
  for (let i = 0; i < paths.length; i += 20) {
    entries.push(
      ...(await Promise.all(paths.slice(i, i + 20).map((p) => read(cwd, p)))),
    );
  }
  return entries.filter(
    (e) => e && Date.now() - Date.parse(String(e.updatedAt)) < 14 * 86400000,
  );
}
