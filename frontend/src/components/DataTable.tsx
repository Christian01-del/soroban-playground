// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * DataTable – Issue #943
 *
 * A generic, accessible data table component for Soroban Playground.
 * Features:
 *  - Column definitions with optional custom renderers
 *  - Client-side sorting (asc / desc / none)
 *  - Empty state rendering
 *  - Loading state (delegates to LoadingSkeleton)
 *  - Error state with optional retry
 *  - Row-click callback
 *  - Accessible markup (role="table", scope, aria-sort)
 */

import React, { useCallback, useState } from "react";
import LoadingSkeleton from "./LoadingSkeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SortDirection = "asc" | "desc" | "none";

export interface ColumnDef<T> {
  /** Unique key matching a property on the data row (or used as id). */
  key: string;
  /** Column header label shown in <th>. */
  header: string;
  /** Whether this column can be sorted. Defaults to false. */
  sortable?: boolean;
  /** Custom cell renderer. Falls back to String(row[key]). */
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
  /** Optional CSS class applied to both <th> and <td>. */
  className?: string;
}

export interface DataTableProps<T extends Record<string, unknown>> {
  /** Column definitions. */
  columns: ColumnDef<T>[];
  /** Data rows. */
  data: T[];
  /** Whether the table is fetching data. */
  isLoading?: boolean;
  /** Error state. Displays error UI when truthy. */
  error?: Error | string | null;
  /** Called when the user clicks the Retry button in the error state. */
  onRetry?: () => void;
  /** Called when the user clicks a data row. */
  onRowClick?: (row: T, index: number) => void;
  /** Content rendered when data is empty (and not loading / errored). */
  emptyState?: React.ReactNode;
  /** Accessible label for the table element. */
  caption?: string;
  /** Optional CSS class on the root wrapper. */
  className?: string;
  /** Number of skeleton rows to show while loading. Defaults to 5. */
  skeletonRows?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNextDirection(current: SortDirection): SortDirection {
  if (current === "none") return "asc";
  if (current === "asc") return "desc";
  return "none";
}

function ariaSortValue(
  direction: SortDirection,
): "ascending" | "descending" | "none" {
  if (direction === "asc") return "ascending";
  if (direction === "desc") return "descending";
  return "none";
}

function sortData<T extends Record<string, unknown>>(
  data: T[],
  key: string,
  direction: SortDirection,
): T[] {
  if (direction === "none") return data;

  return [...data].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];

    // Numeric comparison
    if (typeof aVal === "number" && typeof bVal === "number") {
      return direction === "asc" ? aVal - bVal : bVal - aVal;
    }

    // String comparison (case-insensitive)
    const aStr = String(aVal ?? "").toLowerCase();
    const bStr = String(bVal ?? "").toLowerCase();
    if (aStr < bStr) return direction === "asc" ? -1 : 1;
    if (aStr > bStr) return direction === "asc" ? 1 : -1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DataTableInner<T extends Record<string, unknown>>({
  columns,
  data,
  isLoading = false,
  error = null,
  onRetry,
  onRowClick,
  emptyState,
  caption,
  className = "",
  skeletonRows = 5,
}: DataTableProps<T>): React.ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("none");

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        const next = getNextDirection(sortDirection);
        setSortDirection(next);
        if (next === "none") setSortKey(null);
      } else {
        setSortKey(key);
        setSortDirection("asc");
      }
    },
    [sortKey, sortDirection],
  );

  // --- Error state ---
  if (error) {
    return (
      <LoadingSkeleton
        error={error}
        onRetry={onRetry}
        isLoading={false}
        className={className}
      />
    );
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <LoadingSkeleton
        isLoading={true}
        rows={skeletonRows}
        ariaLabel="Loading table data"
        className={className}
      />
    );
  }

  const sortedData =
    sortKey && sortDirection !== "none"
      ? sortData(data, sortKey, sortDirection)
      : data;

  // --- Empty state ---
  if (sortedData.length === 0) {
    return (
      <div
        role="status"
        aria-label="No data available"
        data-testid="datatable-empty"
        className={className}
      >
        {emptyState ?? (
          <p
            style={{ textAlign: "center", color: "#6b7280", padding: "24px 0" }}
          >
            No data to display.
          </p>
        )}
      </div>
    );
  }

  // --- Populated table ---
  return (
    <div
      role="region"
      aria-label={caption ?? "Data table"}
      data-testid="datatable-root"
      className={className}
      style={{ overflowX: "auto" }}
    >
      <table
        role="table"
        aria-label={caption}
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        {caption && (
          <caption
            style={{ textAlign: "left", fontWeight: 600, marginBottom: "8px" }}
          >
            {caption}
          </caption>
        )}
        <thead>
          <tr role="row">
            {columns.map((col) => (
              <th
                key={col.key}
                role="columnheader"
                scope="col"
                aria-sort={
                  sortKey === col.key ? ariaSortValue(sortDirection) : "none"
                }
                className={col.className}
                style={{
                  padding: "10px 12px",
                  textAlign: "left",
                  fontWeight: 600,
                  fontSize: "13px",
                  borderBottom: "2px solid #e5e7eb",
                  cursor: col.sortable ? "pointer" : "default",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                }}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                onKeyDown={
                  col.sortable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSort(col.key);
                        }
                      }
                    : undefined
                }
                tabIndex={col.sortable ? 0 : undefined}
              >
                {col.header}
                {col.sortable && sortKey === col.key && (
                  <span aria-hidden="true" style={{ marginLeft: "4px" }}>
                    {sortDirection === "asc"
                      ? "▲"
                      : sortDirection === "desc"
                        ? "▼"
                        : ""}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              role="row"
              data-testid={`datatable-row-${rowIdx}`}
              onClick={onRowClick ? () => onRowClick(row, rowIdx) : undefined}
              style={{
                cursor: onRowClick ? "pointer" : "default",
                borderBottom: "1px solid #f3f4f6",
              }}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row, rowIdx);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  role="cell"
                  className={col.className}
                  style={{ padding: "10px 12px", fontSize: "14px" }}
                >
                  {col.render
                    ? col.render(row[col.key], row, rowIdx)
                    : String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Cast to preserve generics through default export
const DataTable = DataTableInner as typeof DataTableInner;
export default DataTable;
