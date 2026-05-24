import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkBuyLedger } from "../components/BulkBuyLedger";
import type { BulkBuyCategory, BulkBuyRow } from "../lib/bulkBuy/calculateBulkBuy";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

function renderLedger(
  rows: BulkBuyRow[],
  {
    onDelete = vi.fn<(rowId: string) => void>(),
    onOpenRow = vi.fn<(row: BulkBuyRow) => void>(),
    onSaveBatch = vi.fn<(name: string) => void>(),
  } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <BulkBuyLedger
        rows={rows}
        savedBatches={[]}
        onDelete={onDelete}
        onLoadBatch={vi.fn()}
        onOpenRow={onOpenRow}
        onResetBatch={vi.fn()}
        onSaveBatch={onSaveBatch}
      />,
    );
  });

  return { container, onDelete, onOpenRow, onSaveBatch };
}

describe("BulkBuyLedger", () => {
  it("renders bulk buys in a sortable table and deletes a selected row", () => {
    const { container, onDelete } = renderLedger([
      bulkRow("low", "Alpha Low", 0.5, 4.4, 1.77, 4, "low-end bulk"),
      bulkRow("high", "Zulu High", 12, 33, 14.05, 30, "high-end"),
    ]);

    expect(tableAlbums(container)).toEqual(["Alpha Low", "Zulu High"]);
    expect(tableOrders(container)).toEqual(["1", "2"]);
    expect(container.textContent).toContain("Avg buy / record");
    expect(container.textContent).toContain("$6.00");
    expect(tableCells(container)).toContain("$4.00");
    expect(tableCells(container)).toContain("$1.50");
    expect(container.querySelectorAll(".bulk-buy-resize")).toHaveLength(9);

    act(() => {
      tableHeader(container, "Profit").click();
    });

    expect(tableAlbums(container)).toEqual(["Zulu High", "Alpha Low"]);
    expect(tableOrders(container)).toEqual(["2", "1"]);

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Delete Zulu High"]')?.click();
    });

    expect(onDelete).toHaveBeenCalledWith("high");
  });

  it("opens a bulk buy row for review without firing from delete", () => {
    const { container, onDelete, onOpenRow } = renderLedger([
      { ...bulkRow("low", "Alpha Low", 0.5, 4.4, 1.77, 4, "low-end bulk"), searchResult: mockSearchResult() },
    ]);

    act(() => {
      container.querySelector<HTMLTableRowElement>("tbody tr")?.click();
    });

    expect(onOpenRow).toHaveBeenCalledTimes(1);

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Delete Alpha Low"]')?.click();
    });

    expect(onDelete).toHaveBeenCalledWith("low");
    expect(onOpenRow).toHaveBeenCalledTimes(1);
  });

  it("saves the typed batch name", () => {
    const { container, onSaveBatch } = renderLedger([
      bulkRow("low", "Alpha Low", 0.5, 4.4, 1.77, 4, "low-end bulk"),
    ]);
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Example: Saturday garage haul"]');

    act(() => {
      setNativeInputValue(input!, "Basement jazz lot");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      buttonByText(container, "Save Batch").click();
    });

    expect(onSaveBatch).toHaveBeenCalledWith("Basement jazz lot");
  });
});

function bulkRow(
  id: string,
  artistTitle: string,
  purchasePrice: number,
  bestCaseSalePrice: number,
  estimatedProfit: number,
  medianPrice: number,
  category: BulkBuyCategory,
): BulkBuyRow {
  return {
    artistTitle,
    condition: id === "high" ? "new" : "used",
    currency: "USD",
    id,
    inputLabel: id,
    math: {
      bestCaseSalePrice,
      category,
      estimatedFees: 1,
      estimatedProfit,
      estimatedTaxes: 1,
      medianPrice,
      purchasePrice,
      shippingSupplies: 1,
    },
    order: id === "high" ? 2 : 1,
    scannedAt: "2026-05-24T10:00:00.000Z",
    statsStatus: "sales-stats",
    warnings: [],
  };
}

function tableAlbums(container: HTMLElement | null): string[] {
  return Array.from(container?.querySelectorAll<HTMLTableCellElement>(".bulk-buy-album") ?? []).map((cell) => cell.textContent ?? "");
}

function tableOrders(container: HTMLElement | null): string[] {
  return Array.from(container?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? []).map((row) => row.cells[0]?.textContent ?? "");
}

function tableCells(container: HTMLElement | null): string[] {
  return Array.from(container?.querySelectorAll<HTMLTableCellElement>("tbody td") ?? []).map((cell) => cell.textContent ?? "");
}

function tableHeader(container: HTMLElement | null, label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>(".bulk-buy-sort") ?? []).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  return button!;
}

function buttonByText(container: HTMLElement | null, label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  return button!;
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}

function mockSearchResult() {
  return {
    input: { query: "alpha low", type: "manual" as const },
    listings: [],
    source: "test",
    timestamp: "2026-05-24T10:00:00.000Z",
    warnings: [],
  };
}
