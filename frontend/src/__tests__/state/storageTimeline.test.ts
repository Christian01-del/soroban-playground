import {
  storageTimelineReducer,
  createInitialStorageTimelineState,
  useStorageTimelineStore,
  type StorageTimelineState,
} from "../../state/storageTimeline";
import type { TransactionCallNode } from "../../utils/transactionGraph";

const BASE_LEDGER = { counter: 0 };

const makeNode = (
  id: string,
  ledgerState = BASE_LEDGER,
): TransactionCallNode => ({
  id,
  depth: 0,
  indexInDepth: 0,
  contractId: "CABC123",
  functionName: "call",
  argsSummary: "{}",
  ledgerState,
  raw: {},
});

describe("storageTimelineReducer (pure)", () => {
  let initial: StorageTimelineState;

  beforeEach(() => {
    initial = createInitialStorageTimelineState();
  });

  it("initialises with empty snapshots and index -1", () => {
    expect(initial.snapshots).toHaveLength(0);
    expect(initial.currentIndex).toBe(-1);
    expect(initial.nodeToSnapshotIndex).toEqual({});
  });

  describe("reset_with_deployment", () => {
    it("produces a single deployment baseline snapshot", () => {
      const next = storageTimelineReducer(initial, {
        type: "reset_with_deployment",
        contractId: "CABC123",
        state: { foo: "bar" },
        capturedAt: "2026-01-01T00:00:00.000Z",
      });

      expect(next.snapshots).toHaveLength(1);
      expect(next.currentIndex).toBe(0);
      expect(next.snapshots[0].source).toBe("deployment");
      expect(next.snapshots[0].state).toEqual({ foo: "bar" });
      expect(next.snapshots[0].contractId).toBe("CABC123");
      expect(next.nodeToSnapshotIndex).toEqual({});
    });

    it("resets existing snapshots when called again", () => {
      const withFrames = storageTimelineReducer(initial, {
        type: "append_transaction_frames",
        nodes: [makeNode("n1")],
      });
      const reset = storageTimelineReducer(withFrames, {
        type: "reset_with_deployment",
        contractId: "CABC999",
        state: {},
      });

      expect(reset.snapshots).toHaveLength(1);
      expect(reset.snapshots[0].contractId).toBe("CABC999");
    });
  });

  describe("append_transaction_frames", () => {
    it("appends snapshots and updates nodeToSnapshotIndex", () => {
      const node1 = makeNode("n1", { a: 1 });
      const node2 = makeNode("n2", { a: 1, b: 2 });

      const next = storageTimelineReducer(initial, {
        type: "append_transaction_frames",
        nodes: [node1, node2],
        txHash: "0xdeadbeef",
        capturedAt: "2026-01-01T00:00:00.000Z",
      });

      expect(next.snapshots).toHaveLength(2);
      expect(next.currentIndex).toBe(1);
      expect(next.nodeToSnapshotIndex["n1"]).toBe(0);
      expect(next.nodeToSnapshotIndex["n2"]).toBe(1);
      expect(next.snapshots[0].txHash).toBe("0xdeadbeef");
    });

    it("is a no-op when nodes is empty", () => {
      const next = storageTimelineReducer(initial, {
        type: "append_transaction_frames",
        nodes: [],
      });
      expect(next).toBe(initial);
    });
  });

  describe("select_snapshot_index", () => {
    it("updates currentIndex", () => {
      const withTwo = storageTimelineReducer(initial, {
        type: "append_transaction_frames",
        nodes: [makeNode("n1"), makeNode("n2")],
      });
      const selected = storageTimelineReducer(withTwo, {
        type: "select_snapshot_index",
        index: 0,
      });
      expect(selected.currentIndex).toBe(0);
    });

    it("clamps to valid range", () => {
      const withOne = storageTimelineReducer(initial, {
        type: "append_transaction_frames",
        nodes: [makeNode("n1")],
      });
      const clamped = storageTimelineReducer(withOne, {
        type: "select_snapshot_index",
        index: 999,
      });
      expect(clamped.currentIndex).toBe(0);
    });

    it("is a no-op when snapshots is empty", () => {
      const next = storageTimelineReducer(initial, {
        type: "select_snapshot_index",
        index: 2,
      });
      expect(next).toBe(initial);
    });
  });

  describe("select_snapshot_for_node", () => {
    it("moves to the snapshot for the given nodeId", () => {
      const withTwo = storageTimelineReducer(initial, {
        type: "append_transaction_frames",
        nodes: [makeNode("first"), makeNode("second")],
      });
      const selected = storageTimelineReducer(withTwo, {
        type: "select_snapshot_for_node",
        nodeId: "first",
      });
      expect(selected.currentIndex).toBe(0);
    });

    it("is a no-op for unknown nodeId", () => {
      const next = storageTimelineReducer(initial, {
        type: "select_snapshot_for_node",
        nodeId: "nonexistent",
      });
      expect(next).toBe(initial);
    });
  });

  describe("clear_snapshots", () => {
    it("resets state to initial", () => {
      const withData = storageTimelineReducer(initial, {
        type: "append_transaction_frames",
        nodes: [makeNode("n1")],
      });
      const cleared = storageTimelineReducer(withData, {
        type: "clear_snapshots",
      });
      expect(cleared.snapshots).toHaveLength(0);
      expect(cleared.currentIndex).toBe(-1);
      expect(cleared.nodeToSnapshotIndex).toEqual({});
    });
  });

  it("immutable snapshot state cannot be mutated", () => {
    const next = storageTimelineReducer(initial, {
      type: "reset_with_deployment",
      contractId: "CABC",
      state: { x: 1 },
    });
    expect(() => {
      (next.snapshots[0].state as Record<string, unknown>)["x"] = 99;
    }).toThrow();
  });
});

describe("useStorageTimelineStore (Zustand)", () => {
  beforeEach(() => {
    useStorageTimelineStore.getState().clearSnapshots();
  });

  it("initialises empty", () => {
    const { snapshots, currentIndex } = useStorageTimelineStore.getState();
    expect(snapshots).toHaveLength(0);
    expect(currentIndex).toBe(-1);
  });

  it("resetWithDeployment creates baseline snapshot", () => {
    useStorageTimelineStore
      .getState()
      .resetWithDeployment("CABC", { bal: 0 }, "2026-01-01T00:00:00.000Z");
    const { snapshots, currentIndex } = useStorageTimelineStore.getState();
    expect(snapshots).toHaveLength(1);
    expect(currentIndex).toBe(0);
    expect(snapshots[0].source).toBe("deployment");
  });

  it("appendTransactionFrames adds and selects last snapshot", () => {
    useStorageTimelineStore
      .getState()
      .appendTransactionFrames(
        [makeNode("a"), makeNode("b")],
        "0xhash",
        "2026-01-01T00:00:00.000Z",
      );
    const { snapshots, currentIndex, nodeToSnapshotIndex } =
      useStorageTimelineStore.getState();
    expect(snapshots).toHaveLength(2);
    expect(currentIndex).toBe(1);
    expect(nodeToSnapshotIndex["a"]).toBe(0);
    expect(nodeToSnapshotIndex["b"]).toBe(1);
  });

  it("selectSnapshotIndex clamps to bounds", () => {
    useStorageTimelineStore
      .getState()
      .appendTransactionFrames([makeNode("x")]);
    useStorageTimelineStore.getState().selectSnapshotIndex(999);
    expect(useStorageTimelineStore.getState().currentIndex).toBe(0);
  });

  it("selectSnapshotForNode resolves the correct index", () => {
    useStorageTimelineStore
      .getState()
      .appendTransactionFrames([makeNode("first"), makeNode("second")]);
    useStorageTimelineStore.getState().selectSnapshotForNode("first");
    expect(useStorageTimelineStore.getState().currentIndex).toBe(0);
  });

  it("clearSnapshots resets state", () => {
    useStorageTimelineStore
      .getState()
      .appendTransactionFrames([makeNode("n")]);
    useStorageTimelineStore.getState().clearSnapshots();
    const { snapshots, currentIndex } = useStorageTimelineStore.getState();
    expect(snapshots).toHaveLength(0);
    expect(currentIndex).toBe(-1);
  });

  it("reduce delegates to pure reducer", () => {
    const state = createInitialStorageTimelineState();
    const result = useStorageTimelineStore
      .getState()
      .reduce(state, { type: "clear_snapshots" });
    expect(result.snapshots).toHaveLength(0);
  });
});
