import type { BulkBuyRow } from "./calculateBulkBuy";

export type BulkBuyBatch = {
  id: string;
  name: string;
  rows: BulkBuyRow[];
  savedAt: string;
};

const STORAGE_KEY = "record-scanner-bulk-buy-batches-v1";

export function loadBulkBuyBatches(): BulkBuyBatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BulkBuyBatch[]) : [];
  } catch {
    return [];
  }
}

export function saveBulkBuyBatches(batches: BulkBuyBatch[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  } catch {
    // Keep the active batch usable even if browser storage is unavailable.
  }
}

export function createBulkBuyBatch(rows: BulkBuyRow[], name: string, savedAt = new Date().toISOString()): BulkBuyBatch {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || defaultBatchName(savedAt),
    rows: rowsByOrder(rows),
    savedAt,
  };
}

export function rowsByOrder(rows: BulkBuyRow[]): BulkBuyRow[] {
  return [...rows].sort((left, right) => left.order - right.order);
}

function defaultBatchName(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "Untitled batch";
  return `Bulk buy ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
