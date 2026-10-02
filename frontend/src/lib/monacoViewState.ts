"use client";

/**
 * Monaco view-state persistence.
 *
 * When a view transitions away (route change, tab switch, responsive layout
 * swap) the editor is destroyed and re-created. Without persistence the user
 * loses their scroll position, cursor and folded regions every time. This store
 * snapshots `editor.saveViewState()` on teardown and replays it through
 * `editor.restoreViewState()` on the next mount for the same view key.
 *
 * The snapshot is kept in memory for the current session and mirrored into
 * `sessionStorage` (when available) so a hot reload also survives. Every
 * storage access is guarded — private-mode browsers simply fall back to memory.
 */

/** Serialisable subset of `monaco.editor.ICodeEditorViewState`. */
export interface MonacoViewStateSnapshot {
  cursorState?: unknown;
  contributionsState?: unknown;
  viewState?: unknown;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem"> &
  Partial<Pick<Storage, "length" | "key">>;

const STORAGE_PREFIX = "sp:monaco:viewState:";

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export interface MonacoViewStateStoreOptions {
  storage?: StorageLike | null;
}

/**
 * Two-tier view-state store keyed by a stable view identifier.
 *
 * `save` always writes to memory first, then best-effort to storage. `restore`
 * prefers memory (fastest, survives within the tab) and falls back to storage
 * after a reload. Malformed persisted data is treated as "no state".
 */
export class MonacoViewStateStore {
  private readonly memory = new Map<string, MonacoViewStateSnapshot>();
  private readonly storage: StorageLike | null;

  constructor(options: MonacoViewStateStoreOptions = {}) {
    this.storage =
      options.storage === undefined ? defaultStorage() : options.storage;
  }

  save(key: string, snapshot: MonacoViewStateSnapshot | null | undefined): void {
    if (!snapshot) return;

    const state: MonacoViewStateSnapshot = {
      cursorState: snapshot.cursorState,
      contributionsState: snapshot.contributionsState,
      viewState: snapshot.viewState,
    };

    this.memory.set(key, state);

    if (!this.storage) return;
    try {
      this.storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(state));
    } catch {
      /* storage full / blocked — memory copy is enough for this session */
    }
  }

  restore(key: string): MonacoViewStateSnapshot | null {
    const inMemory = this.memory.get(key);
    if (inMemory) return inMemory;
    if (!this.storage) return null;

    try {
      const raw = this.storage.getItem(`${STORAGE_PREFIX}${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MonacoViewStateSnapshot | null;
      if (!parsed || typeof parsed !== "object") return null;
      this.memory.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  has(key: string): boolean {
    return this.restore(key) !== null;
  }

  clear(key: string): void {
    this.memory.delete(key);
    if (!this.storage) return;
    try {
      this.storage.removeItem(`${STORAGE_PREFIX}${key}`);
    } catch {
      /* nothing else we can do */
    }
  }

  clearAll(): void {
    this.memory.clear();
    if (!this.storage) return;
    try {
      const length = this.storage.length;
      if (typeof length !== "number" || typeof this.storage.key !== "function") {
        return;
      }
      const stale: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const storageKey = this.storage.key(index);
        if (storageKey && storageKey.startsWith(STORAGE_PREFIX)) {
          stale.push(storageKey);
        }
      }
      for (const storageKey of stale) {
        this.storage.removeItem(storageKey);
      }
    } catch {
      /* best effort */
    }
  }

  size(): number {
    return this.memory.size;
  }
}

/** Application-wide view-state store shared by every Monaco editor mount. */
export const monacoViewStates = new MonacoViewStateStore();
