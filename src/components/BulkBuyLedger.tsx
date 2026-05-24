import { useMemo, useState, type MouseEvent } from "react";
import type { BulkBuyBatch } from "../lib/bulkBuy/batches";
import { rowsByOrder } from "../lib/bulkBuy/batches";
import type { BulkBuyCategory, BulkBuyRow } from "../lib/bulkBuy/calculateBulkBuy";
import { roundDownToHalfDollar } from "../lib/bulkBuy/calculateBulkBuy";

type Props = {
  onLoadBatch: (batchId: string) => void;
  onDelete: (rowId: string) => void;
  onOpenRow: (row: BulkBuyRow) => void;
  onResetBatch: () => void;
  onSaveBatch: (name: string) => void;
  rows: BulkBuyRow[];
  savedBatches: BulkBuyBatch[];
};

type SortDirection = "asc" | "desc";
type ColumnKey = "actions" | "album" | "buy" | "category" | "condition" | "order" | "profit" | "reference" | "sell";
type SortKey = "album" | "buy" | "category" | "condition" | "order" | "profit" | "reference" | "sell";

const defaultColumnWidths: Record<ColumnKey, number> = {
  actions: 76,
  album: 230,
  buy: 76,
  category: 118,
  condition: 104,
  order: 70,
  profit: 86,
  reference: 78,
  sell: 76,
};

const columns: ColumnKey[] = ["order", "buy", "sell", "profit", "album", "condition", "category", "reference", "actions"];

export function BulkBuyLedger({
  onDelete,
  onLoadBatch,
  onOpenRow,
  onResetBatch,
  onSaveBatch,
  rows,
  savedBatches,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(defaultColumnWidths);
  const [batchName, setBatchName] = useState("");
  const totals = rows.reduce(
    (accumulator, row) => {
      if (!row.math) {
        accumulator.missing += 1;
        return accumulator;
      }

      accumulator.bestCaseSalePrice += roundedMoneyValue(row.math.bestCaseSalePrice);
      accumulator.estimatedFees += roundedMoneyValue(row.math.estimatedFees);
      accumulator.estimatedProfit += roundedMoneyValue(row.math.estimatedProfit);
      accumulator.estimatedTaxes += roundedMoneyValue(row.math.estimatedTaxes);
      accumulator.pricedCount += 1;
      accumulator.purchasePrice += roundedMoneyValue(row.math.purchasePrice);
      accumulator.shippingSupplies += row.math.shippingSupplies;
      return accumulator;
    },
    {
      bestCaseSalePrice: 0,
      estimatedFees: 0,
      estimatedProfit: 0,
      estimatedTaxes: 0,
      missing: 0,
      pricedCount: 0,
      purchasePrice: 0,
      shippingSupplies: 0,
    },
  );
  const averagePurchasePrice = totals.pricedCount > 0 ? roundDownToHalfDollar(totals.purchasePrice / totals.pricedCount) : 0;
  const sortedRows = useMemo(
    () => [...rows].sort((left, right) => compareRows(left, right, sortKey, sortDirection)),
    [rows, sortDirection, sortKey],
  );

  return (
    <aside className="panel bulk-buy-panel">
      <div className="section-heading bulk-buy-heading">
        <div>
          <h2>Bulk Buy</h2>
          <span>{rows.length} scanned</span>
        </div>
      </div>

      <div className="bulk-buy-actions">
        <label>
          Batch name
          <input
            placeholder="Example: Saturday garage haul"
            value={batchName}
            onChange={(event) => setBatchName(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => downloadBatchCsv(rows)} disabled={rows.length === 0}>Download Batch</button>
        <button type="button" onClick={saveNamedBatch} disabled={rows.length === 0}>Save Batch</button>
        <button className="secondary-button" type="button" onClick={onResetBatch} disabled={rows.length === 0}>Reset Bulk Buy</button>
        {savedBatches.length ? (
          <label>
            Saved
            <select defaultValue="" onChange={(event) => {
              if (!event.target.value) return;
              onLoadBatch(event.target.value);
              event.target.value = "";
            }}>
              <option value="">Load saved batch</option>
              {savedBatches.map((batch) => (
                <option value={batch.id} key={batch.id}>{batchLabel(batch)}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="bulk-buy-total">
        <span>Proposed buy total</span>
        <strong>{money(totals.purchasePrice)}</strong>
      </div>

      <dl className="bulk-buy-metrics">
        <div><dt>Avg buy / record</dt><dd>{money(averagePurchasePrice)}</dd></div>
        <div><dt>Best case sales</dt><dd>{money(totals.bestCaseSalePrice)}</dd></div>
        <div><dt>Profit after costs</dt><dd>{money(totals.estimatedProfit)}</dd></div>
        <div><dt>Fees</dt><dd>{money(totals.estimatedFees)}</dd></div>
        <div><dt>Taxes</dt><dd>{money(totals.estimatedTaxes)}</dd></div>
      </dl>

      {totals.missing ? <p className="bulk-buy-alert">{totals.missing} {totals.missing === 1 ? "row needs" : "rows need"} Discogs median stats.</p> : null}

      <div className="bulk-buy-table-wrap">
        {rows.length === 0 ? <p className="muted">Scan records to build the offer sheet.</p> : null}
        {rows.length ? (
          <table className="bulk-buy-table" style={{ minWidth: `${tableWidth(columnWidths)}px` }}>
            <colgroup>
              {columns.map((column) => (
                <col style={{ width: `${columnWidths[column]}px` }} key={column} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="order" label="Order" sortKey="order" onResizeStart={startResize} onSort={toggleSort} />
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="buy" label="Buy" sortKey="buy" onResizeStart={startResize} onSort={toggleSort} />
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="sell" label="Sell" sortKey="sell" onResizeStart={startResize} onSort={toggleSort} />
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="profit" label="Profit" sortKey="profit" onResizeStart={startResize} onSort={toggleSort} />
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="album" label="Album" sortKey="album" onResizeStart={startResize} onSort={toggleSort} />
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="condition" label="New/Used" sortKey="condition" onResizeStart={startResize} onSort={toggleSort} />
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="category" label="Category" sortKey="category" onResizeStart={startResize} onSort={toggleSort} />
                <SortableHeader activeDirection={sortDirection} activeKey={sortKey} columnKey="reference" label="Ref" sortKey="reference" onResizeStart={startResize} onSort={toggleSort} />
                <ResizableHeader columnKey="actions" label="Actions" onResizeStart={startResize} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr className={row.searchResult ? "bulk-buy-clickable-row" : ""} key={row.id} onClick={() => onOpenRow(row)}>
                  <td>{row.order}</td>
                  <td>{row.math ? money(row.math.purchasePrice, row.currency) : "n/a"}</td>
                  <td>{row.math ? money(row.math.bestCaseSalePrice, row.currency) : "n/a"}</td>
                  <td>{row.math ? money(row.math.estimatedProfit, row.currency) : "n/a"}</td>
                  <td className="bulk-buy-album">{row.artistTitle}</td>
                  <td>{conditionLabel(row.condition)}</td>
                  <td>{row.math ? categoryLabel(row.math.category) : "Needs median"}</td>
                  <td>{row.math ? money(row.math.medianPrice, row.currency) : "n/a"}</td>
                  <td>
                    <button className="bulk-buy-delete" type="button" onClick={(event) => {
                      event.stopPropagation();
                      onDelete(row.id);
                    }} aria-label={`Delete ${row.artistTitle}`}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </aside>
  );

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(defaultDirection(nextKey));
  }

  function saveNamedBatch() {
    onSaveBatch(batchName);
    setBatchName("");
  }

  function startResize(columnKey: ColumnKey, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[columnKey];

    function resize(moveEvent: globalThis.MouseEvent) {
      const nextWidth = Math.max(54, Math.min(520, startWidth + moveEvent.clientX - startX));
      setColumnWidths((current) => ({ ...current, [columnKey]: nextWidth }));
    }

    function stopResize() {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResize);
    }

    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResize);
  }
}

function SortableHeader({
  activeDirection,
  activeKey,
  columnKey,
  label,
  onResizeStart,
  onSort,
  sortKey,
}: {
  activeDirection: SortDirection;
  activeKey: SortKey;
  columnKey: ColumnKey;
  label: string;
  onResizeStart: (columnKey: ColumnKey, event: MouseEvent<HTMLButtonElement>) => void;
  onSort: (sortKey: SortKey) => void;
  sortKey: SortKey;
}) {
  const isActive = activeKey === sortKey;

  return (
    <th>
      <button className="bulk-buy-sort" type="button" onClick={() => onSort(sortKey)}>
        {label}{isActive ? (activeDirection === "asc" ? " Asc" : " Desc") : ""}
      </button>
      <button
        aria-label={`Resize ${label} column`}
        className="bulk-buy-resize"
        type="button"
        onMouseDown={(event) => onResizeStart(columnKey, event)}
      />
    </th>
  );
}

function ResizableHeader({
  columnKey,
  label,
  onResizeStart,
}: {
  columnKey: ColumnKey;
  label: string;
  onResizeStart: (columnKey: ColumnKey, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <th aria-label={label}>
      <span className="bulk-buy-static-header">{label}</span>
      <button
        aria-label={`Resize ${label} column`}
        className="bulk-buy-resize"
        type="button"
        onMouseDown={(event) => onResizeStart(columnKey, event)}
      />
    </th>
  );
}

function compareRows(left: BulkBuyRow, right: BulkBuyRow, sortKey: SortKey, direction: SortDirection): number {
  const leftValue = sortValue(left, sortKey);
  const rightValue = sortValue(right, sortKey);
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier || left.artistTitle.localeCompare(right.artistTitle);
  }

  return String(leftValue).localeCompare(String(rightValue)) * multiplier || left.artistTitle.localeCompare(right.artistTitle);
}

function sortValue(row: BulkBuyRow, sortKey: SortKey): number | string {
  if (sortKey === "album") return row.artistTitle.toLowerCase();
  if (sortKey === "buy") return row.math ? roundedMoneyValue(row.math.purchasePrice) : Number.POSITIVE_INFINITY;
  if (sortKey === "category") return categoryRank(row);
  if (sortKey === "condition") return conditionLabel(row.condition);
  if (sortKey === "order") return row.order;
  if (sortKey === "profit") return row.math ? roundedMoneyValue(row.math.estimatedProfit) : Number.NEGATIVE_INFINITY;
  if (sortKey === "reference") return row.math ? roundedMoneyValue(row.math.medianPrice) : Number.POSITIVE_INFINITY;
  return row.math ? roundedMoneyValue(row.math.bestCaseSalePrice) : Number.POSITIVE_INFINITY;
}

function categoryRank(row: BulkBuyRow): number {
  if (!row.math) return 3;
  if (row.math.category === "low-end bulk") return 0;
  if (row.math.category === "sellable") return 1;
  return 2;
}

function defaultDirection(sortKey: SortKey): SortDirection {
  return sortKey === "album" || sortKey === "category" || sortKey === "condition" || sortKey === "order" ? "asc" : "desc";
}

function conditionLabel(value: BulkBuyRow["condition"]): string {
  if (value === "new") return "New";
  if (value === "both") return "New/Used";
  return "Used";
}

function categoryLabel(value: BulkBuyCategory): string {
  if (value === "high-end") return "High-end";
  if (value === "low-end bulk") return "Low-end bulk";
  return "Sellable";
}

function money(value: number, currency = "USD"): string {
  const roundedValue = roundedMoneyValue(value);
  return `${currency === "USD" ? "$" : `${currency} `}${roundedValue.toFixed(2)}`;
}

function tableWidth(widths: Record<ColumnKey, number>): number {
  return columns.reduce((total, column) => total + widths[column], 0);
}

function downloadBatchCsv(rows: BulkBuyRow[]) {
  const headers = [
    "order",
    "buy",
    "sell",
    "profit",
    "album",
    "new_or_used",
    "category",
    "reference_price",
    "fees",
    "taxes",
    "shipping_supplies",
    "input",
    "discogs_release_url",
    "scanned_at",
  ];
  const csvRows = rowsByOrder(rows).map((row) => ({
    album: row.artistTitle,
    buy: row.math ? roundedMoneyValue(row.math.purchasePrice) : "",
    category: row.math ? categoryLabel(row.math.category) : "Needs median",
    discogs_release_url: row.discogsReleaseUrl ?? "",
    fees: row.math ? roundedMoneyValue(row.math.estimatedFees) : "",
    input: row.inputLabel,
    new_or_used: conditionLabel(row.condition),
    order: row.order,
    profit: row.math ? roundedMoneyValue(row.math.estimatedProfit) : "",
    reference_price: row.math ? roundedMoneyValue(row.math.medianPrice) : "",
    scanned_at: row.scannedAt,
    sell: row.math ? roundedMoneyValue(row.math.bestCaseSalePrice) : "",
    shipping_supplies: row.math?.shippingSupplies ?? "",
    taxes: row.math ? roundedMoneyValue(row.math.estimatedTaxes) : "",
  }));
  const csv = [headers.map(csvEscape).join(","), ...csvRows.map((row) => headers.map((header) => csvEscape(row[header as keyof typeof row])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bulk-buy-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function batchLabel(batch: BulkBuyBatch): string {
  const date = new Date(batch.savedAt);
  const label = Number.isNaN(date.getTime()) ? batch.savedAt : date.toLocaleString();
  return `${batch.name || "Untitled batch"} - ${label} (${batch.rows.length})`;
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function roundedMoneyValue(value: number): number {
  return roundDownToHalfDollar(value);
}
