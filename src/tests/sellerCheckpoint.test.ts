// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeSellerCheckpoint, encodeSellerCheckpoint } from "../lib/seller/checkpoint";
import type { AnalyzerRow } from "../lib/seller/queue";
import { analyzeSellerPrice } from "../lib/seller/analyzeSellerPrice";
import { gzipSync } from "node:zlib";

function row(): AnalyzerRow {
  const listing = { id: "store-1", title: "Example Artist - Actual Title VG+/VG+", currency: "USD", currentPrice: 20, condition: "Used" };
  const searchResult = { input: { type: "manual" as const, query: listing.title }, source: "ebay", timestamp: new Date().toISOString(), warnings: [],
    listings: Array.from({ length: 5 }, (_, i) => ({ id: `comp-${i}`, title: listing.title, source: "ebay" as const, currency: "USD", price: 10, shippingPrice: 0, totalPrice: 10, condition: "Used", sellerId: `seller-${i}`, matchSignals: {} })) };
  return { listing, state: "done", searchResult, analysis: analyzeSellerPrice(listing, searchResult), proposedPrice: 16, isTaggedForChange: true, changeNote: "Review pressing" };
}

describe("seller checkpoint transfer", () => {
  it("round-trips full evidence and proposals through compressed clipboard text", async () => {
    const original = row();
    const transfer = await encodeSellerCheckpoint([original]);
    expect(transfer.startsWith("RSCP1:")).toBe(true);
    expect(await decodeSellerCheckpoint(transfer)).toEqual([original]);
  });
  it("imports ordinary JSON and BOM-prefixed JSON through the same validator", async () => {
    const original = row();
    expect(await decodeSellerCheckpoint("\uFEFF" + JSON.stringify({ version: 2, rows: [original] }))).toEqual([original]);
  });
  it("keeps proposals but removes expired comparable evidence without refreshing timestamps", async () => {
    const original = row();
    original.analysis!.analyzedAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const [restored] = await decodeSellerCheckpoint(await encodeSellerCheckpoint([original]));
    expect(restored).toMatchObject({ state: "pending", proposedPrice: 16, isTaggedForChange: true, changeNote: "Review pressing" });
    expect(restored.analysis).toBeUndefined();
    expect(restored.searchResult).toBeUndefined();
  });
  it("rejects duplicate IDs and invalid proposed prices before replacing saved data", async () => {
    await expect(decodeSellerCheckpoint(JSON.stringify({ version: 2, rows: [row(), row()] }))).rejects.toThrow("duplicate");
    await expect(decodeSellerCheckpoint(JSON.stringify({ version: 2, rows: [{ ...row(), proposedPrice: -1 }] }))).rejects.toThrow("Invalid");
    await expect(decodeSellerCheckpoint(JSON.stringify({ version: 2, rows: [null] }))).rejects.toThrow("Invalid");
  });
  it("provides recovery instructions for truncated or damaged transfer text", async () => {
    const transfer = await encodeSellerCheckpoint([row()]);
    await expect(decodeSellerCheckpoint(transfer.slice(0, -20))).rejects.toThrow("incomplete or damaged");
    await expect(decodeSellerCheckpoint("RSCP1:!!")).rejects.toThrow("incomplete or damaged");
    await expect(decodeSellerCheckpoint("not a checkpoint")).rejects.toThrow("complete checkpoint");
  });
  it("limits decompressed input size as well as pasted input size", async () => {
    const compressed = gzipSync(" ".repeat(40_000_001));
    await expect(decodeSellerCheckpoint("RSCP1:" + compressed.toString("base64"))).rejects.toThrow("40 MB");
  });
});
