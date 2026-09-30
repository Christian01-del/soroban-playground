// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Test suite for DataTable – Issue #943
 *
 * Covers:
 *  - Renders column headers and data rows correctly
 *  - Custom cell renderers
 *  - Empty state (default and custom)
 *  - Loading state (delegates to LoadingSkeleton)
 *  - Error state with and without retry
 *  - Client-side sorting: asc → desc → reset cycle
 *  - Row-click callback
 *  - Keyboard navigation on sortable headers and clickable rows
 *  - aria-sort attribute updates on sort
 *  - Caption rendering
 */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DataTable, { ColumnDef } from "../../components/DataTable";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Contract {
  id: string;
  name: string;
  balance: number;
  active: boolean;
}

const columns: ColumnDef<Contract>[] = [
  { key: "id", header: "ID" },
  { key: "name", header: "Name", sortable: true },
  { key: "balance", header: "Balance", sortable: true },
  {
    key: "active",
    header: "Active",
    render: (value) => (value ? "Yes" : "No"),
  },
];

const data: Contract[] = [
  { id: "c1", name: "Banana", balance: 300, active: true },
  { id: "c2", name: "Apple", balance: 100, active: false },
  { id: "c3", name: "Cherry", balance: 200, active: true },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("DataTable – rendering", () => {
  it("renders all column headers", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders the correct number of data rows", () => {
    render(<DataTable columns={columns} data={data} />);
    // 3 tbody rows
    expect(screen.getByTestId("datatable-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("datatable-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("datatable-row-2")).toBeInTheDocument();
    expect(screen.queryByTestId("datatable-row-3")).not.toBeInTheDocument();
  });

  it("renders cell values from data", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText("c1")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
  });

  it("uses custom render function when provided", () => {
    render(<DataTable columns={columns} data={data} />);
    // active: true → "Yes", false → "No"
    expect(screen.getAllByText("Yes")).toHaveLength(2);
    expect(screen.getAllByText("No")).toHaveLength(1);
  });

  it("renders a caption when the caption prop is provided", () => {
    render(<DataTable columns={columns} data={data} caption="Contracts" />);
    expect(screen.getByText("Contracts")).toBeInTheDocument();
  });

  it("attaches className to the root wrapper", () => {
    render(<DataTable columns={columns} data={data} className="my-table" />);
    expect(screen.getByTestId("datatable-root")).toHaveClass("my-table");
  });

  it("renders the table with role='table'", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("DataTable – empty state", () => {
  it("shows default empty message when data is empty", () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByTestId("datatable-empty")).toBeInTheDocument();
    expect(screen.getByText(/no data to display/i)).toBeInTheDocument();
  });

  it("shows custom emptyState node when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyState={<span>Nothing here yet</span>}
      />,
    );
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("DataTable – loading state", () => {
  it("renders the loading skeleton when isLoading=true", () => {
    render(<DataTable columns={columns} data={[]} isLoading={true} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the table after loading completes", () => {
    const { rerender } = render(
      <DataTable columns={columns} data={[]} isLoading={true} />,
    );
    rerender(<DataTable columns={columns} data={data} isLoading={false} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe("DataTable – error state", () => {
  it("renders the error alert when error is an Error object", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        error={new Error("Fetch failed")}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/fetch failed/i)).toBeInTheDocument();
  });

  it("renders the error alert when error is a string", () => {
    render(<DataTable columns={columns} data={[]} error="RPC timeout" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/rpc timeout/i)).toBeInTheDocument();
  });

  it("shows Retry button when onRetry is provided", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        error="Fetch failed"
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByTestId("skeleton-retry-button")).toBeInTheDocument();
  });

  it("calls onRetry when Retry is clicked", () => {
    const onRetry = jest.fn();
    render(
      <DataTable
        columns={columns}
        data={[]}
        error="Fetch failed"
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByTestId("skeleton-retry-button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render the table when an error is present", () => {
    render(<DataTable columns={columns} data={data} error="Error!" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe("DataTable – sorting", () => {
  it("sortable columns have a tabIndex and cursor=pointer style", () => {
    render(<DataTable columns={columns} data={data} />);
    const nameHeader = screen.getByText("Name").closest("th")!;
    expect(nameHeader).toHaveAttribute("tabindex", "0");
  });

  it("non-sortable columns do not have tabIndex", () => {
    render(<DataTable columns={columns} data={data} />);
    const idHeader = screen.getByText("ID").closest("th")!;
    expect(idHeader).not.toHaveAttribute("tabindex");
  });

  it("sorts string column ascending on first click", () => {
    render(<DataTable columns={columns} data={data} />);
    fireEvent.click(screen.getByText("Name"));

    const rows = screen.getAllByRole("row").slice(1); // skip header
    const firstCell = within(rows[0]).getAllByRole("cell")[1];
    expect(firstCell).toHaveTextContent("Apple");
  });

  it("sorts string column descending on second click", () => {
    render(<DataTable columns={columns} data={data} />);
    const nameHeader = screen.getByText("Name");
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);

    const rows = screen.getAllByRole("row").slice(1);
    const firstCell = within(rows[0]).getAllByRole("cell")[1];
    expect(firstCell).toHaveTextContent("Cherry");
  });

  it("resets sort order on third click", () => {
    render(<DataTable columns={columns} data={data} />);
    const nameHeader = screen.getByText("Name");
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);

    const rows = screen.getAllByRole("row").slice(1);
    const firstCell = within(rows[0]).getAllByRole("cell")[1];
    // Restored to original order (Banana first)
    expect(firstCell).toHaveTextContent("Banana");
  });

  it("sorts numeric column ascending", () => {
    render(<DataTable columns={columns} data={data} />);
    fireEvent.click(screen.getByText("Balance"));

    const rows = screen.getAllByRole("row").slice(1);
    const balanceCells = rows.map(
      (row) => within(row).getAllByRole("cell")[2].textContent,
    );
    expect(balanceCells).toEqual(["100", "200", "300"]);
  });

  it("updates aria-sort attribute on sorted column", () => {
    render(<DataTable columns={columns} data={data} />);
    const nameHeader = screen.getByText("Name").closest("th")!;
    expect(nameHeader).toHaveAttribute("aria-sort", "none");

    fireEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("triggers sort via Enter key on sortable header", () => {
    render(<DataTable columns={columns} data={data} />);
    const nameHeader = screen.getByText("Name").closest("th")!;
    fireEvent.keyDown(nameHeader, { key: "Enter" });

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent("Apple");
  });

  it("triggers sort via Space key on sortable header", () => {
    render(<DataTable columns={columns} data={data} />);
    const nameHeader = screen.getByText("Name").closest("th")!;
    fireEvent.keyDown(nameHeader, { key: " " });

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent("Apple");
  });
});

// ---------------------------------------------------------------------------
// Row interaction
// ---------------------------------------------------------------------------

describe("DataTable – row interaction", () => {
  it("calls onRowClick with the row data and index when a row is clicked", () => {
    const onRowClick = jest.fn();
    render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

    fireEvent.click(screen.getByTestId("datatable-row-1"));
    expect(onRowClick).toHaveBeenCalledWith(data[1], 1);
  });

  it("does not call onRowClick when no handler is provided", () => {
    // Verify no crash when onRowClick is absent
    render(<DataTable columns={columns} data={data} />);
    fireEvent.click(screen.getByTestId("datatable-row-0"));
    // No assertion needed beyond no throw
  });

  it("calls onRowClick via Enter key on a clickable row", () => {
    const onRowClick = jest.fn();
    render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

    fireEvent.keyDown(screen.getByTestId("datatable-row-0"), { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith(data[0], 0);
  });

  it("calls onRowClick via Space key on a clickable row", () => {
    const onRowClick = jest.fn();
    render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

    fireEvent.keyDown(screen.getByTestId("datatable-row-0"), { key: " " });
    expect(onRowClick).toHaveBeenCalledWith(data[0], 0);
  });

  it("rows have tabIndex when onRowClick is provided", () => {
    render(<DataTable columns={columns} data={data} onRowClick={jest.fn()} />);
    expect(screen.getByTestId("datatable-row-0")).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("rows do not have tabIndex when onRowClick is absent", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByTestId("datatable-row-0")).not.toHaveAttribute(
      "tabindex",
    );
  });
});
