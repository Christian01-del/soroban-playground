import { MonacoViewStateStore } from "@/lib/monacoViewState";

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  } as Storage;
}

describe("MonacoViewStateStore", () => {
  it("round-trips a view state snapshot", () => {
    const store = new MonacoViewStateStore({ storage: null });
    const snapshot = {
      cursorState: [{ position: { lineNumber: 4, column: 2 } }],
      viewState: { scrollTop: 120 },
    };

    store.save("lib.rs", snapshot);

    expect(store.restore("lib.rs")).toEqual(snapshot);
    expect(store.has("lib.rs")).toBe(true);
  });

  it("ignores null/undefined snapshots", () => {
    const store = new MonacoViewStateStore({ storage: null });

    store.save("lib.rs", null);
    store.save("lib.rs", undefined);

    expect(store.restore("lib.rs")).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("persists into the provided storage and survives a fresh store", () => {
    const storage = makeStorage();
    const first = new MonacoViewStateStore({ storage });
    first.save("lib.rs", { viewState: { scrollTop: 42 } });

    // A new store instance simulates the module being re-created on reload.
    const second = new MonacoViewStateStore({ storage });

    expect(second.restore("lib.rs")).toEqual({ viewState: { scrollTop: 42 } });
  });

  it("falls back to memory when storage is unavailable", () => {
    const store = new MonacoViewStateStore({ storage: null });
    store.save("lib.rs", { viewState: { scrollTop: 7 } });

    expect(store.restore("lib.rs")).toEqual({ viewState: { scrollTop: 7 } });
  });

  it("treats malformed persisted JSON as absent", () => {
    const storage = makeStorage();
    storage.setItem("sp:monaco:viewState:lib.rs", "{not-json");

    const store = new MonacoViewStateStore({ storage });

    expect(store.restore("lib.rs")).toBeNull();
  });

  it("clears a single key from both tiers", () => {
    const storage = makeStorage();
    const store = new MonacoViewStateStore({ storage });
    store.save("lib.rs", { viewState: { scrollTop: 1 } });

    store.clear("lib.rs");

    expect(store.restore("lib.rs")).toBeNull();
    expect(new MonacoViewStateStore({ storage }).restore("lib.rs")).toBeNull();
  });

  it("clears every persisted key", () => {
    const storage = makeStorage();
    const store = new MonacoViewStateStore({ storage });
    store.save("a", { viewState: { scrollTop: 1 } });
    store.save("b", { viewState: { scrollTop: 2 } });

    store.clearAll();

    expect(store.size()).toBe(0);
    expect(new MonacoViewStateStore({ storage }).restore("a")).toBeNull();
    expect(new MonacoViewStateStore({ storage }).restore("b")).toBeNull();
  });

  it("does not throw when storage access rejects (private mode)", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    const store = new MonacoViewStateStore({ storage: hostile });

    expect(() => store.save("lib.rs", { viewState: {} })).not.toThrow();
    expect(store.restore("lib.rs")).toEqual({ viewState: {} });
  });
});
