import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import StorageViewer from "@/components/StorageViewer";
import StorageTree, { type StorageEntry } from "@/components/StorageTree";
import type { LedgerState } from "@/utils/transactionGraph";

// ─── StorageViewer ────────────────────────────────────────────────────────────

const noop = () => {};

describe("StorageViewer", () => {
  it("renders the Contract Storage heading", () => {
    render(
      <StorageViewer
        storage={{}}
        totalFrames={1}
        currentFrame={0}
        onScrubTimeline={noop}
      />,
    );
    expect(screen.getByText(/contract storage/i)).toBeInTheDocument();
  });

  it("shows empty-state message when storage is empty", () => {
    render(
      <StorageViewer
        storage={{}}
        totalFrames={1}
        currentFrame={0}
        onScrubTimeline={noop}
      />,
    );
    expect(screen.getByText(/empty or inaccessible/i)).toBeInTheDocument();
  });

  it("renders storage key-value rows", () => {
    const storage: LedgerState = { counter: 42, owner: "GABC" };
    render(
      <StorageViewer
        storage={storage}
        totalFrames={1}
        currentFrame={0}
        onScrubTimeline={noop}
      />,
    );
    expect(screen.getAllByText("counter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("owner").length).toBeGreaterThan(0);
  });

  it("renders contextLabel when provided", () => {
    render(
      <StorageViewer
        storage={{ x: 1 }}
        contextLabel="invoke #3"
        totalFrames={1}
        currentFrame={0}
        onScrubTimeline={noop}
      />,
    );
    expect(screen.getAllByText("invoke #3").length).toBeGreaterThan(0);
  });

  it("shows diff summary counts", () => {
    const prev: LedgerState = { a: 1 };
    const curr: LedgerState = { a: 2, b: 99 };
    render(
      <StorageViewer
        storage={curr}
        previousStorage={prev}
        totalFrames={2}
        currentFrame={1}
        onScrubTimeline={noop}
      />,
    );
    // +1 added (b), ~1 changed (a)
    expect(screen.getByText(/\+1/)).toBeInTheDocument();
    expect(screen.getByText(/~1/)).toBeInTheDocument();
  });

  it("shows 'No changes from previous frame' when storage is identical", () => {
    const storage: LedgerState = { x: 10 };
    render(
      <StorageViewer
        storage={storage}
        previousStorage={storage}
        totalFrames={2}
        currentFrame={1}
        onScrubTimeline={noop}
      />,
    );
    expect(
      screen.getByText(/no changes from previous frame/i),
    ).toBeInTheDocument();
  });

  it("calls onScrubTimeline when timeline slider changes", () => {
    const onScrub = jest.fn();
    render(
      <StorageViewer
        storage={{ x: 1 }}
        totalFrames={5}
        currentFrame={2}
        onScrubTimeline={onScrub}
      />,
    );
    fireEvent.change(screen.getByLabelText(/storage timeline slider/i), {
      target: { value: "4" },
    });
    expect(onScrub).toHaveBeenCalledWith(4);
  });

  it("marks added keys with 'added' diff label", () => {
    render(
      <StorageViewer
        storage={{ newKey: "hello" }}
        previousStorage={{}}
        totalFrames={2}
        currentFrame={1}
        onScrubTimeline={noop}
      />,
    );
    expect(screen.getAllByText("added").length).toBeGreaterThan(0);
  });

  it("marks removed keys with 'removed' diff label", () => {
    render(
      <StorageViewer
        storage={{}}
        previousStorage={{ gone: true }}
        totalFrames={2}
        currentFrame={1}
        onScrubTimeline={noop}
      />,
    );
    // removed key appears in deep diff table
    expect(screen.getByText("gone")).toBeInTheDocument();
  });

  it("truncates long hex values in the value column", () => {
    const longHex = `0x${"ab".repeat(40)}`;
    render(
      <StorageViewer
        storage={{ hash: longHex }}
        totalFrames={1}
        currentFrame={0}
        onScrubTimeline={noop}
      />,
    );
    expect(screen.getAllByText(/…/).length).toBeGreaterThan(0);
  });
});

// ─── StorageTree ──────────────────────────────────────────────────────────────

describe("StorageTree", () => {
  it("renders empty-state when entries array is empty", () => {
    render(<StorageTree entries={[]} />);
    expect(screen.getByText(/no storage entries match/i)).toBeInTheDocument();
  });

  it("renders a flat primitive entry", () => {
    const entries: StorageEntry[] = [
      { key: "balance", value: 500, diff: "unchanged" },
    ];
    render(<StorageTree entries={entries} />);
    expect(screen.getByText("balance")).toBeInTheDocument();
  });

  it("renders an expandable object entry with toggle", () => {
    const entries: StorageEntry[] = [
      { key: "config", value: { fee: 10, active: true }, diff: "unchanged" },
    ];
    render(<StorageTree entries={entries} />);
    const toggle = screen.getByRole("button");
    expect(toggle).toBeInTheDocument();

    // expand — child keys become visible
    fireEvent.click(toggle);
    expect(screen.getByText(/^fee:?$/)).toBeInTheDocument();

    // collapse — child keys hidden again
    fireEvent.click(toggle);
    expect(screen.queryByText(/^fee:?$/)).not.toBeInTheDocument();
  });

  it("renders an expandable array entry", () => {
    const entries: StorageEntry[] = [
      { key: "items", value: ["alpha", "beta"], diff: "unchanged" },
    ];
    render(<StorageTree entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: /items/i }));
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("applies added diff styling", () => {
    const entries: StorageEntry[] = [
      { key: "newField", value: 1, diff: "added" },
    ];
    const { container } = render(<StorageTree entries={entries} />);
    expect(
      container.querySelector(".border-emerald-500\\/60"),
    ).toBeInTheDocument();
  });

  it("applies removed diff styling", () => {
    const entries: StorageEntry[] = [
      { key: "oldField", value: 0, diff: "removed" },
    ];
    const { container } = render(<StorageTree entries={entries} />);
    expect(
      container.querySelector(".border-rose-500\\/60"),
    ).toBeInTheDocument();
  });

  it("applies changed diff styling", () => {
    const entries: StorageEntry[] = [
      { key: "mutated", value: 99, diff: "changed" },
    ];
    const { container } = render(<StorageTree entries={entries} />);
    expect(
      container.querySelector(".border-amber-500\\/60"),
    ).toBeInTheDocument();
  });

  it("renders multiple entries", () => {
    const entries: StorageEntry[] = [
      { key: "a", value: 1, diff: "unchanged" },
      { key: "b", value: 2, diff: "added" },
      { key: "c", value: 3, diff: "removed" },
    ];
    render(<StorageTree entries={entries} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });
});
