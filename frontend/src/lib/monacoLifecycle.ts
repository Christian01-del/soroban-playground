"use client";

/**
 * Monaco Lifecycle GC & Memory Leak Prevention System.
 *
 * Monaco allocates resources — text models, editor instances, marker owners,
 * language workers and event listeners — that React's garbage collector never
 * reclaims on its own. Every one of those allocations must be paired with an
 * explicit teardown, otherwise navigating between views (or a Fast Refresh)
 * silently leaks models, workers and DOM listeners until the tab crashes.
 *
 * This module keeps an explicit reference registry so that:
 *
 *  - every Monaco allocation has a registered teardown;
 *  - view transitions dispose an entire *scope* atomically, in reverse order;
 *  - hot reloads (webpack's `module.hot`) flush every live scope;
 *  - anything that survives its scope is surfaced as a leak instead of failing
 *    silently.
 *
 * The tracker is framework-agnostic and SSR-safe: it never touches `window` or
 * `document` and is fully unit-testable.
 */

export type MonacoResourceKind =
  | "editor"
  | "model"
  | "listener"
  | "marker"
  | "worker"
  | "theme"
  | "disposable";

export const MONACO_RESOURCE_KINDS: readonly MonacoResourceKind[] = [
  "editor",
  "model",
  "listener",
  "marker",
  "worker",
  "theme",
  "disposable",
];

/** Anything Monaco exposes `dispose()` on (editors, models, IDisposable). */
export interface MonacoDisposableLike {
  dispose(): void;
}

export interface MonacoResourceInput {
  /** What is being tracked — used for reporting and leak attribution. */
  kind: MonacoResourceKind;
  /** Human readable label, e.g. `lib.rs` or `onDidChangeModelContent`. */
  label?: string;
  /** A Monaco disposable. Ignored when `teardown` is supplied. */
  disposable?: MonacoDisposableLike | null;
  /** Custom teardown for resources that are not a single disposable. */
  teardown?: () => void;
}

export interface MonacoResourceRecord {
  id: string;
  kind: MonacoResourceKind;
  scope: string;
  label: string;
  createdAt: number;
  disposed: boolean;
  disposedAt: number | null;
}

export interface MonacoScopeDisposalReport {
  scope: string;
  /** Ids disposed successfully, in the order they were torn down. */
  disposed: string[];
  /** Teardowns that threw; those resources stay registered as leaks. */
  failed: Array<{ id: string; label: string; error: unknown }>;
  /** Ids still live once the scope was flushed. */
  leaked: string[];
  durationMs: number;
}

export interface MonacoLifecycleStats {
  total: number;
  active: number;
  disposed: number;
  scopes: number;
  activeByKind: Record<MonacoResourceKind, number>;
  disposedByKind: Record<MonacoResourceKind, number>;
}

export interface MonacoLifecycleScope {
  readonly name: string;
  /** Number of resources currently registered to this scope. */
  readonly activeCount: number;
  /** Whether the scope has already been flushed. */
  readonly closed: boolean;
  track(input: MonacoResourceInput): MonacoResourceRecord;
  dispose(): MonacoScopeDisposalReport;
  has(id: string): boolean;
  resources(): MonacoResourceRecord[];
}

export interface MonacoLifecycleTrackerOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Leak reporter; defaults to a dev-only `console.warn`. */
  warn?: (message: string, details?: unknown) => void;
}

interface InternalResource extends MonacoResourceRecord {
  teardown: () => void;
}

const noop = (): void => {};

function emptyKindCounts(): Record<MonacoResourceKind, number> {
  return {
    editor: 0,
    model: 0,
    listener: 0,
    marker: 0,
    worker: 0,
    theme: 0,
    disposable: 0,
  };
}

function defaultWarn(message: string, details?: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  console.warn(message, details ?? "");
}

/**
 * Reference registry for Monaco allocations.
 *
 * Register resources through a scope and flush the scope on teardown. Scopes
 * are flushed in LIFO order so dependencies (listeners, workers) are released
 * before the editor/model they hang off.
 */
export class MonacoLifecycleTracker {
  private readonly resources = new Map<string, InternalResource>();
  private readonly scopeIds = new Map<string, string[]>();
  private readonly closedScopes = new Set<string>();
  private readonly now: () => number;
  private readonly warn: (message: string, details?: unknown) => void;
  private sequence = 0;

  constructor(options: MonacoLifecycleTrackerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? defaultWarn;
  }

  createScope(name: string): MonacoLifecycleScope {
    if (!this.scopeIds.has(name)) {
      this.scopeIds.set(name, []);
    }
    this.closedScopes.delete(name);

    const activeCount = () => this.activeCountInScope(name);
    const isClosed = () => this.closedScopes.has(name);
    return {
      name,
      get activeCount() {
        return activeCount();
      },
      get closed() {
        return isClosed();
      },
      track: (input) => this.track(name, input),
      dispose: () => this.disposeScope(name),
      has: (id) => this.resourceInScope(name, id),
      resources: () => this.listResources(name),
    };
  }

  /** Track a resource in an existing (or implicitly created) scope. */
  track(scope: string, input: MonacoResourceInput): MonacoResourceRecord {
    const id = `${scope}::${++this.sequence}`;
    const label = input.label ?? input.kind;
    const teardown = input.teardown ?? (() => input.disposable?.dispose());

    const record: InternalResource = {
      id,
      kind: input.kind,
      scope,
      label,
      createdAt: this.now(),
      disposed: false,
      disposedAt: null,
      teardown,
    };

    // A late async initialiser can try to register after the scope was already
    // flushed (component unmounted / route changed). Rather than leaking the
    // resource, tear it down immediately and record that we did.
    if (this.closedScopes.has(scope)) {
      const error = this.safelyTearDown(record);
      if (error) {
        this.warn(
          `[monaco-lifecycle] failed to release late resource ${label} (${id}) from closed scope ${scope}`,
          error,
        );
        this.resources.set(id, record);
        this.appendToScope(scope, id);
        return this.toPublic(record);
      }
      this.markDisposed(record);
      this.resources.set(id, record);
      return this.toPublic(record);
    }

    this.resources.set(id, record);
    this.appendToScope(scope, id);
    return this.toPublic(record);
  }

  /**
   * Dispose every resource in a scope, newest first. Idempotent: flushing an
   * already-flushed scope returns an empty report.
   */
  disposeScope(scope: string): MonacoScopeDisposalReport {
    const startedAt = this.now();
    const ids = this.scopeIds.get(scope) ?? [];
    const disposed: string[] = [];
    const failed: MonacoScopeDisposalReport["failed"] = [];

    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const record = this.resources.get(ids[index]);
      if (!record || record.disposed) continue;

      const error = this.safelyTearDown(record);
      if (error) {
        failed.push({ id: record.id, label: record.label, error });
        this.warn(
          `[monaco-lifecycle] teardown threw for ${record.kind} "${record.label}" (${record.id})`,
          error,
        );
        continue;
      }

      this.markDisposed(record);
      disposed.push(record.id);
    }

    const leaked = ids.filter((id) => {
      const record = this.resources.get(id);
      return Boolean(record && !record.disposed);
    });

    if (leaked.length > 0) {
      this.warn(
        `[monaco-lifecycle] scope "${scope}" released with ${leaked.length} undisposed resource(s)`,
        leaked,
      );
    }

    this.closedScopes.add(scope);
    this.scopeIds.delete(scope);

    return {
      scope,
      disposed,
      failed,
      leaked,
      durationMs: Math.max(0, this.now() - startedAt),
    };
  }

  /** Flush every live scope. Returns one report per scope (LIFO by creation). */
  disposeAll(): MonacoScopeDisposalReport[] {
    const scopes = Array.from(this.scopeIds.keys());
    return scopes
      .slice()
      .reverse()
      .map((scope) => this.disposeScope(scope));
  }

  /** Dispose a single resource by id. Returns `false` for unknown ids. */
  disposeResource(id: string): boolean {
    const record = this.resources.get(id);
    if (!record) return false;
    if (record.disposed) return true;

    const error = this.safelyTearDown(record);
    if (error) {
      this.warn(
        `[monaco-lifecycle] teardown threw for ${record.kind} "${record.label}" (${record.id})`,
        error,
      );
      return false;
    }
    this.markDisposed(record);
    return true;
  }

  getStats(): MonacoLifecycleStats {
    const activeByKind = emptyKindCounts();
    const disposedByKind = emptyKindCounts();
    let active = 0;
    let disposed = 0;

    for (const record of this.resources.values()) {
      if (record.disposed) {
        disposed += 1;
        disposedByKind[record.kind] += 1;
      } else {
        active += 1;
        activeByKind[record.kind] += 1;
      }
    }

    return {
      total: this.resources.size,
      active,
      disposed,
      scopes: this.scopeIds.size,
      activeByKind,
      disposedByKind,
    };
  }

  /** Every resource that has not been disposed — the leak set. */
  getLeaks(): MonacoResourceRecord[] {
    const leaks: MonacoResourceRecord[] = [];
    for (const record of this.resources.values()) {
      if (!record.disposed) leaks.push(this.toPublic(record));
    }
    return leaks;
  }

  getResource(id: string): MonacoResourceRecord | null {
    const record = this.resources.get(id);
    return record ? this.toPublic(record) : null;
  }

  listResources(scope?: string): MonacoResourceRecord[] {
    const records: MonacoResourceRecord[] = [];
    for (const record of this.resources.values()) {
      if (scope === undefined || record.scope === scope) {
        records.push(this.toPublic(record));
      }
    }
    return records;
  }

  hasScope(scope: string): boolean {
    return this.scopeIds.has(scope);
  }

  activeCountInScope(scope: string): number {
    const ids = this.scopeIds.get(scope);
    if (!ids) return 0;
    return ids.filter((id) => {
      const record = this.resources.get(id);
      return Boolean(record && !record.disposed);
    }).length;
  }

  /** Drop all bookkeeping. Intended for tests and full app teardown. */
  reset(): void {
    this.resources.clear();
    this.scopeIds.clear();
    this.closedScopes.clear();
    this.sequence = 0;
  }

  /**
   * Mark a record disposed and drop its teardown closure.
   *
   * The closure typically captures the Monaco resource (editor/model/worker),
   * so clearing it is what actually lets the garbage collector reclaim the
   * allocation — keeping the registry entry alone would retain it forever.
   */
  private markDisposed(record: InternalResource): void {
    record.disposed = true;
    record.disposedAt = this.now();
    record.teardown = noop;
  }

  private safelyTearDown(record: InternalResource): unknown | null {
    try {
      record.teardown();
      return null;
    } catch (error) {
      return error;
    }
  }

  private appendToScope(scope: string, id: string): void {
    const ids = this.scopeIds.get(scope);
    if (ids) {
      ids.push(id);
    } else {
      this.scopeIds.set(scope, [id]);
    }
  }

  private resourceInScope(scope: string, id: string): boolean {
    const record = this.resources.get(id);
    return Boolean(record && record.scope === scope);
  }

  private toPublic(record: InternalResource): MonacoResourceRecord {
    return {
      id: record.id,
      kind: record.kind,
      scope: record.scope,
      label: record.label,
      createdAt: record.createdAt,
      disposed: record.disposed,
      disposedAt: record.disposedAt,
    };
  }
}

/** A shaped slice of webpack's HMR surface relevant to us. */
export interface WebpackHotLike {
  dispose(callback: (data?: unknown) => void): void;
}

interface WebpackModule {
  hot?: WebpackHotLike;
}

/**
 * Resolve webpack's HMR API without referencing `import.meta` directly.
 *
 * `import.meta.webpackHot` only survives in ESM builds; Next.js ships client
 * modules as webpack CommonJS, where the API hangs off `module.hot`. Reading it
 * through the CommonJS `module` also keeps this file parseable by Jest/Babel
 * (which rewrites only known `import.meta` members).
 */
function getWebpackHot(): WebpackHotLike | undefined {
  try {
    const webpackModule =
      typeof module === "undefined" ? undefined : (module as WebpackModule);
    const hot = webpackModule?.hot;
    return hot && typeof hot.dispose === "function" ? hot : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Register a hot-reload dispose handler that flushes every tracked scope.
 *
 * Returns an unregister function (a no-op when HMR is unavailable) so tests can
 * install/remove the handler without touching the bundler.
 */
export function registerMonacoHotReloadCleanup(
  hot: WebpackHotLike | undefined = getWebpackHot(),
  tracker: MonacoLifecycleTracker = monacoLifecycle,
): () => void {
  if (!hot || typeof hot.dispose !== "function") return () => {};

  let active = true;
  hot.dispose(() => {
    if (!active) return;
    const reports = tracker.disposeAll();
    const leaked = reports.reduce((sum, report) => sum + report.leaked.length, 0);
    if (leaked > 0) {
      console.warn(
        `[monaco-lifecycle] hot reload left ${leaked} undisposed Monaco resource(s)`,
      );
    }
  });

  return () => {
    active = false;
  };
}

/** Process-wide tracker shared by the editor and any other Monaco consumers. */
export const monacoLifecycle = new MonacoLifecycleTracker();

/**
 * Convenience factory mirroring `monacoLifecycle.createScope`, exposed so
 * callers do not need to import the singleton just to open a scope.
 */
export function createMonacoScope(name: string): MonacoLifecycleScope {
  return monacoLifecycle.createScope(name);
}

// Flush tracked resources whenever this module is hot-replaced. In a plain
// node/jest/storybook runtime `module.hot` is absent and this is a no-op.
registerMonacoHotReloadCleanup();
