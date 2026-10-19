import { restoreRows, type AnalyzerRow } from "./queue";

export const MAX_CHECKPOINT_BYTES = 40_000_000;
const TRANSFER_PREFIX = "RSCP1:";

// Transfer text stays in the browser. Compression makes full-store checkpoints
// practical to copy between the local analyzer and the hosted application.
export async function encodeSellerCheckpoint(rows: AnalyzerRow[]): Promise<string> {
  const json = JSON.stringify({ version: 2, rows });
  if (new TextEncoder().encode(json).byteLength > MAX_CHECKPOINT_BYTES) throw new Error("Checkpoint exceeds 40 MB.");
  const compressed = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < compressed.length; offset += 8192) binary += String.fromCharCode(...compressed.subarray(offset, offset + 8192));
  return TRANSFER_PREFIX + btoa(binary);
}

export async function decodeSellerCheckpoint(input: string): Promise<AnalyzerRow[]> {
  let text = input.trim();
  if (text.length > MAX_CHECKPOINT_BYTES) throw new Error("Checkpoint exceeds 40 MB.");
  if (text.startsWith(TRANSFER_PREFIX)) {
    try {
      const binary = atob(text.slice(TRANSFER_PREFIX.length));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
      const chunks: BlobPart[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_CHECKPOINT_BYTES) { await reader.cancel(); throw new Error("Checkpoint exceeds 40 MB."); }
        chunks.push(new Uint8Array(chunk.value));
      }
      text = await new Blob(chunks).text();
    } catch (error) {
      if (error instanceof Error && error.message.includes("40 MB")) throw error;
      throw new Error("Checkpoint transfer text is incomplete or damaged. Copy it again.");
    }
  }
  if (new TextEncoder().encode(text).byteLength > MAX_CHECKPOINT_BYTES) throw new Error("Checkpoint exceeds 40 MB.");
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("Paste a complete checkpoint or copied checkpoint text."); }
  if (data?.version !== 2 || !Array.isArray(data.rows) || data.rows.some((row: AnalyzerRow) =>
    !row?.listing || typeof row.listing.id !== "string" || !row.listing.id || typeof row.listing.title !== "string" ||
    typeof row.listing.currency !== "string" || !Number.isFinite(row.listing.currentPrice) ||
    (row.proposedPrice !== undefined && (!Number.isFinite(row.proposedPrice) || row.proposedPrice <= 0)))) {
    throw new Error("Invalid seller checkpoint.");
  }
  if (new Set(data.rows.map((row: AnalyzerRow) => row.listing.id)).size !== data.rows.length) throw new Error("Checkpoint contains duplicate listing IDs.");
  return restoreRows(data.rows);
}
