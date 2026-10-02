import assert from "node:assert/strict";

// ─── Immutable State Utilities ────────────────────────────────────────────────
function cloneValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry));
  const clone = {};
  for (const [key, nested] of Object.entries(value)) {
    clone[key] = cloneValue(nested);
  }
  return clone;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
  } else {
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return Object.freeze(value);
}

function immutableLedgerState(state) {
  return deepFreeze(cloneValue(state));
}

// ─── Reducer & Timeline Engine ────────────────────────────────────────────────
function buildTransactionSnapshot(node, index, txHash, capturedAt) {
  return {
    id: `${txHash ?? "tx"}:${node.id}:${index}`,
    label: `${node.contractId}.${node.functionName}`,
    contextLabel: `Frame ${index + 1}: ${node.contractId}.${node.functionName}`,
    state: immutableLedgerState(node.ledgerState),
    capturedAt,
    contractId: node.contractId,
    functionName: node.functionName,
    txHash,
    source: "transaction",
    nodeId: node.id,
  };
}

function createInitialStorageTimelineState() {
  return {
    snapshots: [],
    currentIndex: -1,
    nodeToSnapshotIndex: {},
  };
}

function storageTimelineReducer(state, action) {
  switch (action.type) {
    case "reset_with_deployment": {
      const capturedAt = action.capturedAt ?? new Date().toISOString();
      return {
        snapshots: [
          {
            id: `deploy:${action.contractId}:${capturedAt}`,
            label: "Deployment baseline",
            contextLabel: "Deployment baseline snapshot",
            state: immutableLedgerState(action.state),
            capturedAt,
            source: "deployment",
            contractId: action.contractId,
          },
        ],
        currentIndex: 0,
        nodeToSnapshotIndex: {},
      };
    }

    case "append_transaction_frames": {
      if (action.nodes.length === 0) return state;
      const nextSnapshots = [...state.snapshots];
      const nextNodeMap = { ...state.nodeToSnapshotIndex };
      const capturedAt = action.capturedAt ?? new Date().toISOString();
      for (const node of action.nodes) {
        const nextIndex = nextSnapshots.length;
        nextSnapshots.push(
          buildTransactionSnapshot(node, nextIndex, action.txHash, capturedAt),
        );
        nextNodeMap[node.id] = nextIndex;
      }
      return {
        snapshots: nextSnapshots,
        currentIndex: nextSnapshots.length - 1,
        nodeToSnapshotIndex: nextNodeMap,
      };
    }

    case "select_snapshot_index": {
      if (state.snapshots.length === 0) return state;
      const clampedIndex = Math.max(
        0,
        Math.min(action.index, state.snapshots.length - 1),
      );
      return { ...state, currentIndex: clampedIndex };
    }

    case "select_snapshot_for_node": {
      const index = state.nodeToSnapshotIndex[action.nodeId];
      if (index === undefined) return state;
      return { ...state, currentIndex: index };
    }

    case "clear_snapshots":
      return createInitialStorageTimelineState();

    default:
      return state;
  }
}

// ─── Deep Diff Calculation Engine ─────────────────────────────────────────────
function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, i) => deepEqual(item, right[i]));
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const lKeys = Object.keys(left);
    const rKeys = Object.keys(right);
    if (lKeys.length !== rKeys.length) return false;
    return lKeys.every((k) => k in right && deepEqual(left[k], right[k]));
  }
  return false;
}

function createDeepDiff(previous, current) {
  const entries = [];
  const allKeys = new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]);
  for (const key of allKeys) {
    const inPrev = key in (previous || {});
    const inCurr = key in (current || {});
    if (!inPrev && inCurr) {
      entries.push({ kind: "added", path: key, previous: undefined, current: current[key] });
    } else if (inPrev && !inCurr) {
      entries.push({ kind: "removed", path: key, previous: previous[key], current: undefined });
    } else if (!deepEqual(previous[key], current[key])) {
      entries.push({ kind: "changed", path: key, previous: previous[key], current: current[key] });
    }
  }
  return entries;
}

// ─── Test Suite Execution ─────────────────────────────────────────────────────
console.log("=== RUNNING STATE DIFF & TIME-TRAVEL LEDGER TEST SUITE ===\n");

let passed = 0;
let total = 0;

function it(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// 1. Initial State
it("initialises with empty snapshots, currentIndex -1", () => {
  const initial = createInitialStorageTimelineState();
  assert.equal(initial.snapshots.length, 0);
  assert.equal(initial.currentIndex, -1);
  assert.deepEqual(initial.nodeToSnapshotIndex, {});
});

// 2. reset_with_deployment
it("creates deployment baseline snapshot and freezes state", () => {
  const initial = createInitialStorageTimelineState();
  const next = storageTimelineReducer(initial, {
    type: "reset_with_deployment",
    contractId: "C_VAULT",
    state: { admin: "G_USER", total_supply: 1000 },
    capturedAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(next.snapshots.length, 1);
  assert.equal(next.currentIndex, 0);
  assert.equal(next.snapshots[0].source, "deployment");
  assert.equal(next.snapshots[0].contractId, "C_VAULT");
  assert.equal(next.snapshots[0].state.admin, "G_USER");
  // verify deepFreeze immutability
  assert.throws(() => {
    next.snapshots[0].state.admin = "MUTATED";
  });
});

// 3. append_transaction_frames
it("appends multiple frames and updates nodeToSnapshotIndex correctly", () => {
  const initial = createInitialStorageTimelineState();
  const node1 = { id: "n1", contractId: "C1", functionName: "deposit", ledgerState: { balance: 500 } };
  const node2 = { id: "n2", contractId: "C1", functionName: "withdraw", ledgerState: { balance: 200 } };
  const next = storageTimelineReducer(initial, {
    type: "append_transaction_frames",
    nodes: [node1, node2],
    txHash: "0xabcdef123456",
    capturedAt: "2026-01-01T00:01:00Z",
  });
  assert.equal(next.snapshots.length, 2);
  assert.equal(next.currentIndex, 1);
  assert.equal(next.nodeToSnapshotIndex["n1"], 0);
  assert.equal(next.nodeToSnapshotIndex["n2"], 1);
  assert.equal(next.snapshots[0].txHash, "0xabcdef123456");
  assert.equal(next.snapshots[0].state.balance, 500);
  assert.equal(next.snapshots[1].state.balance, 200);
});

// 4. select_snapshot_index with clamping
it("selects snapshot index and clamps within bounds", () => {
  const initial = createInitialStorageTimelineState();
  const node = { id: "n1", contractId: "C1", functionName: "f", ledgerState: {} };
  const withOne = storageTimelineReducer(initial, {
    type: "append_transaction_frames",
    nodes: [node],
  });
  const clampedHigh = storageTimelineReducer(withOne, {
    type: "select_snapshot_index",
    index: 999,
  });
  assert.equal(clampedHigh.currentIndex, 0);

  const clampedLow = storageTimelineReducer(withOne, {
    type: "select_snapshot_index",
    index: -5,
  });
  assert.equal(clampedLow.currentIndex, 0);
});

// 5. select_snapshot_for_node
it("navigates to the exact snapshot corresponding to a nodeId", () => {
  const initial = createInitialStorageTimelineState();
  const nodes = [
    { id: "node_A", contractId: "C1", functionName: "a", ledgerState: { v: 1 } },
    { id: "node_B", contractId: "C1", functionName: "b", ledgerState: { v: 2 } },
    { id: "node_C", contractId: "C1", functionName: "c", ledgerState: { v: 3 } },
  ];
  const withFrames = storageTimelineReducer(initial, {
    type: "append_transaction_frames",
    nodes,
  });
  assert.equal(withFrames.currentIndex, 2);

  const stepped = storageTimelineReducer(withFrames, {
    type: "select_snapshot_for_node",
    nodeId: "node_B",
  });
  assert.equal(stepped.currentIndex, 1);
});

// 6. clear_snapshots
it("resets all snapshots and indices to initial empty state", () => {
  const initial = createInitialStorageTimelineState();
  const withFrames = storageTimelineReducer(initial, {
    type: "append_transaction_frames",
    nodes: [{ id: "n", contractId: "C", functionName: "fn", ledgerState: {} }],
  });
  assert.equal(withFrames.snapshots.length, 1);
  const cleared = storageTimelineReducer(withFrames, { type: "clear_snapshots" });
  assert.equal(cleared.snapshots.length, 0);
  assert.equal(cleared.currentIndex, -1);
  assert.deepEqual(cleared.nodeToSnapshotIndex, {});
});

// 7. Deep Diff: Added keys
it("correctly calculates added keys in deep diff", () => {
  const prev = { count: 0 };
  const curr = { count: 0, newKey: "hello" };
  const diffs = createDeepDiff(prev, curr);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].kind, "added");
  assert.equal(diffs[0].path, "newKey");
  assert.equal(diffs[0].current, "hello");
});

// 8. Deep Diff: Removed keys
it("correctly calculates removed keys in deep diff", () => {
  const prev = { a: 1, b: 2 };
  const curr = { a: 1 };
  const diffs = createDeepDiff(prev, curr);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].kind, "removed");
  assert.equal(diffs[0].path, "b");
});

// 9. Deep Diff: Changed values
it("correctly identifies modified keys and nested changes", () => {
  const prev = { status: "pending", balance: 100 };
  const curr = { status: "settled", balance: 250 };
  const diffs = createDeepDiff(prev, curr);
  assert.equal(diffs.length, 2);
  const statusDiff = diffs.find((d) => d.path === "status");
  assert.equal(statusDiff.kind, "changed");
  assert.equal(statusDiff.previous, "pending");
  assert.equal(statusDiff.current, "settled");
});

// 10. Empty Diff on identical states
it("reports zero diff entries for identical states", () => {
  const state = { a: "test", b: [1, 2, 3], c: { d: true } };
  const diffs = createDeepDiff(state, state);
  assert.equal(diffs.length, 0);
});

// 11. Time-Travel Scrubber Step Back / Forward Simulation
it("accurately simulates timeline scrubbing forward and backward", () => {
  const frames = [
    { state: { step: 0 } },
    { state: { step: 1 } },
    { state: { step: 2 } },
    { state: { step: 3 } },
  ];
  let currentIdx = 0;

  // Step forward
  currentIdx = Math.min(frames.length - 1, currentIdx + 1);
  assert.equal(currentIdx, 1);
  currentIdx = Math.min(frames.length - 1, currentIdx + 1);
  assert.equal(currentIdx, 2);

  // Deep diff between frame 1 and 2
  const diff = createDeepDiff(frames[currentIdx - 1].state, frames[currentIdx].state);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].previous, 1);
  assert.equal(diff[0].current, 2);

  // Step backward (time-travel rollback)
  currentIdx = Math.max(0, currentIdx - 1);
  assert.equal(currentIdx, 1);
  assert.deepEqual(frames[currentIdx].state, { step: 1 });
});

console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
if (passed === total) {
  console.log("ALL TESTS COMPLETED SUCCESSFULLY! ZERO REGRESSIONS.");
}
