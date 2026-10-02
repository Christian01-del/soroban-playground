import {
  MonacoLifecycleTracker,
  registerMonacoHotReloadCleanup,
  type WebpackHotLike,
} from "@/lib/monacoLifecycle";

function makeTracker() {
  let tick = 0;
  const warnings: Array<{ message: string; details?: unknown }> = [];
  const tracker = new MonacoLifecycleTracker({
    now: () => ++tick,
    warn: (message, details) => warnings.push({ message, details }),
  });
  return { tracker, warnings };
}

describe("MonacoLifecycleTracker", () => {
  it("records tracked resources with kind, scope and label", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");

    const record = scope.track({
      kind: "model",
      label: "lib.rs",
      disposable: { dispose: jest.fn() },
    });

    expect(record.kind).toBe("model");
    expect(record.scope).toBe("view-1");
    expect(record.label).toBe("lib.rs");
    expect(record.disposed).toBe(false);
    expect(scope.activeCount).toBe(1);
    expect(tracker.hasScope("view-1")).toBe(true);
  });

  it("disposes scope resources in reverse (LIFO) order", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    const order: string[] = [];

    scope.track({ kind: "model", label: "model", teardown: () => order.push("model") });
    scope.track({ kind: "editor", label: "editor", teardown: () => order.push("editor") });
    scope.track({ kind: "worker", label: "worker", teardown: () => order.push("worker") });

    const report = scope.dispose();

    expect(order).toEqual(["worker", "editor", "model"]);
    expect(report.disposed).toHaveLength(3);
    expect(report.leaked).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(scope.closed).toBe(true);
    expect(scope.activeCount).toBe(0);
  });

  it("calls dispose() on Monaco disposables", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    const dispose = jest.fn();

    scope.track({ kind: "listener", label: "listener", disposable: { dispose } });
    scope.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — flushing a scope twice does nothing the second time", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    const teardown = jest.fn();

    scope.track({ kind: "editor", label: "editor", teardown });
    scope.dispose();
    const second = scope.dispose();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(second.disposed).toEqual([]);
    expect(second.leaked).toEqual([]);
  });

  it("surfaces teardown failures as leaks and warns", () => {
    const { tracker, warnings } = makeTracker();
    const scope = tracker.createScope("view-1");
    const boom = new Error("teardown exploded");

    scope.track({
      kind: "worker",
      label: "analyzer",
      teardown: () => {
        throw boom;
      },
    });

    const report = scope.dispose();

    expect(report.disposed).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].label).toBe("analyzer");
    expect(report.failed[0].error).toBe(boom);
    expect(report.leaked).toHaveLength(1);
    expect(tracker.getLeaks()).toHaveLength(1);
    expect(warnings.some((w) => w.message.includes("undisposed"))).toBe(true);
  });

  it("immediately tears down resources registered after the scope closed", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    scope.dispose();

    const dispose = jest.fn();
    const record = scope.track({
      kind: "editor",
      label: "late editor",
      disposable: { dispose },
    });

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(record.disposed).toBe(true);
    expect(tracker.getLeaks()).toHaveLength(0);
  });

  it("keeps scopes isolated from each other", () => {
    const { tracker } = makeTracker();
    const first = tracker.createScope("view-1");
    const second = tracker.createScope("view-2");
    const firstDispose = jest.fn();
    const secondDispose = jest.fn();

    first.track({ kind: "editor", label: "a", disposable: { dispose: firstDispose } });
    second.track({ kind: "editor", label: "b", disposable: { dispose: secondDispose } });

    first.dispose();

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).not.toHaveBeenCalled();
    expect(second.activeCount).toBe(1);
  });

  it("flushes every scope with disposeAll()", () => {
    const { tracker } = makeTracker();
    const a = tracker.createScope("a");
    const b = tracker.createScope("b");
    const teardownA = jest.fn();
    const teardownB = jest.fn();
    a.track({ kind: "editor", label: "a", teardown: teardownA });
    b.track({ kind: "editor", label: "b", teardown: teardownB });

    const reports = tracker.disposeAll();

    expect(reports).toHaveLength(2);
    expect(teardownA).toHaveBeenCalledTimes(1);
    expect(teardownB).toHaveBeenCalledTimes(1);
    expect(tracker.getStats().active).toBe(0);
    expect(tracker.getStats().disposed).toBe(2);
  });

  it("reports aggregate stats broken down by kind", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    scope.track({ kind: "editor", label: "e", teardown: () => {} });
    scope.track({ kind: "model", label: "m", teardown: () => {} });
    scope.track({ kind: "model", label: "m2", teardown: () => {} });

    const stats = tracker.getStats();

    expect(stats.total).toBe(3);
    expect(stats.active).toBe(3);
    expect(stats.disposed).toBe(0);
    expect(stats.scopes).toBe(1);
    expect(stats.activeByKind.editor).toBe(1);
    expect(stats.activeByKind.model).toBe(2);
    expect(stats.activeByKind.worker).toBe(0);
  });

  it("disposes individual resources by id and reports unknown ids", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    const teardown = jest.fn();
    const record = scope.track({ kind: "listener", label: "l", teardown });

    expect(tracker.disposeResource(record.id)).toBe(true);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(tracker.disposeResource("does-not-exist")).toBe(false);
    expect(tracker.getResource(record.id)?.disposed).toBe(true);
  });

  it("reset() clears all bookkeeping", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    scope.track({ kind: "editor", label: "e", teardown: () => {} });

    tracker.reset();

    expect(tracker.getStats().total).toBe(0);
    expect(tracker.getStats().scopes).toBe(0);
    expect(tracker.hasScope("view-1")).toBe(false);
    expect(tracker.getLeaks()).toEqual([]);
  });
});

describe("registerMonacoHotReloadCleanup", () => {
  it("flushes every scope when the bundler signals a dispose", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    const teardown = jest.fn();
    scope.track({ kind: "editor", label: "e", teardown });

    let handler: (() => void) | undefined;
    const hot: WebpackHotLike = {
      dispose: (callback) => {
        handler = () => callback(undefined);
      },
    };

    registerMonacoHotReloadCleanup(hot, tracker);
    expect(handler).toBeDefined();

    handler?.();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(tracker.getStats().active).toBe(0);
  });

  it("is a no-op when no HMR runtime is present", () => {
    const { tracker } = makeTracker();
    expect(() => registerMonacoHotReloadCleanup(undefined, tracker)).not.toThrow();
  });

  it("stops flushing after the returned unregister function runs", () => {
    const { tracker } = makeTracker();
    const scope = tracker.createScope("view-1");
    const teardown = jest.fn();
    scope.track({ kind: "editor", label: "e", teardown });

    let handler: (() => void) | undefined;
    const hot: WebpackHotLike = {
      dispose: (callback) => {
        handler = () => callback(undefined);
      },
    };

    const unregister = registerMonacoHotReloadCleanup(hot, tracker);
    unregister();
    handler?.();

    expect(teardown).not.toHaveBeenCalled();
  });
});
