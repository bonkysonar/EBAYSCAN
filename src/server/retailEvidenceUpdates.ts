import { normalizeAlbumPriceBenchmark } from "../../scripts/lib/albumPriceBenchmark.mjs";
import { buildSoldResearchQueryVariants } from "../lib/arbitrage/soldResearchLinks.mjs";
import type { ArbitrageImportPayload } from "../lib/arbitrage/types";

const fail = (message: string) => Object.assign(new Error(message), { statusCode: 422 });
const queryKey = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Add album comparison ranges without refreshing or replacing retail observations. */
export function mergeAlbumBenchmarkUpdates(
  incoming: ArbitrageImportPayload,
  previous: ArbitrageImportPayload | null,
  now = Date.now(),
): ArbitrageImportPayload {
  if (incoming.evidenceUpdateVersion !== 1 || incoming.evidenceUpdates?.scope !== "album_price_benchmarks")
    throw fail("Unsupported evidence update version or scope.");
  if (!previous?.runId || incoming.evidenceUpdates.baseRunId !== previous.runId || incoming.runId === previous.runId)
    throw Object.assign(new Error("Evidence updates must target the exact current publication with a new run ID."), { statusCode: 409 });
  const created = Date.parse(incoming.createdAt);
  if (!Number.isFinite(created) || now - created > 86400000 || created > now + 300000)
    throw fail("Evidence updates require a current preparation timestamp.");
  const byId = new Map(previous.finds.map((find) => [find.id, find]));
  const benchmarks = new Map<string, NonNullable<ArbitrageImportPayload["finds"][number]["albumPriceBenchmark"]>>();
  for (const update of incoming.finds) {
    const prior = byId.get(update.id);
    if (!prior || prior.opportunityType === "sitewide_sale" || benchmarks.has(update.id))
      throw fail("Evidence updates require unique existing product IDs.");
    // Acquisition fields are deliberately not updated, even by an authorized
    // uploader. These comparisons catch a patch prepared for a different offer.
    for (const field of ["artist", "title", "sourceId", "sourceUrl", "purchasePrice", "capturedAt"] as const)
      if (update[field] !== prior[field]) throw fail(`Evidence update changed existing ${field}.`);
    const benchmark = normalizeAlbumPriceBenchmark(update.albumPriceBenchmark, now);
    const query = buildSoldResearchQueryVariants(prior)[0]?.query;
    if (!benchmark || !query || queryKey(benchmark.query) !== queryKey(query))
      throw fail("Album benchmark must be valid and match the existing artist and album.");
    benchmarks.set(update.id, benchmark);
  }
  if (!benchmarks.size) throw fail("No valid album benchmark updates were supplied.");
  return {
    ...previous,
    createdAt: incoming.createdAt,
    runId: incoming.runId,
    phase: "final",
    publicationStatus: "final",
    publicationMode: "evidence_updates",
    evidenceUpdateVersion: 1,
    evidenceUpdates: {
      scope: "album_price_benchmarks",
      baseRunId: previous.runId,
      updatedFindIds: [...benchmarks.keys()],
      preparedAt: incoming.createdAt,
    },
    finds: previous.finds.map((find) => benchmarks.has(find.id) ? { ...find, albumPriceBenchmark: benchmarks.get(find.id) } : find),
    sourceUpdates: {
      version: 1,
      updatedSourceIds: [],
      retainedSourceIds: (previous.sourceReports ?? []).map((report) => report.id).filter((id): id is string => typeof id === "string" && Boolean(id)),
      lastBroadScanAt: previous.sourceUpdates ? previous.sourceUpdates.lastBroadScanAt ?? null : previous.createdAt,
      lastBroadAttemptAt: previous.sourceUpdates ? previous.sourceUpdates.lastBroadAttemptAt ?? null : previous.createdAt,
    },
  };
}
