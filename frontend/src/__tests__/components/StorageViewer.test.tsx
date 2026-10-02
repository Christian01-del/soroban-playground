import { render, screen } from "@testing-library/react";
import StorageViewer from "../../components/StorageViewer";
import type { LedgerState } from "../../utils/transactionGraph";

const onScrub = jest.fn();

const baseProps = {
  totalFrames: 1,
  currentFrame: 0,
  onScrubTimeline: onScrub,
};

describe("StorageViewer", () => {
  beforeEach(() => onScrub.mockClear());

  it("renders Contract Storage header", () => {
    render(<StorageViewer storage={{}} {...baseProps} />);
    expect(screen.getByText(/contract storage/i)).toBeInTheDocument();
  });

  it("shows empty state message when storage is empty", () => {
    render(<StorageViewer storage={{}} {...baseProps} />);
    expect(
      screen.getByText(/storage is empty or inaccessible/i),
    ).toBeInTheDocument();
  });

  it("renders storage keys and values", () => {
    const storage: LedgerState = { counter: 42, admin: "GABC" };
    render(<StorageViewer storage={storage} {...baseProps} />);
    expect(screen.getByText("counter")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("GABC")).toBeInTheDocument();
  });

  it("shows contextLabel when provided", () => {
    render(
      <StorageViewer storage={{}} contextLabel="Frame 1" {...baseProps} />,
    );
    expect(screen.getByText("Frame 1")).toBeInTheDocument();
  });

  it("shows no-change message in deep diff when storage matches previous", () => {
    const storage: LedgerState = { x: 1 };
    render(
      <StorageViewer
        storage={storage}
        previousStorage={storage}
        {...baseProps}
      />,
    );
    expect(
      screen.getByText(/no changes from previous frame/i),
    ).toBeInTheDocument();
  });

  it("shows added diff count when a key is new", () => {
    const prev: LedgerState = { a: 1 };
    const curr: LedgerState = { a: 1, b: 2 };
    render(
      <StorageViewer storage={curr} previousStorage={prev} {...baseProps} />,
    );
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("shows removed diff count when a key was deleted", () => {
    const prev: LedgerState = { a: 1, b: 2 };
    const curr: LedgerState = { a: 1 };
    render(
      <StorageViewer storage={curr} previousStorage={prev} {...baseProps} />,
    );
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("shows changed diff count when a value changes", () => {
    const prev: LedgerState = { a: 1 };
    const curr: LedgerState = { a: 99 };
    render(
      <StorageViewer storage={curr} previousStorage={prev} {...baseProps} />,
    );
    expect(screen.getByText("~1")).toBeInTheDocument();
  });

  it("renders diff table with Path / Before / After columns", () => {
    const prev: LedgerState = { x: 10 };
    const curr: LedgerState = { x: 20 };
    render(
      <StorageViewer storage={curr} previousStorage={prev} {...baseProps} />,
    );
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
  });

  it("shows ∅ in Before column for added entries", () => {
    const prev: LedgerState = {};
    const curr: LedgerState = { newKey: "val" };
    render(
      <StorageViewer storage={curr} previousStorage={prev} {...baseProps} />,
    );
    expect(screen.getByText("∅")).toBeInTheDocument();
  });

  it("shows ∅ in After column for removed entries", () => {
    const prev: LedgerState = { gone: "bye" };
    const curr: LedgerState = {};
    render(
      <StorageViewer storage={curr} previousStorage={prev} {...baseProps} />,
    );
    const empties = screen.getAllByText("∅");
    expect(empties.length).toBeGreaterThan(0);
  });

  it("renders StorageTimeline inside the viewer", () => {
    render(
      <StorageViewer
        storage={{ k: 1 }}
        totalFrames={3}
        currentFrame={1}
        onScrubTimeline={onScrub}
      />,
    );
    expect(screen.getByText(/ledger timeline/i)).toBeInTheDocument();
  });

  it("handles nested object diffs correctly", () => {
    const prev: LedgerState = { nested: { a: 1, b: 2 } };
    const curr: LedgerState = { nested: { a: 1, b: 99 } };
    render(
      <StorageViewer storage={curr} previousStorage={prev} {...baseProps} />,
    );
    expect(screen.getByText("~1")).toBeInTheDocument();
  });
});
