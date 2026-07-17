import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { get, list, put } from "@vercel/blob";
import { assessRecordCandidate } from "../../scripts/lib/candidatePipeline.mjs";
import {
  reconcileSaleCampaigns,
  saleCampaignLedgerFromPayload,
  type SaleCampaignLedger,
  type SaleCampaignStatus,
} from "../../scripts/lib/saleCampaignLifecycle.mjs";
import type { ArbitrageFind, ArbitrageImportPayload } from "../lib/arbitrage/types";

export const ARBITRAGE_FINDS_DIR = "exports/arbitrage-finds";
export const ARBITRAGE_PAYLOAD_SCHEMA_VERSION = 2;
const BLOB_PREFIX = "arbitrage-finds/";
const BLOB_LATEST_POINTER_PATH = `${BLOB_PREFIX}latest.json`;
const LOCAL_LATEST_POINTER_FILE = "latest.json";
const UPLOAD_TOKEN_ENV = "ARBITRAGE_UPLOAD_TOKEN";
const PUBLICATION_POINTER_SCHEMA_VERSION = 1;
const MAX_HISTORY_LIMIT = 2_000;
const MAX_FUTURE_PUBLICATION_SKEW_MS = 5 * 60 * 1000;

type ArbitrageSourceReport = Record<string, unknown> & {
  id?: string;
};

export type FinalArbitragePayload = ArbitrageImportPayload & {
  phase: "final";
  publicationStatus: "final";
  publishedAt?: string;
  publication?: {
    inputHash: string;
    payloadHash: string;
    publishedAt: string;
    runId: string;
  };
  runId: string;
  saleCampaignLedger?: SaleCampaignLedger;
  saleLifecycleSummary?: {
    active: number;
    byStatus: Record<SaleCampaignStatus, number>;
    total: number;
  };
  saleObservations?: ArbitrageFind[];
  schemaVersion: typeof ARBITRAGE_PAYLOAD_SCHEMA_VERSION;
  sourceReports?: ArbitrageSourceReport[];
};

type PublicationPointer = {
  createdAt: string;
  fileName: string;
  inputHash: string;
  observedAt: string;
  payloadHash: string;
  publishedAt: string;
  runId: string;
  schemaVersion: typeof PUBLICATION_POINTER_SCHEMA_VERSION;
  storagePath: string;
  url?: string;
};

type StoredPublication = {
  etag?: string;
  payload: FinalArbitragePayload;
  pointer: PublicationPointer;
  pointerBacked: boolean;
};

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

export type ArbitrageFindsHistoryResult =
  | {
      campaigns: SaleCampaignLedger["campaigns"];
      events: SaleCampaignLedger["history"];
      runId: string;
      status: "available";
      summary: Record<SaleCampaignStatus, number>;
      updatedAt: string;
    }
  | {
      message: string;
      status: "empty";
    };

export async function readLatestArbitrageFinds(cwd: string): Promise<LatestArbitrageFindsResult> {
  const result = await readLatestPublishedArbitrageFinds(cwd);
  return result.status === "available" ? withoutNonRecordFinds(result) : result;
}

export async function readArbitrageFindsHistory(
  cwd: string,
  options: { limit?: number; sourceId?: string; status?: SaleCampaignStatus } = {},
): Promise<ArbitrageFindsHistoryResult> {
  const latest = await readLatestPublishedArbitrageFinds(cwd);
  if (latest.status === "empty") return latest;

  const payload = latest.payload as FinalArbitragePayload;
  const ledger = saleCampaignLedgerFromPayload(payload as unknown as Record<string, unknown>);
  const sourceId = cleanText(options.sourceId);
  const status = validSaleCampaignStatus(options.status) ? options.status : null;
  const limit = boundedInteger(options.limit, 1, MAX_HISTORY_LIMIT, 250);
  const campaigns = ledger.campaigns.filter(
    (campaign) => (!sourceId || campaign.sourceId === sourceId) && (!status || campaign.saleStatus === status),
  );
  const campaignIds = new Set(campaigns.map((campaign) => campaign.saleCampaignId));
  const events = ledger.history
    .filter((event) => (!sourceId || event.sourceId === sourceId) && (!status || event.toStatus === status))
    .filter((event) => !sourceId || campaignIds.has(event.campaignId))
    .slice(-limit)
    .reverse();

  return {
    campaigns,
    events,
    runId: ledger.runId || payload.runId,
    status: "available",
    summary: campaignStatusSummary(campaigns),
    updatedAt: ledger.updatedAt,
  };
}

export async function uploadArbitrageFinds(cwd: string, payload: unknown, requestToken?: string | null) {
  assertUploadAuthorized(requestToken);
  const finalPayload = assertFinalArbitragePayload(payload);
  const inputHash = hashJson(finalPayload);
  const current = await readCurrentStoredPublication(cwd);

  if (current?.pointer.runId === finalPayload.runId) {
    if (current.pointer.inputHash !== inputHash) {
      throw httpError(409, `Run ${finalPayload.runId} was already published with different content.`);
    }
    return {
      fileName: current.pointer.fileName,
      payloadHash: current.pointer.payloadHash,
      runId: current.pointer.runId,
      status: "already-published" as const,
      storage: hasBlobStore() ? ("vercel-blob" as const) : ("local-filesystem" as const),
      url: current.pointer.url,
    };
  }

  const bootstrapFromSameLegacyArtifact =
    Boolean(current && !current.pointerBacked) && finalPayload.createdAt === current?.pointer.createdAt;
  if (
    current &&
    Date.parse(lifecycleObservedAt(finalPayload)) <= Date.parse(current.pointer.observedAt) &&
    !bootstrapFromSameLegacyArtifact
  ) {
    throw httpError(
      409,
      `Run ${finalPayload.runId} is not newer than published run ${current.pointer.runId}; latest was left unchanged.`,
    );
  }

  const publishedAt = new Date().toISOString();
  const lifecycle = bootstrapFromSameLegacyArtifact && finalPayload.saleCampaignLedger
    ? lifecycleFromIncomingLedger(finalPayload)
    : reconcileSaleCampaigns({
        observedAt: lifecycleObservedAt(finalPayload),
        previousLedger: current && !bootstrapFromSameLegacyArtifact
          ? saleCampaignLedgerFromPayload(current.payload as unknown as Record<string, unknown>)
          : saleCampaignLedgerFromPayload(null),
        runId: finalPayload.runId,
        saleEvents: finalPayload.saleObservations ?? finalPayload.saleEvents ?? [],
        sourceReports: finalPayload.sourceReports ?? [],
      });
  const productFinds = finalPayload.finds.filter((find) => find.opportunityType !== "sitewide_sale");
  const activeSaleEvents = lifecycle.activeSaleEvents as unknown as ArbitrageFind[];
  const publishablePayload = {
    ...finalPayload,
    finds: [...activeSaleEvents, ...productFinds],
    phase: "final" as const,
    publishedAt,
    saleCampaignLedger: lifecycle.ledger,
    saleEvents: activeSaleEvents,
    saleLifecycleSummary: lifecycle.summary,
  };
  const payloadWithoutPublication = { ...publishablePayload, publication: undefined };
  const payloadHash = hashJson(payloadWithoutPublication);
  const storedPayload: FinalArbitragePayload = {
    ...publishablePayload,
    publication: {
      inputHash,
      payloadHash,
      publishedAt,
      runId: finalPayload.runId,
    },
  };
  const body = JSON.stringify(storedPayload, null, 2);
  const fileName = fileNameForPayload(finalPayload);
  const storagePath = runStoragePath(finalPayload.runId);
  const pointerBase: PublicationPointer = {
    createdAt: finalPayload.createdAt,
    fileName,
    inputHash,
    observedAt: lifecycleObservedAt(finalPayload),
    payloadHash,
    publishedAt,
    runId: finalPayload.runId,
    schemaVersion: PUBLICATION_POINTER_SCHEMA_VERSION,
    storagePath,
  };

  if (hasBlobStore()) {
    const blob = await writeImmutableBlobRun(storagePath, body, inputHash);
    const pointer = "existingPayload" in blob
      ? pointerForStoredPayload(blob.existingPayload, storagePath, blob.url)
      : { ...pointerBase, url: blob.url };
    await writeBlobLatestPointer(pointer, current?.pointerBacked ? current.etag : undefined);
    return {
      campaignSummary: lifecycle.summary,
      fileName: pointer.fileName,
      payloadHash: pointer.payloadHash,
      runId: finalPayload.runId,
      status: "published" as const,
      storage: "vercel-blob" as const,
      url: blob.url,
    };
  }

  const directory = join(cwd, ARBITRAGE_FINDS_DIR);
  const absoluteRunPath = safeLocalStoragePath(directory, storagePath);
  const existingPayload = writeImmutableLocalRun(absoluteRunPath, body, inputHash);
  const pointer = existingPayload ? pointerForStoredPayload(existingPayload, storagePath) : pointerBase;
  writeLocalLatestPointer(directory, pointer, current?.pointerBacked ? current.pointer : null);

  return {
    campaignSummary: lifecycle.summary,
    fileName: pointer.fileName,
    payloadHash: pointer.payloadHash,
    runId: finalPayload.runId,
    status: "published" as const,
    storage: "local-filesystem" as const,
  };
}

export function assertFinalArbitragePayload(payload: unknown): FinalArbitragePayload {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Upload body must be an arbitrage payload object.");
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.schemaVersion !== ARBITRAGE_PAYLOAD_SCHEMA_VERSION) {
    throw httpError(400, `Upload body must use schemaVersion ${ARBITRAGE_PAYLOAD_SCHEMA_VERSION}.`);
  }
  if (candidate.phase !== "final") {
    throw httpError(400, "Only phase=final payloads can be published; scan and enrichment phases cannot become latest.");
  }
  if (candidate.publicationStatus !== "final") {
    throw httpError(400, "Only publicationStatus=final payloads can become latest.");
  }
  if (!validRunId(candidate.runId)) {
    throw httpError(400, "Upload body must include a safe runId using letters, numbers, dots, underscores, or hyphens.");
  }
  if (!validIsoTimestamp(candidate.createdAt)) {
    throw httpError(400, "Upload body must include a valid ISO createdAt timestamp.");
  }
  if (!cleanText(candidate.source)) {
    throw httpError(400, "Upload body must include a non-empty source.");
  }
  if (!Array.isArray(candidate.finds)) {
    throw httpError(400, "Upload body must include a finds array.");
  }

  candidate.finds.forEach((find, index) => assertFindShape(find, `finds[${index}]`));
  assertOptionalArray(candidate.saleEvents, "saleEvents");
  assertOptionalArray(candidate.saleObservations, "saleObservations");
  assertOptionalArray(candidate.sourceReports, "sourceReports");

  for (const [field, events] of [
    ["saleEvents", candidate.saleEvents],
    ["saleObservations", candidate.saleObservations],
  ] as const) {
    if (!Array.isArray(events)) continue;
    events.forEach((event, index) => assertSaleEventShape(event, `${field}[${index}]`));
  }

  const finalCandidate = candidate as unknown as FinalArbitragePayload;
  assertPublicationTimestampNotFuture(finalCandidate.createdAt, "createdAt");
  assertPublicationTimestampNotFuture(
    lifecycleObservedAt(finalCandidate),
    "lifecycle observation time",
  );
  return finalCandidate;
}

export function isLegacyFinalArbitragePayload(payload: unknown): payload is ArbitrageImportPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Record<string, unknown>;
  if (!validIsoTimestamp(candidate.createdAt) || !Array.isArray(candidate.finds)) return false;
  const hasExplicitPublicationMarkers =
    Object.prototype.hasOwnProperty.call(candidate, "phase") ||
    Object.prototype.hasOwnProperty.call(candidate, "publicationStatus");
  if (hasExplicitPublicationMarkers) {
    if (candidate.phase !== "final" || candidate.publicationStatus !== "final") return false;
  }
  const source = cleanText(candidate.source);
  if (
    !hasExplicitPublicationMarkers &&
    source !== "daily-vinyl-retail-arbitrage-scan"
  ) {
    return false;
  }
  const legacyCandidate = candidate as unknown as FinalArbitragePayload;
  return (
    !isMateriallyFutureTimestamp(legacyCandidate.createdAt) &&
    !isMateriallyFutureTimestamp(lifecycleObservedAt(legacyCandidate))
  );
}

async function readLatestPublishedArbitrageFinds(cwd: string): Promise<LatestArbitrageFindsResult> {
  if (hasBlobStore()) {
    const stored = await readBlobPointerPublication();
    if (stored) {
      return {
        fileName: stored.pointer.fileName,
        payload: stored.payload,
        status: "available",
      };
    }

    const legacyBlob = await readLatestLegacyBlobArbitrageFinds();
    if (legacyBlob.status === "available") return legacyBlob;
  }

  const localStored = readLocalPointerPublication(cwd);
  if (localStored) {
    return {
      fileName: localStored.pointer.fileName,
      payload: localStored.payload,
      status: "available",
    };
  }
  return readLatestLegacyLocalArbitrageFinds(cwd);
}

async function readCurrentStoredPublication(cwd: string): Promise<StoredPublication | null> {
  if (hasBlobStore()) {
    const pointerPublication = await readBlobPointerPublication();
    if (pointerPublication) return pointerPublication;
    const legacy = await readLatestLegacyBlobArbitrageFinds();
    return legacy.status === "available" ? storedPublicationFromLegacy(legacy) : null;
  }
  const pointerPublication = readLocalPointerPublication(cwd);
  if (pointerPublication) return pointerPublication;
  const legacy = readLatestLegacyLocalArbitrageFinds(cwd);
  return legacy.status === "available" ? storedPublicationFromLegacy(legacy) : null;
}

function readLocalPointerPublication(cwd: string): StoredPublication | null {
  const directory = join(cwd, ARBITRAGE_FINDS_DIR);
  const pointerPath = join(directory, LOCAL_LATEST_POINTER_FILE);
  if (!existsSync(pointerPath)) return null;
  const pointer = parsePublicationPointer(JSON.parse(readFileSync(pointerPath, "utf8")));
  const payloadPath = safeLocalStoragePath(directory, pointer.storagePath);
  if (!existsSync(payloadPath)) {
    throw new Error(`Latest arbitrage pointer references missing file ${pointer.storagePath}.`);
  }
  const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as FinalArbitragePayload;
  assertStoredPayloadMatchesPointer(payload, pointer);
  return { payload, pointer, pointerBacked: true };
}

function readLatestLegacyLocalArbitrageFinds(cwd: string): LatestArbitrageFindsResult {
  const directory = join(cwd, ARBITRAGE_FINDS_DIR);
  if (!existsSync(directory)) {
    return {
      message: `No ${ARBITRAGE_FINDS_DIR} folder exists yet.`,
      status: "empty",
    };
  }

  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^retail-arbitrage-.*\.json$/i.test(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name);
      return { name: entry.name, mtimeMs: statSync(path).mtimeMs, path };
    });

  const validFiles: Array<{
    fileName: string;
    mtimeMs: number;
    observedAtMs: number;
    payload: ArbitrageImportPayload;
  }> = [];
  for (const file of files) {
    try {
      const payload = JSON.parse(readFileSync(file.path, "utf8"));
      if (!isLegacyFinalArbitragePayload(payload)) continue;
      validFiles.push({
        fileName: file.name,
        mtimeMs: file.mtimeMs,
        observedAtMs: Date.parse(lifecycleObservedAt(payload as FinalArbitragePayload)),
        payload,
      });
    } catch {
      // Ignore malformed or unrelated legacy files and continue to the next candidate.
    }
  }
  validFiles.sort(
    (left, right) =>
      right.observedAtMs - left.observedAtMs ||
      Date.parse(right.payload.createdAt) - Date.parse(left.payload.createdAt) ||
      right.mtimeMs - left.mtimeMs,
  );
  if (validFiles[0]) {
    return {
      fileName: validFiles[0].fileName,
      payload: validFiles[0].payload,
      status: "available",
    };
  }

  return {
    message: `No final Retail Arbitrage JSON files found in ${ARBITRAGE_FINDS_DIR}.`,
    status: "empty",
  };
}

async function readBlobPointerPublication(): Promise<StoredPublication | null> {
  const pointerBlob = await readBlobJson(BLOB_LATEST_POINTER_PATH);
  if (!pointerBlob) return null;
  const pointer = parsePublicationPointer(pointerBlob.value);
  const payloadBlob = await readBlobJson(pointer.storagePath);
  if (!payloadBlob) throw new Error(`Latest arbitrage pointer references missing blob ${pointer.storagePath}.`);
  const payload = payloadBlob.value as FinalArbitragePayload;
  assertStoredPayloadMatchesPointer(payload, pointer);
  return { etag: pointerBlob.etag, payload, pointer, pointerBacked: true };
}

async function readLatestLegacyBlobArbitrageFinds(): Promise<LatestArbitrageFindsResult> {
  const { blobs } = await list({ prefix: BLOB_PREFIX });
  const legacyBlobs = blobs.filter((blob) => {
      const relativePath = blob.pathname.slice(BLOB_PREFIX.length);
      return !relativePath.includes("/") && /^retail-arbitrage-.*\.json$/i.test(relativePath);
    });

  const validBlobs: Array<{
    fileName: string;
    observedAtMs: number;
    payload: ArbitrageImportPayload;
    uploadedAtMs: number;
  }> = [];
  for (const blob of legacyBlobs) {
    try {
      const response = await fetch(blob.url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!isLegacyFinalArbitragePayload(payload)) continue;
      validBlobs.push({
        fileName: blob.pathname.replace(BLOB_PREFIX, ""),
        observedAtMs: Date.parse(lifecycleObservedAt(payload as FinalArbitragePayload)),
        payload,
        uploadedAtMs: blob.uploadedAt.getTime(),
      });
    } catch {
      // Continue past malformed legacy blobs.
    }
  }
  validBlobs.sort(
    (left, right) =>
      right.observedAtMs - left.observedAtMs ||
      Date.parse(right.payload.createdAt) - Date.parse(left.payload.createdAt) ||
      right.uploadedAtMs - left.uploadedAtMs,
  );
  if (validBlobs[0]) {
    return {
      fileName: validBlobs[0].fileName,
      payload: validBlobs[0].payload,
      status: "available",
    };
  }

  return {
    message: `No final Retail Arbitrage JSON files found in Vercel Blob prefix ${BLOB_PREFIX}.`,
    status: "empty",
  };
}

async function writeImmutableBlobRun(storagePath: string, body: string, inputHash: string) {
  const existing = await readBlobJson(storagePath);
  if (existing) {
    const existingPayload = existing.value as FinalArbitragePayload;
    const existingInputHash = cleanText(existingPayload.publication?.inputHash);
    if (existingInputHash !== inputHash) {
      throw httpError(409, `Run storage ${storagePath} already contains different content.`);
    }
    return { existingPayload, url: existing.url };
  }

  try {
    return await put(storagePath, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
      contentType: "application/json",
    });
  } catch (error) {
    throw httpError(409, `Unable to create immutable run ${storagePath}: ${errorMessage(error)}`);
  }
}

async function writeBlobLatestPointer(pointer: PublicationPointer, expectedEtag?: string) {
  try {
    await put(BLOB_LATEST_POINTER_PATH, JSON.stringify(pointer, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: Boolean(expectedEtag),
      cacheControlMaxAge: 60,
      contentType: "application/json",
      ...(expectedEtag ? { ifMatch: expectedEtag } : {}),
    });
  } catch (error) {
    throw httpError(409, `Latest publication changed while this run was uploading; retry safely. ${errorMessage(error)}`);
  }
}

function writeImmutableLocalRun(path: string, body: string, inputHash: string): FinalArbitragePayload | null {
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8")) as FinalArbitragePayload;
    if (cleanText(existing.publication?.inputHash) !== inputHash) {
      throw httpError(409, `Run storage ${path} already contains different content.`);
    }
    return existing;
  }
  atomicWriteFile(path, body);
  return null;
}

function writeLocalLatestPointer(directory: string, pointer: PublicationPointer, expectedPointer: PublicationPointer | null) {
  const pointerPath = join(directory, LOCAL_LATEST_POINTER_FILE);
  const currentPointer = existsSync(pointerPath)
    ? parsePublicationPointer(JSON.parse(readFileSync(pointerPath, "utf8")))
    : null;
  if ((currentPointer?.runId ?? null) !== (expectedPointer?.runId ?? null)) {
    throw httpError(409, "Latest publication changed while this run was being written; retry safely.");
  }
  atomicWriteFile(pointerPath, JSON.stringify(pointer, null, 2));
}

function atomicWriteFile(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, body, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

async function readBlobJson(pathname: string): Promise<{ etag: string; url: string; value: unknown } | null> {
  const result = await get(pathname, { access: "public", useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) throw new Error(`Unable to read blob ${pathname}.`);
  const text = await new Response(result.stream).text();
  return {
    etag: result.blob.etag,
    url: result.blob.url,
    value: JSON.parse(text),
  };
}

function parsePublicationPointer(value: unknown): PublicationPointer {
  if (!value || typeof value !== "object") throw new Error("Latest arbitrage pointer is malformed.");
  const pointer = value as Record<string, unknown>;
  if (
    pointer.schemaVersion !== PUBLICATION_POINTER_SCHEMA_VERSION ||
    !validRunId(pointer.runId) ||
    !validIsoTimestamp(pointer.createdAt) ||
    !validIsoTimestamp(pointer.observedAt) ||
    !validIsoTimestamp(pointer.publishedAt) ||
    !validHash(pointer.inputHash) ||
    !validHash(pointer.payloadHash) ||
    !cleanText(pointer.fileName) ||
    !cleanText(pointer.storagePath)
  ) {
    throw new Error("Latest arbitrage pointer failed schema validation.");
  }
  return pointer as unknown as PublicationPointer;
}

function assertStoredPayloadMatchesPointer(payload: FinalArbitragePayload, pointer: PublicationPointer) {
  if (
    payload.runId !== pointer.runId ||
    payload.phase !== "final" ||
    payload.publicationStatus !== "final" ||
    payload.schemaVersion !== ARBITRAGE_PAYLOAD_SCHEMA_VERSION
  ) {
    throw new Error("Published arbitrage payload does not match its latest pointer.");
  }
  if (payload.publication?.inputHash !== pointer.inputHash || payload.publication?.payloadHash !== pointer.payloadHash) {
    throw new Error("Published arbitrage payload hashes do not match its latest pointer.");
  }
  const { publication: _publication, ...payloadWithoutPublication } = payload;
  if (hashJson(payloadWithoutPublication) !== pointer.payloadHash) {
    throw new Error("Published arbitrage payload content failed its integrity hash.");
  }
}

function pointerForStoredPayload(
  payload: FinalArbitragePayload,
  storagePath: string,
  url?: string,
): PublicationPointer {
  if (
    !payload.publication ||
    !validHash(payload.publication.inputHash) ||
    !validHash(payload.publication.payloadHash) ||
    !validIsoTimestamp(payload.publication.publishedAt)
  ) {
    throw new Error(`Immutable run ${storagePath} is missing publication metadata.`);
  }
  return {
    createdAt: payload.createdAt,
    fileName: fileNameForPayload(payload),
    inputHash: payload.publication.inputHash,
    observedAt: lifecycleObservedAt(payload),
    payloadHash: payload.publication.payloadHash,
    publishedAt: payload.publication.publishedAt,
    runId: payload.runId,
    schemaVersion: PUBLICATION_POINTER_SCHEMA_VERSION,
    storagePath,
    ...(url ? { url } : {}),
  };
}

function storedPublicationFromLegacy(
  result: Extract<LatestArbitrageFindsResult, { status: "available" }>,
): StoredPublication {
  const inputHash = hashJson(result.payload);
  const runId = `legacy-${String(result.payload.createdAt).slice(0, 10)}-${inputHash.slice(0, 12)}`;
  const payload: FinalArbitragePayload = {
    ...result.payload,
    phase: "final",
    publicationStatus: "final",
    runId,
    schemaVersion: ARBITRAGE_PAYLOAD_SCHEMA_VERSION,
  };
  return {
    payload,
    pointer: {
      createdAt: result.payload.createdAt,
      fileName: result.fileName,
      inputHash,
      observedAt: lifecycleObservedAt(payload),
      payloadHash: inputHash,
      publishedAt: result.payload.createdAt,
      runId,
      schemaVersion: PUBLICATION_POINTER_SCHEMA_VERSION,
      storagePath: `${BLOB_PREFIX}${result.fileName}`,
    },
    pointerBacked: false,
  };
}

function withoutNonRecordFinds(
  result: Extract<LatestArbitrageFindsResult, { status: "available" }>,
): LatestArbitrageFindsResult {
  return {
    ...result,
    payload: {
      ...result.payload,
      finds: result.payload.finds.filter((find) => {
        if (find.opportunityType === "sitewide_sale") return true;
        if (find.purchasePrice <= 0) return false;
        if (!find.title.trim() || isSourceCopyTitle(find.title)) return false;
        return assessRecordCandidate({
          context: `${find.artist} ${find.sourceListingTitle ?? ""}`,
          source: {
            id: find.sourceId,
            name: find.sourceName,
            url: find.sourceUrl,
          },
          title:
            find.shopifyVariantTitle ||
            find.sourceListingTitle ||
            `${find.artist} - ${find.title}`,
          url: find.sourceUrl,
        }).accepted;
      }),
    },
  };
}

function isSourceCopyTitle(title: string): boolean {
  return /^(?:cheap|deals?|home|facebook page|filter amazon(?: by price)?|click here|continue shopping|sign up|sign in|order history|premium membership|time|under|\d+% off)$/i.test(
    title.replace(/&nbsp;/g, " ").trim(),
  );
}

function assertPublicationTimestampNotFuture(value: string, field: string) {
  if (isMateriallyFutureTimestamp(value)) {
    throw httpError(
      400,
      `Upload body ${field} cannot be more than five minutes in the future.`,
    );
  }
}

function isMateriallyFutureTimestamp(value: unknown): boolean {
  return (
    validIsoTimestamp(value) &&
    Date.parse(String(value)) - Date.now() > MAX_FUTURE_PUBLICATION_SKEW_MS
  );
}

function assertFindShape(value: unknown, path: string) {
  if (!value || typeof value !== "object") throw httpError(400, `${path} must be an object.`);
  const find = value as Record<string, unknown>;
  for (const field of ["id", "sourceId", "sourceName", "sourceUrl", "title", "capturedAt"]) {
    if (!cleanText(find[field])) throw httpError(400, `${path}.${field} must be a non-empty string.`);
  }
  if (!validIsoTimestamp(find.capturedAt)) throw httpError(400, `${path}.capturedAt must be an ISO timestamp.`);
  if (typeof find.purchasePrice !== "number" || !Number.isFinite(find.purchasePrice) || find.purchasePrice < 0) {
    throw httpError(400, `${path}.purchasePrice must be a non-negative number.`);
  }
  if (typeof find.artist !== "string") throw httpError(400, `${path}.artist must be a string.`);
}

function assertSaleEventShape(value: unknown, path: string) {
  assertFindShape(value, path);
  const event = value as Record<string, unknown>;
  if (event.opportunityType !== "sitewide_sale") {
    throw httpError(400, `${path}.opportunityType must be sitewide_sale.`);
  }
  if (Number(event.purchasePrice) !== 0) throw httpError(400, `${path}.purchasePrice must be 0.`);
}

function assertOptionalArray(value: unknown, field: string) {
  if (value !== undefined && !Array.isArray(value)) throw httpError(400, `${field} must be an array when provided.`);
}

function fileNameForPayload(payload: FinalArbitragePayload): string {
  const timestamp = new Date(payload.createdAt).toISOString().replace(/[:.]/g, "-");
  return `retail-arbitrage-${timestamp}.json`;
}

function runStoragePath(runId: string) {
  return `${BLOB_PREFIX}runs/${runId}/final.json`;
}

function safeLocalStoragePath(directory: string, storagePath: string) {
  const relativeStoragePath = storagePath.startsWith(BLOB_PREFIX) ? storagePath.slice(BLOB_PREFIX.length) : storagePath;
  const absoluteDirectory = resolve(directory);
  const absolutePath = resolve(absoluteDirectory, relativeStoragePath);
  if (absolutePath !== absoluteDirectory && !absolutePath.startsWith(`${absoluteDirectory}${sep}`)) {
    throw new Error(`Unsafe arbitrage storage path ${storagePath}.`);
  }
  return absolutePath;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function campaignStatusSummary(campaigns: SaleCampaignLedger["campaigns"]): Record<SaleCampaignStatus, number> {
  const summary: Record<SaleCampaignStatus, number> = {
    changed: 0,
    ended: 0,
    evergreen: 0,
    new: 0,
    ongoing: 0,
    unknown: 0,
  };
  for (const campaign of campaigns) summary[campaign.saleStatus] += 1;
  return summary;
}

function lifecycleObservedAt(payload: FinalArbitragePayload): string {
  const ledgerTimestamp = payload.saleCampaignLedger?.updatedAt;
  if (validIsoTimestamp(ledgerTimestamp) && Date.parse(ledgerTimestamp) <= Date.parse(payload.createdAt)) {
    return ledgerTimestamp;
  }
  const observationTimestamp = payload.saleObservations
    ?.map((event) => event.capturedAt)
    .find((timestamp) => validIsoTimestamp(timestamp));
  return observationTimestamp ?? payload.createdAt;
}

function lifecycleFromIncomingLedger(payload: FinalArbitragePayload) {
  const ledger = saleCampaignLedgerFromPayload(payload as unknown as Record<string, unknown>);
  const activeSaleEvents = ledger.campaigns
    .filter((campaign) => campaign.saleStatus !== "ended")
    .map((campaign) => campaign as unknown as ArbitrageFind);
  return {
    activeSaleEvents,
    historyEvents: [],
    ledger: {
      ...ledger,
      runId: payload.runId,
    },
    summary: {
      active: activeSaleEvents.length,
      byStatus: campaignStatusSummary(ledger.campaigns),
      total: ledger.campaigns.length,
    },
  };
}

function validSaleCampaignStatus(value: unknown): value is SaleCampaignStatus {
  return typeof value === "string" && ["changed", "ended", "evergreen", "new", "ongoing", "unknown"].includes(value);
}

function validIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validRunId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{2,127}$/i.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function assertUploadAuthorized(requestToken?: string | null) {
  const expectedToken = process.env[UPLOAD_TOKEN_ENV];
  if (!expectedToken) {
    throw httpError(503, `${UPLOAD_TOKEN_ENV} is not configured.`);
  }
  if (!requestToken || requestToken !== expectedToken) {
    throw httpError(401, "Unauthorized arbitrage upload.");
  }
}

function hasBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
