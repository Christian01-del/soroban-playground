import { render, screen, fireEvent, act } from "@testing-library/react";
import StorageStateDiffDebugger from "../../components/StorageStateDiffDebugger";
import { useStorageTimelineStore } from "../../state/storageTimeline";
import type { TransactionCallNode } from "../../utils/transactionGraph";

jest.useFakeTimers();

const makeNode = (
  id: string,
  ledgerState = {},
): TransactionCallNode => ({
  id,
  depth: 0,
  indexInDepth: 0,
  contractId: "CABC",
  functionName: "fn",
  argsSummary: "{}",
  ledgerState,
  raw: {},
});

describe("StorageStateDiffDebugger", () => {
  beforeEach(() => {
    useStorageTimelineStore.getState().clearSnapshots();
    jest.clearAllTimers();
  });

  it("renders the component title", () => {
    render(<StorageStateDiffDebugger />);
    expect(
      screen.getByText(/time-travel debugger/i),
    ).toBeInTheDocument();
  });

  it("shows (demo) badge when store is empty", () => {
    render(<StorageStateDiffDebugger />);
    expect(screen.getByText("(demo)")).toBeInTheDocument();
  });

  it("hides (demo) badge when store has live snapshots", () => {
    useStorageTimelineStore
      .getState()
      .resetWithDeployment("CABC", { x: 1 }, "2026-01-01T00:00:00.000Z");
    render(<StorageStateDiffDebugger />);
    expect(screen.queryByText("(demo)")).not.toBeInTheDocument();
  });

  it("renders Frame 1 / N counter in demo mode", () => {
    render(<StorageStateDiffDebugger />);
    expect(screen.getByText(/frame 1 \/ \d+/i)).toBeInTheDocument();
  });

  it("prev button is disabled at first frame", () => {
    render(<StorageStateDiffDebugger />);
    const prevBtn = screen.getByTitle("Step backward");
    expect(prevBtn).toBeDisabled();
  });

  it("next button advances the frame", () => {
    render(<StorageStateDiffDebugger />);
    const nextBtn = screen.getByTitle("Step forward");
    fireEvent.click(nextBtn);
    expect(screen.getByText(/frame 2 \/ \d+/i)).toBeInTheDocument();
  });

  it("reset button returns to frame 1", () => {
    render(<StorageStateDiffDebugger />);
    fireEvent.click(screen.getByTitle("Step forward"));
    fireEvent.click(screen.getByTitle("Reset to initial frame"));
    expect(screen.getByText(/frame 1 \/ \d+/i)).toBeInTheDocument();
  });

  it("play button auto-advances frames", () => {
    render(<StorageStateDiffDebugger />);
    fireEvent.click(screen.getByRole("button", { name: /play playback/i }));
    act(() => jest.advanceTimersByTime(1200));
    expect(screen.getByText(/frame 2 \/ \d+/i)).toBeInTheDocument();
  });

  it("play stops automatically at last frame", () => {
    render(<StorageStateDiffDebugger />);
    fireEvent.click(screen.getByRole("button", { name: /play playback/i }));
    act(() => jest.advanceTimersByTime(1200 * 10));
    expect(
      screen.queryByRole("button", { name: /pause playback/i }),
    ).not.toBeInTheDocument();
  });

  it("search filters visible storage keys", () => {
    useStorageTimelineStore
      .getState()
      .resetWithDeployment(
        "CABC",
        { counter: 1, admin: "GA123" },
        "2026-01-01T00:00:00.000Z",
      );
    render(<StorageStateDiffDebugger />);
    const search = screen.getByPlaceholderText(/search storage key/i);
    fireEvent.change(search, { target: { value: "counter" } });
    expect(screen.getByText("counter")).toBeInTheDocument();
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });

  it("shows clear button only when store has live snapshots", () => {
    render(<StorageStateDiffDebugger />);
    expect(
      screen.queryByRole("button", { name: /clear snapshots/i }),
    ).not.toBeInTheDocument();

    useStorageTimelineStore
      .getState()
      .resetWithDeployment("CABC", {}, "2026-01-01T00:00:00.000Z");
    const { rerender } = render(<StorageStateDiffDebugger />);
    rerender(<StorageStateDiffDebugger />);
    expect(
      screen.getAllByRole("button", { name: /clear snapshots/i })[0],
    ).toBeInTheDocument();
  });

  it("category filter 'all' shows all frames", () => {
    useStorageTimelineStore.getState().appendTransactionFrames([
      makeNode("a", { k: 1 }),
      makeNode("b", { k: 2 }),
    ]);
    render(<StorageStateDiffDebugger />);
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(screen.getByText(/frame 2 \/ 2/i)).toBeInTheDocument();
  });

  it("timeline slider scrubs to the correct frame", () => {
    render(<StorageStateDiffDebugger />);
    const slider = screen.getByRole("slider", {
      name: /storage timeline slider/i,
    });
    fireEvent.change(slider, { target: { value: "2" } });
    expect(screen.getByText(/frame 3 \/ \d+/i)).toBeInTheDocument();
  });
});
