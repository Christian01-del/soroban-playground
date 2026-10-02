import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import StorageViewer from "@/components/StorageViewer";
import type { LedgerState } from "@/utils/transactionGraph";

jest.mock("@/components/StorageTimeline", () => {
  return function MockStorageTimeline({
    totalFrames,
    currentFrame,
    contextLabel,
    onScrub,
  }: {
    totalFrames: number;
    currentFrame: number;
    contextLabel?: string;
    onScrub: (index: number) => void;
  }) {
    return (
      <div data-testid="storage-timeline">
        <span data-testid="timeline-context">{contextLabel ?? "none"}</span>
        <span data-testid="timeline-position">
          {currentFrame}/{totalFrames}
        </span>
        <button type="button" onClick={() => onScrub(1)}>
          scrub to 1
        </button>
      </div>
    );
  };
});

const CONTRACT_ID = "C".repeat(56);

function renderViewer(overrides: Partial<React.ComponentProps<typeof StorageViewer>> = {}) {
  const props: React.ComponentProps<typeof StorageViewer> = {
    storage: {} as LedgerState,
    totalFrames: 3,
    currentFrame: 0,
    onScrubTimeline: jest.fn(),
    ...overrides,
  };

  return { ...render(<StorageViewer {...props} />), props };
}

/** Locate the main storage table, i.e. the one that is not the diff table. */
function storageTable(): HTMLElement {
  const tables = screen.getAllByRole("table");
  return tables[0];
}

function diffTable(): HTMLElement | null {
  const tables = screen.getAllByRole("table");
  return tables.length > 1 ? tables[1] : null;
}

describe("StorageViewer - empty state", () => {
  it("shows the empty message when storage has no entries", () => {
    renderViewer({ storage: {} as LedgerState });

    expect(screen.getByText(/storage is empty or inaccessible/i)).toBeInTheDocument();
  });

  it("does not render the storage table when empty", () => {
    renderViewer({ storage: {} as LedgerState });

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("always renders the timeline", () => {
    renderViewer({ storage: {} as LedgerState, totalFrames: 5, currentFrame: 2 });

    expect(screen.getByTestId("timeline-position")).toHaveTextContent("2/5");
  });
});

describe("StorageViewer - key/value rendering", () => {
  it("renders each storage key and value in a table row", () => {
    renderViewer({
      storage: { total_supply: 1000n, admin: CONTRACT_ID } as unknown as LedgerState,
    });

    const table = within(storageTable());
    expect(table.getByText("admin")).toBeInTheDocument();
    expect(table.getByText("total_supply")).toBeInTheDocument();
    expect(table.getByText("1000")).toBeInTheDocument();
  });

  it("labels the columns", () => {
    renderViewer({ storage: { admin: "G1" } as unknown as LedgerState });

    const table = within(storageTable());
    expect(table.getByRole("columnheader", { name: /key/i })).toBeInTheDocument();
    expect(table.getByRole("columnheader", { name: /value/i })).toBeInTheDocument();
    expect(table.getByRole("columnheader", { name: /diff/i })).toBeInTheDocument();
  });

  it("sorts keys alphabetically for a stable read order", () => {
    renderViewer({
      storage: { zebra: 1, alpha: 2, mango: 3 } as unknown as LedgerState,
    });

    // Each row is [key, value, diff]; only the key cell is of interest.
    const keys = within(storageTable())
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);

    expect(keys).toEqual(["alpha", "mango", "zebra"]);
  });

  it("pretty-prints object values", () => {
    renderViewer({
      storage: { config: { admin: "G1", paused: false } } as unknown as LedgerState,
    });

    expect(storageTable()).toHaveTextContent('"admin": "G1"');
    expect(storageTable()).toHaveTextContent('"paused": false');
  });

  it("renders null and undefined distinctly", () => {
    renderViewer({
      storage: { missing: null, absent: undefined } as unknown as LedgerState,
    });

    const table = storageTable();
    expect(table).toHaveTextContent("null");
    expect(table).toHaveTextContent("undefined");
  });

  it("truncates a very long value instead of flooding the panel", () => {
    const long = "x".repeat(900);
    renderViewer({ storage: { blob: long } as unknown as LedgerState });

    const cell = within(storageTable()).getByText(/…/);
    expect(cell.textContent).not.toContain("x".repeat(900));
  });

  it("abbreviates a long hex value with its byte length", () => {
    const hex = `0x${"a".repeat(200)}`;
    renderViewer({ storage: { blob: hex } as unknown as LedgerState });

    expect(storageTable()).toHaveTextContent(/\[100 bytes hex\]/);
  });

  it("falls back to a marker for an unserializable value", () => {
    const cyclic: Record<string, unknown> = { self: null };
    cyclic.self = cyclic;

    renderViewer({ storage: { bad: cyclic } as unknown as LedgerState });

    expect(storageTable()).toHaveTextContent("[unserializable]");
  });
});

describe("StorageViewer - top-level diff column", () => {
  it("marks a key added between frames", () => {
    renderViewer({
      previousStorage: {} as LedgerState,
      storage: { admin: "G1" } as unknown as LedgerState,
    });

    const row = within(storageTable()).getByText("admin").closest("tr")!;
    expect(within(row).getByText("added")).toBeInTheDocument();
  });

  it("marks a key removed between frames", () => {
    renderViewer({
      previousStorage: { admin: "G1" } as unknown as LedgerState,
      storage: {} as LedgerState,
    });

    // A removed key has no row, so the count is the only signal.
    expect(screen.getByText(/frame diff \(deep\)/i)).toBeInTheDocument();
  });

  it("marks a changed key", () => {
    renderViewer({
      previousStorage: { count: 1 } as unknown as LedgerState,
      storage: { count: 2 } as unknown as LedgerState,
    });

    const row = within(storageTable()).getByText("count").closest("tr")!;
    expect(within(row).getByText("changed")).toBeInTheDocument();
  });

  it("marks an untouched key as unchanged", () => {
    renderViewer({
      previousStorage: { count: 1 } as unknown as LedgerState,
      storage: { count: 1 } as unknown as LedgerState,
    });

    const row = within(storageTable()).getByText("count").closest("tr")!;
    expect(within(row).getByText("unchanged")).toBeInTheDocument();
  });

  it("treats structurally equal objects as unchanged", () => {
    renderViewer({
      previousStorage: { config: { a: 1, b: [1, 2] } } as unknown as LedgerState,
      storage: { config: { a: 1, b: [1, 2] } } as unknown as LedgerState,
    });

    const row = within(storageTable()).getByText("config").closest("tr")!;
    expect(within(row).getByText("unchanged")).toBeInTheDocument();
  });
});

describe("StorageViewer - deep frame diff", () => {
  it("shows the no-change message when the frames match", () => {
    renderViewer({
      previousStorage: { count: 1 } as unknown as LedgerState,
      storage: { count: 1 } as unknown as LedgerState,
    });

    expect(screen.getByText(/no changes from previous frame/i)).toBeInTheDocument();
  });

  it("renders a row per deep change with before and after values", () => {
    renderViewer({
      previousStorage: { count: 1 } as unknown as LedgerState,
      storage: { count: 2 } as unknown as LedgerState,
    });

    const table = within(diffTable()!);
    expect(table.getByText("count")).toBeInTheDocument();
    expect(table.getByText("1")).toBeInTheDocument();
    expect(table.getByText("2")).toBeInTheDocument();
  });

  it("diffs nested object keys by path", () => {
    renderViewer({
      previousStorage: { config: { paused: false } } as unknown as LedgerState,
      storage: { config: { paused: true } } as unknown as LedgerState,
    });

    expect(within(diffTable()!).getByText("config.paused")).toBeInTheDocument();
  });

  it("diffs array elements by index", () => {
    renderViewer({
      previousStorage: { items: ["a", "b"] } as unknown as LedgerState,
      storage: { items: ["a", "c"] } as unknown as LedgerState,
    });

    expect(within(diffTable()!).getByText("items[1]")).toBeInTheDocument();
  });

  it("uses a root path when the whole value is added", () => {
    renderViewer({
      previousStorage: {} as LedgerState,
      storage: { admin: "G1" } as unknown as LedgerState,
    });

    expect(within(diffTable()!).getByText("admin")).toBeInTheDocument();
  });

  it("shows the null placeholder on the added side", () => {
    renderViewer({
      previousStorage: {} as LedgerState,
      storage: { admin: "G1" } as unknown as LedgerState,
    });

    const table = within(diffTable()!);
    expect(table.getAllByText("∅").length).toBeGreaterThan(0);
  });

  it("summarises added, removed and changed counts", () => {
    renderViewer({
      previousStorage: { keep: 1, drop: 2, change: 3 } as unknown as LedgerState,
      storage: { keep: 1, change: 9, gain: 4 } as unknown as LedgerState,
    });

    // The counts are three separate coloured spans, so the summary is read
    // from the text node that follows the "Frame Diff" heading.
    const [added, removed, changed] = screen
      .getAllByText(/^[+~-]\d+$/)
      .map((element) => element.textContent);

    expect(added).toBe("+1");
    expect(removed).toBe("-1");
    expect(changed).toBe("~1");
  });

  it("reports zero counts when nothing changed", () => {
    renderViewer({
      previousStorage: { a: 1 } as unknown as LedgerState,
      storage: { a: 1 } as unknown as LedgerState,
    });

    const counts = screen.getAllByText(/^[+~-]\d+$/).map((element) => element.textContent);

    expect(counts).toEqual(["+0", "-0", "~0"]);
  });

  it("handles a circular previous value without throwing", () => {
    const previous: Record<string, unknown> = { self: null };
    previous.self = previous;

    expect(() =>
      renderViewer({
        previousStorage: previous as unknown as LedgerState,
        storage: { count: 1 } as unknown as LedgerState,
      }),
    ).not.toThrow();
  });
});

describe("StorageViewer - context and timeline", () => {
  it("renders the context label when provided", () => {
    renderViewer({
      storage: { a: 1 } as unknown as LedgerState,
      contextLabel: "after increment()",
    });

    // Shown both above the table and inside the timeline, so assert on presence.
    expect(screen.getAllByText("after increment()").length).toBeGreaterThan(0);
  });

  it("omits the context label when absent", () => {
    renderViewer({ storage: { a: 1 } as unknown as LedgerState });

    expect(screen.queryByText(/after increment/)).not.toBeInTheDocument();
  });

  it("forwards the scrub callback to the timeline", () => {
    const onScrubTimeline = jest.fn();
    renderViewer({ onScrubTimeline });

    fireEvent.click(screen.getByRole("button", { name: /scrub to 1/i }));

    expect(onScrubTimeline).toHaveBeenCalledWith(1);
  });

  it("passes the captured frame through to the timeline", () => {
    renderViewer({
      storage: { a: 1 } as unknown as LedgerState,
      totalFrames: 4,
      currentFrame: 3,
    });

    expect(screen.getByTestId("timeline-position")).toHaveTextContent("3/4");
  });
});

describe("StorageViewer - accessibility", () => {
  it("associates the heading with the panel", () => {
    renderViewer({ storage: { a: 1 } as unknown as LedgerState });

    expect(screen.getByRole("heading", { name: /contract storage/i })).toBeInTheDocument();
  });

  it("gives both tables a header row", () => {
    renderViewer({
      previousStorage: { a: 1 } as unknown as LedgerState,
      storage: { a: 2 } as unknown as LedgerState,
    });

    screen.getAllByRole("table").forEach((table) => {
      expect(within(table).getAllByRole("columnheader").length).toBeGreaterThan(0);
    });
  });
});
