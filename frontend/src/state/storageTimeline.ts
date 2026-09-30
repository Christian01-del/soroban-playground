import { create } from "zustand";
import type {
  LedgerState,
  TransactionCallNode,
} from "@/utils/transactionGraph";
import {
  cloneValue,
  deepFreeze,
  immutableLedgerState,
} from "@/utils/immutableState";

export interface StorageSnapshot {
  id: string;
  label: string;
  contextLabel: string;
  state: LedgerState;
  capturedAt: string;
  contractId?: string;
  functionName?: string;
  txHash?: string;
  source: "deployment" | "transaction";
  nodeId?: string;
}

export interface StorageTimelineState {
  snapshots: StorageSnapshot[];
  currentIndex: number;
  nodeToSnapshotIndex: Record<string, number>;
}

export type StorageTimelineAction =
  | {
      type: "reset_with_deployment";
      contractId: string;
      state: LedgerState;
      capturedAt?: string;
    }
  | {
      type: "append_transaction_frames";
      nodes: TransactionCallNode[];
      txHash?: string;
      capturedAt?: string;
    }
  | {
      type: "select_snapshot_index";
      index: number;
    }
  | {
      type: "select_snapshot_for_node";
      nodeId: string;
    };

function buildTransactionSnapshot(
  node: TransactionCallNode,
  index: number,
  txHash: string | undefined,
  capturedAt: string,
): StorageSnapshot {
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

export function createInitialStorageTimelineState(): StorageTimelineState {
  return {
    snapshots: [],
    currentIndex: -1,
    nodeToSnapshotIndex: {},
  };
}

export function storageTimelineReducer(
  state: StorageTimelineState,
  action: StorageTimelineAction,
): StorageTimelineState {
  return useStorageTimelineStore.getState().reduce(state, action);
}

interface StorageTimelineActions {
  resetWithDeployment: (
    contractId: string,
    state: LedgerState,
    capturedAt?: string,
  ) => void;
  appendTransactionFrames: (
    nodes: TransactionCallNode[],
    txHash?: string,
    capturedAt?: string,
  ) => void;
  selectSnapshotIndex: (index: number) => void;
  selectSnapshotForNode: (nodeId: string) => void;
  reduce: (
    state: StorageTimelineState,
    action: StorageTimelineAction,
  ) => StorageTimelineState;
}

export const useStorageTimelineStore = create<
  StorageTimelineState & StorageTimelineActions
>()((set, get) => ({
  snapshots: [],
  currentIndex: -1,
  nodeToSnapshotIndex: {},

  resetWithDeployment: (contractId, state, capturedAt) => {
    const resolvedCapturedAt = capturedAt ?? new Date().toISOString();
    set({
      snapshots: [
        {
          id: `deploy:${contractId}:${resolvedCapturedAt}`,
          label: "Deployment baseline",
          contextLabel: "Deployment baseline snapshot",
          state: immutableLedgerState(state),
          capturedAt: resolvedCapturedAt,
          source: "deployment",
          contractId,
        },
      ],
      currentIndex: 0,
      nodeToSnapshotIndex: {},
    });
  },

  appendTransactionFrames: (nodes, txHash, capturedAt) => {
    if (nodes.length === 0) return;
    const { snapshots, nodeToSnapshotIndex } = get();
    const nextSnapshots = [...snapshots];
    const nextNodeMap = { ...nodeToSnapshotIndex };
    const resolvedCapturedAt = capturedAt ?? new Date().toISOString();

    for (const node of nodes) {
      const nextIndex = nextSnapshots.length;
      const snapshot = buildTransactionSnapshot(
        node,
        nextIndex,
        txHash,
        resolvedCapturedAt,
      );
      nextSnapshots.push(snapshot);
      nextNodeMap[node.id] = nextIndex;
    }

    set({
      snapshots: nextSnapshots,
      currentIndex: nextSnapshots.length - 1,
      nodeToSnapshotIndex: nextNodeMap,
    });
  },

  selectSnapshotIndex: (index) => {
    const { snapshots } = get();
    if (snapshots.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(index, snapshots.length - 1));
    set({ currentIndex: clampedIndex });
  },

  selectSnapshotForNode: (nodeId) => {
    const { nodeToSnapshotIndex } = get();
    const index = nodeToSnapshotIndex[nodeId];
    if (index === undefined) return;
    set({ currentIndex: index });
  },

  reduce: (state, action) => {
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
        if (action.nodes.length === 0) {
          return state;
        }

        const nextSnapshots = [...state.snapshots];
        const nextNodeMap = { ...state.nodeToSnapshotIndex };
        const capturedAt = action.capturedAt ?? new Date().toISOString();

        for (const node of action.nodes) {
          const nextIndex = nextSnapshots.length;
          const snapshot = buildTransactionSnapshot(
            node,
            nextIndex,
            action.txHash,
            capturedAt,
          );
          nextSnapshots.push(snapshot);
          nextNodeMap[node.id] = nextIndex;
        }

        return {
          snapshots: nextSnapshots,
          currentIndex: nextSnapshots.length - 1,
          nodeToSnapshotIndex: nextNodeMap,
        };
      }

      case "select_snapshot_index": {
        if (state.snapshots.length === 0) {
          return state;
        }

        const clampedIndex = Math.max(
          0,
          Math.min(action.index, state.snapshots.length - 1),
        );
        return {
          ...state,
          currentIndex: clampedIndex,
        };
      }

      case "select_snapshot_for_node": {
        const index = state.nodeToSnapshotIndex[action.nodeId];
        if (index === undefined) {
          return state;
        }

        return {
          ...state,
          currentIndex: index,
        };
      }

      default: {
        return state;
      }
    }
  },
}));
