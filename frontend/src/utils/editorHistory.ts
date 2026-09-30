export interface EditorSnapshot {
  id: string;
  workspaceId: string;
  parentId: string | null;
  code: string;
  createdAt: number;
  reason: "autosave" | "resolution";
}

export interface EditorConflict {
  baseCode: string;
  localCode: string;
  remoteSnapshot: EditorSnapshot;
  detectedAt: number;
}

export type ThreeWayDecision =
  | { kind: "same"; code: string }
  | { kind: "local"; code: string }
  | { kind: "remote"; code: string }
  | { kind: "merged"; code: string }
  | { kind: "conflict" };

export type SaveSnapshotResult =
  | { kind: "saved"; snapshot: EditorSnapshot }
  | { kind: "remote"; snapshot: EditorSnapshot }
  | { kind: "conflict"; conflict: EditorConflict };

interface WorkspacePointer {
  id: string;
  headId: string | null;
  updatedAt: number;
}

const DATABASE_NAME = "soroban-playground-editor-history";
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const WORKSPACE_STORE = "workspaces";

let databasePromise: Promise<IDBDatabase> | undefined;

export function decideThreeWayMerge(
  baseCode: string,
  localCode: string,
  remoteCode: string,
): ThreeWayDecision {
  if (localCode === remoteCode) return { kind: "same", code: localCode };
  if (localCode === baseCode) return { kind: "remote", code: remoteCode };
  if (remoteCode === baseCode) return { kind: "local", code: localCode };

  const baseLines = baseCode.split("\n");
  const localHunks = createLineHunks(baseLines, localCode.split("\n"));
  const remoteHunks = createLineHunks(baseLines, remoteCode.split("\n"));
  if (!localHunks || !remoteHunks) return { kind: "conflict" };
  if (localHunks.some((local) => remoteHunks.some((remote) => editsOverlap(local, remote)))) {
    return { kind: "conflict" };
  }

  const mergedLines = [...baseLines];
  for (const hunk of [...localHunks, ...remoteHunks].sort(
    (left, right) => right.start - left.start,
  )) {
    mergedLines.splice(hunk.start, hunk.end - hunk.start, ...hunk.replacement);
  }
  return { kind: "merged", code: mergedLines.join("\n") };
}

export function getSnapshotDepth(
  snapshot: EditorSnapshot,
  snapshotsById: Map<string, EditorSnapshot>,
) {
  let depth = 0;
  let parentId = snapshot.parentId;
  const visited = new Set([snapshot.id]);

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = snapshotsById.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }

  return depth;
}

export async function loadEditorHistory(workspaceId: string) {
  const database = await openDatabase();
  return new Promise<{ snapshots: EditorSnapshot[]; headId: string | null }>(
    (resolve, reject) => {
      const transaction = database.transaction(
        [SNAPSHOT_STORE, WORKSPACE_STORE],
        "readonly",
      );
      const snapshotsRequest = transaction
        .objectStore(SNAPSHOT_STORE)
        .index("workspaceId")
        .getAll(workspaceId);
      const workspaceRequest = transaction
        .objectStore(WORKSPACE_STORE)
        .get(workspaceId) as IDBRequest<WorkspacePointer | undefined>;

      transaction.oncomplete = () => {
        const snapshots = snapshotsRequest.result.sort(
          (left, right) => left.createdAt - right.createdAt,
        );
        const storedHeadId = workspaceRequest.result?.headId;
        const headId =
          storedHeadId && snapshots.some((snapshot) => snapshot.id === storedHeadId)
            ? storedHeadId
            : snapshots.at(-1)?.id ?? null;
        resolve({ snapshots, headId });
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    },
  );
}

export async function saveEditorSnapshot(
  workspaceId: string,
  baseCode: string,
  localCode: string,
  reason: EditorSnapshot["reason"] = "autosave",
): Promise<SaveSnapshotResult> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [SNAPSHOT_STORE, WORKSPACE_STORE],
      "readwrite",
    );
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    const workspaceStore = transaction.objectStore(WORKSPACE_STORE);
    let result: SaveSnapshotResult | undefined;

    const save = (parentId: string | null, code = localCode) => {
      const snapshot: EditorSnapshot = {
        id: createId(),
        workspaceId,
        parentId,
        code,
        createdAt: Date.now(),
        reason,
      };
      snapshotStore.add(snapshot);
      workspaceStore.put({
        id: workspaceId,
        headId: snapshot.id,
        updatedAt: snapshot.createdAt,
      } satisfies WorkspacePointer);
      result = { kind: "saved", snapshot };
    };

    const workspaceRequest = workspaceStore.get(workspaceId) as IDBRequest<
      WorkspacePointer | undefined
    >;
    workspaceRequest.onsuccess = () => {
      const currentHeadId = workspaceRequest.result?.headId ?? null;
      if (!currentHeadId) {
        save(null);
        return;
      }

      const headRequest = snapshotStore.get(currentHeadId) as IDBRequest<
        EditorSnapshot | undefined
      >;
      headRequest.onsuccess = () => {
        const remoteSnapshot = headRequest.result;
        if (!remoteSnapshot) {
          save(null);
          return;
        }

        const decision = decideThreeWayMerge(
          baseCode,
          localCode,
          remoteSnapshot.code,
        );
        if (decision.kind === "conflict") {
          result = {
            kind: "conflict",
            conflict: {
              baseCode,
              localCode,
              remoteSnapshot,
              detectedAt: Date.now(),
            },
          };
        } else if (decision.kind === "remote" || decision.kind === "same") {
          result = { kind: "remote", snapshot: remoteSnapshot };
        } else if (decision.kind === "merged") {
          save(remoteSnapshot.id, decision.code);
        } else {
          save(remoteSnapshot.id);
        }
      };
      headRequest.onerror = () => transaction.abort();
    };
    workspaceRequest.onerror = () => transaction.abort();

    transaction.oncomplete = () => {
      if (!result) {
        reject(new Error("Snapshot transaction completed without a result"));
        return;
      }
      resolve(result);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function moveEditorHistoryHead(
  workspaceId: string,
  headId: string,
) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
    const store = transaction.objectStore(WORKSPACE_STORE);
    const request = store.get(workspaceId) as IDBRequest<
      WorkspacePointer | undefined
    >;
    request.onsuccess = () => {
      store.put({
        id: workspaceId,
        headId,
        updatedAt: Date.now(),
      } satisfies WorkspacePointer);
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser"));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const snapshots = database.createObjectStore(SNAPSHOT_STORE, {
          keyPath: "id",
        });
        snapshots.createIndex("workspaceId", "workspaceId");
      }
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("History database upgrade is blocked"));
  });

  return databasePromise;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

interface LineHunk {
  start: number;
  end: number;
  replacement: string[];
}

function createLineHunks(base: string[], changed: string[]): LineHunk[] | null {
  let prefixLength = 0;
  while (
    prefixLength < base.length &&
    prefixLength < changed.length &&
    base[prefixLength] === changed[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < base.length - prefixLength &&
    suffixLength < changed.length - prefixLength &&
    base[base.length - suffixLength - 1] ===
      changed[changed.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const baseMiddle = base.slice(prefixLength, base.length - suffixLength);
  const changedMiddle = changed.slice(
    prefixLength,
    changed.length - suffixLength,
  );
  const columns = changedMiddle.length + 1;
  const rows = baseMiddle.length + 1;
  if (columns * rows > 200_000) return null;

  const lcs = new Uint32Array(columns * rows);
  for (let baseIndex = baseMiddle.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (
      let changedIndex = changedMiddle.length - 1;
      changedIndex >= 0;
      changedIndex -= 1
    ) {
      const cell = baseIndex * columns + changedIndex;
      lcs[cell] =
        baseMiddle[baseIndex] === changedMiddle[changedIndex]
          ? lcs[(baseIndex + 1) * columns + changedIndex + 1] + 1
          : Math.max(
              lcs[(baseIndex + 1) * columns + changedIndex],
              lcs[baseIndex * columns + changedIndex + 1],
            );
    }
  }

  const hunks: LineHunk[] = [];
  let current: LineHunk | null = null;
  let baseIndex = 0;
  let changedIndex = 0;

  const finishHunk = () => {
    if (!current) return;
    hunks.push(current);
    current = null;
  };

  while (baseIndex < baseMiddle.length || changedIndex < changedMiddle.length) {
    if (
      baseIndex < baseMiddle.length &&
      changedIndex < changedMiddle.length &&
      baseMiddle[baseIndex] === changedMiddle[changedIndex]
    ) {
      finishHunk();
      baseIndex += 1;
      changedIndex += 1;
      continue;
    }

    current ??= { start: baseIndex, end: baseIndex, replacement: [] };
    const canInsert = changedIndex < changedMiddle.length;
    const shouldInsert =
      canInsert &&
      (baseIndex === baseMiddle.length ||
        lcs[baseIndex * columns + changedIndex + 1] >
          lcs[(baseIndex + 1) * columns + changedIndex]);
    if (shouldInsert) {
      current.replacement.push(changedMiddle[changedIndex]);
      changedIndex += 1;
    } else {
      current.end += 1;
      baseIndex += 1;
    }
  }
  finishHunk();
  return hunks.map((hunk) => ({
    ...hunk,
    start: hunk.start + prefixLength,
    end: hunk.end + prefixLength,
  }));
}

function editsOverlap(left: LineHunk, right: LineHunk) {
  if (left.start === left.end && right.start === right.end) {
    return left.start === right.start;
  }
  if (left.start === left.end) {
    return left.start >= right.start && left.start <= right.end;
  }
  if (right.start === right.end) {
    return right.start >= left.start && right.start <= left.end;
  }
  return left.start < right.end && right.start < left.end;
}