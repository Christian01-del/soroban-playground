import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import * as monaco from "monaco-editor";
import { monacoLifecycle } from "@/lib/monacoLifecycle";
import { monacoViewStates } from "@/lib/monacoViewState";
import Editor from "@/components/Editor";

jest.mock("monaco-editor", () => {
  const model = {
    dispose: jest.fn(),
    getValue: jest.fn().mockReturnValue("fn main() {}"),
    setValue: jest.fn(),
    uri: { toString: () => "inmemory://model/lib.rs" },
  };
  const editor = {
    dispose: jest.fn(),
    getModel: jest.fn().mockReturnValue(model),
    setModel: jest.fn(),
    onDidChangeModelContent: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    saveViewState: jest.fn().mockReturnValue({ cursorState: [], viewState: { scrollTop: 10 } }),
    restoreViewState: jest.fn(),
  };
  return {
    __esModule: true,
    editor: {
      create: jest.fn().mockReturnValue(editor),
      setModelMarkers: jest.fn(),
      defineTheme: jest.fn(),
      setTheme: jest.fn(),
      MarkerSeverity: { Error: 1, Warning: 2, Info: 3 },
    },
  };
});

jest.mock("@/hooks/useCollaborativeEditor", () => ({
  useCollaborativeEditor: () => ({ peers: [], isConnected: false }),
}));

jest.mock("@/lib/editorLoadScheduler", () => ({
  scheduleEditorLoad: (cb: () => void) => {
    cb();
    return () => {};
  },
  preloadMonacoEditor: jest.fn(),
}));

jest.mock("@/lib/monacoWorkers", () => ({
  configureMonacoWorkers: jest.fn(),
}));

class MockWorker {
  postMessage = jest.fn();
  terminate = jest.fn();
  onmessage: ((event: any) => void) | null = null;
}

(global as any).Worker = jest.fn().mockImplementation(() => new MockWorker());

async function mountReadyEditor(props?: { viewStateKey?: string }) {
  const utils = render(
    <Editor code="fn main() {}" setCode={jest.fn()} {...props} />,
  );
  await waitFor(() => expect(monaco.editor.create).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
  return utils;
}

describe("Monaco lifecycle GC (integration)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    monacoLifecycle.reset();
    monacoViewStates.clearAll();
  });

  afterEach(() => {
    cleanup();
    monacoLifecycle.reset();
    monacoViewStates.clearAll();
  });

  it("tracks every Monaco allocation while the editor is live", async () => {
    await mountReadyEditor();

    const stats = monacoLifecycle.getStats();
    expect(stats.activeByKind.editor).toBe(1);
    expect(stats.activeByKind.model).toBe(1);
    expect(stats.activeByKind.listener).toBe(1);
    expect(stats.activeByKind.marker).toBe(1);
    expect(stats.activeByKind.worker).toBe(1);
    expect(stats.activeByKind.theme).toBe(1);
  });

  it("leaves zero live resources after a view transition (unmount)", async () => {
    const { unmount } = await mountReadyEditor();

    unmount();

    expect(monacoLifecycle.getLeaks()).toEqual([]);
    expect(monacoLifecycle.getStats().active).toBe(0);
    const editor = (monaco.editor.create as jest.Mock).mock.results[0].value;
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(editor.getModel().dispose).toHaveBeenCalledTimes(1);
  });

  it("does not accumulate leaks across repeated mount/unmount cycles", async () => {
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const { unmount } = await mountReadyEditor();
      unmount();
    }

    expect(monacoLifecycle.getLeaks()).toEqual([]);
    expect(monacoLifecycle.getStats().active).toBe(0);
  });

  it("persists and restores view state across transitions", async () => {
    const { unmount } = await mountReadyEditor({ viewStateKey: "playground/lib.rs" });

    unmount();

    expect(monacoViewStates.has("playground/lib.rs")).toBe(true);

    await mountReadyEditor({ viewStateKey: "playground/lib.rs" });

    const editor = (monaco.editor.create as jest.Mock).mock.results[0].value;
    await waitFor(() => expect(editor.restoreViewState).toHaveBeenCalledTimes(1));
  });

  it("flushes a live editor on a simulated hot reload", async () => {
    await mountReadyEditor();
    expect(monacoLifecycle.getStats().active).toBeGreaterThan(0);

    // This is exactly what registerMonacoHotReloadCleanup() runs on HMR.
    monacoLifecycle.disposeAll();

    expect(monacoLifecycle.getStats().active).toBe(0);
    const editor = (monaco.editor.create as jest.Mock).mock.results[0].value;
    expect(editor.dispose).toHaveBeenCalledTimes(1);
  });
});
