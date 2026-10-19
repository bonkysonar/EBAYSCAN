import type { AnalyzerRow } from "./queue";
import { restoreRows } from "./queue";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("record-scanner-seller-prices", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("rows", { keyPath: "listing.id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readSellerRows(): Promise<AnalyzerRow[]> {
  const db = await openDatabase();
  try {
    const rows = await new Promise<AnalyzerRow[]>((resolve, reject) => {
      const request = db.transaction("rows").objectStore("rows").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (rows.length) return restoreRows(rows);
    const legacy = localStorage.getItem("record-scanner-seller-price-analyzer-v1");
    return legacy ? restoreRows(JSON.parse(legacy)) : [];
  } finally { db.close(); }
}

export async function writeSellerRows(changed: AnalyzerRow[], removed: string[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("rows", "readwrite");
      const store = transaction.objectStore("rows");
      for (const id of removed) store.delete(id);
      for (const row of changed) store.put(row);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Queue save was interrupted"));
    });
    localStorage.removeItem("record-scanner-seller-price-analyzer-v1");
  } finally { db.close(); }
}
