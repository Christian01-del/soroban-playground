import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type * as monaco from "monaco-editor";
import { scheduleEditorLoad } from "@/lib/editorLoadScheduler";
import { configureMonacoWorkers } from "@/lib/monacoWorkers";
import {
  createMonacoScope,
  type MonacoLifecycleScope,
} from "@/lib/monacoLifecycle";
import { monacoViewStates } from "@/lib/monacoViewState";
import { getAppliedTheme } from "@/lib/theme/engine";
import { MONACO_THEME_NAME, registerMonacoTheme } from "@/lib/theme/monaco";
import { observeTheme } from "@/lib/theme/observe";
import "monaco-editor/min/vs/style.css";

interface UseMonacoProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Stable identifier used to persist/restore the editor view state (cursor,
   * selection, scroll) across view transitions and hot reloads. Multiple
   * editors should pass distinct keys.
   */
  viewStateKey?: string;
}

interface UseMonacoResult {
  containerRef: RefObject<HTMLDivElement | null>;
  isEditorReady: boolean;
}

let instanceCounter = 0;

export function useMonaco({
  language,
  value,
  onChange,
  viewStateKey = "monaco-editor",
}: UseMonacoProps): UseMonacoResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [isEditorReady, setIsEditorReady] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
    const model = modelRef.current;
    if (model && value !== model.getValue()) {
      model.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    let disposed = false;
    let cancel: (() => void) | undefined;
    let scope: MonacoLifecycleScope | null = null;
    let monacoAPI: typeof import("monaco-editor") | null = null;

    async function initEditor() {
      cancel = scheduleEditorLoad(async () => {
        while (!containerRef.current) {
          if (disposed) return;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (disposed) return;

        try {
          const rawMonaco = await import("monaco-editor");
          monacoAPI = (rawMonaco as any).default?.editor ? (rawMonaco as any).default : rawMonaco;
          if (disposed || !monacoAPI || !containerRef.current) return;

          configureMonacoWorkers();

          // Register the design-token theme before the editor reads it.
          registerMonacoTheme(monacoAPI, getAppliedTheme() ?? "dark");

          // A unique scope per mount so concurrent editors can never dispose
          // each other's resources.
          scope = createMonacoScope(`${viewStateKey}#${++instanceCounter}`);

          const editor = monacoAPI.editor.create(containerRef.current, {
            language,
            value: valueRef.current,
            theme: MONACO_THEME_NAME,
            minimap: { enabled: false },
            fontSize: 14,
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            formatOnPaste: true,
            wordWrap: "on",
            lineNumbers: "on",
            bracketPairColorization: { enabled: true },
            tabSize: 4,
            insertSpaces: true,
            renderLineHighlight: "all",
          });

          if (disposed) {
            editor.dispose();
            const model = editor.getModel();
            if (model) model.dispose();
            return;
          }

          editorRef.current = editor;
          const model = editor.getModel() ?? null;
          modelRef.current = model;

          // Register in teardown-reverse order: the model is released last, so
          // listeners/markers/workers/editor all go first.
          if (model) {
            scope.track({
              kind: "model",
              label: `${language} model`,
              disposable: model,
            });
          }
          scope.track({
            kind: "editor",
            label: "Soroban contract editor",
            disposable: editor,
          });

          // Replay any persisted cursor/scroll position for this view before we
          // announce readiness, avoiding a visible jump.
          const persistedViewState = monacoViewStates.restore(viewStateKey);
          if (persistedViewState) {
            try {
              editor.restoreViewState(
                persistedViewState as monaco.editor.ICodeEditorViewState,
              );
            } catch {
              /* stale/corrupt view state — fall back to default position */
            }
          }

          setIsEditorReady(true);

          // Re-register the Monaco theme whenever the app theme changes so the
          // editor highlights stay aligned with the CSS tokens.
          const stopObservingTheme = observeTheme((mode) => {
            if (!monacoAPI) return;
            registerMonacoTheme(monacoAPI, mode);
            monacoAPI.editor.setTheme(MONACO_THEME_NAME);
          });
          scope.track({
            kind: "theme",
            label: "monaco theme observer",
            teardown: stopObservingTheme,
          });

          const worker = new Worker(new URL("../workers/rustAnalyzer.worker.ts", import.meta.url));
          workerRef.current = worker;
          scope.track({
            kind: "worker",
            label: "rust analyzer worker",
            teardown: () => worker.terminate(),
          });

          // Markers are owned by the editor's model; clear them explicitly so a
          // remount never inherits stale diagnostics.
          if (model) {
            scope.track({
              kind: "marker",
              label: `rustAnalyzer markers (${model.uri.toString()})`,
              teardown: () => {
                try {
                  monacoAPI?.editor.setModelMarkers(model, "rustAnalyzer", []);
                } catch {
                  /* model already disposed — nothing to clear */
                }
              },
            });
          }

          worker.onmessage = (event: MessageEvent) => {
            const { uri: targetUri, diagnostics } = event.data;
            if (!modelRef.current || modelRef.current.uri.toString() !== targetUri) {
              return;
            }

            const markers: monaco.editor.IMarker[] = diagnostics.map((diagnostic: any) => ({
              severity:
                diagnostic.severity === "error"
                  ? monacoAPI!.MarkerSeverity.Error
                  : diagnostic.severity === "warning"
                    ? monacoAPI!.MarkerSeverity.Warning
                    : monacoAPI!.MarkerSeverity.Info,
              startLineNumber: diagnostic.startLineNumber,
              startColumn: diagnostic.startColumn,
              endLineNumber: diagnostic.endLineNumber,
              endColumn: diagnostic.endColumn,
              message: diagnostic.message,
            }));

            monacoAPI!.editor.setModelMarkers(
              modelRef.current,
              "rustAnalyzer",
              markers,
            );
          };

          const contentListener = editor.onDidChangeModelContent(() => {
            const currentValue = modelRef.current?.getValue();
            if (currentValue !== undefined) {
              onChangeRef.current(currentValue);
              workerRef.current?.postMessage({
                uri: modelRef.current?.uri.toString(),
                code: currentValue,
              });
            }
          });
          // `onDidChangeModelContent` returns an IDisposable; register it so it
          // can never outlive the editor it subscribed to.
          if (contentListener) {
            scope.track({
              kind: "listener",
              label: "onDidChangeModelContent",
              disposable: contentListener,
            });
          }

          if (modelRef.current) {
            workerRef.current.postMessage({
              uri: modelRef.current.uri.toString(),
              code: modelRef.current.getValue(),
            });
          }
        } catch (error) {
          console.error("Failed to initialize Monaco editor", error);
        }
      });
    }

    initEditor();

    return () => {
      disposed = true;
      if (cancel) cancel();

      // Persist the view state before disposing so the next mount for this view
      // restores the exact cursor/scroll position.
      const editor = editorRef.current;
      if (editor) {
        try {
          const snapshot = editor.saveViewState();
          if (snapshot) {
            monacoViewStates.save(viewStateKey, snapshot);
          }
        } catch {
          /* view state is best-effort */
        }
      }

      // Single, atomic flush of every tracked Monaco resource. The tracker is
      // idempotent, so this is safe even if a late async init races teardown.
      if (scope) {
        scope.dispose();
        scope = null;
      }

      editorRef.current = null;
      modelRef.current = null;
      workerRef.current = null;
      setIsEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, isEditorReady };
}
