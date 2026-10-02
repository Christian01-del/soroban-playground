"use client";

import React, { useEffect, useRef } from "react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import type { editor, languages } from "monaco-editor";
import type { CargoDiagnostic, DiagnosticFix } from "@/utils/cargoDiagnostics";
import { SOROBAN_SNIPPETS } from "@/utils/sorobanSnippets";
import {
  calculatePinchFontSize,
  clampEditorFontSize,
  DEFAULT_EDITOR_FONT_SIZE,
} from "@/utils/mobileEditorControls";

interface EditorProps {
  code: string;
  setCode: (value: string) => void;
  diagnostics: CargoDiagnostic[];
}

export default function Editor({ code, setCode, diagnostics }: EditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const touchSurfaceRef = useRef<HTMLDivElement | null>(null);
  const diagnosticsRef = useRef(diagnostics);
  const codeActionProviderRef = useRef<languages.CodeActionProvider | null>(null);
  const completionProviderRef = useRef<languages.CompletionItemProvider | null>(
    null,
  );
  const pinchStartRef = useRef<{ distance: number; fontSize: number } | null>(null);
  const fontSizeRef = useRef(DEFAULT_EDITOR_FONT_SIZE);
  const [fontSize, setFontSize] = React.useState(DEFAULT_EDITOR_FONT_SIZE);
  const [hasTouchInput, setHasTouchInput] = React.useState(false);

  useEffect(() => {
    diagnosticsRef.current = diagnostics;
    const monacoEditor = editorRef.current;
    const monaco = monacoRef.current;
    const model = monacoEditor?.getModel();
    if (!monaco || !model) return;

    monaco.editor.setModelMarkers(
      model,
      "cargo",
      toMonacoMarkers(diagnostics, monaco),
    );
  }, [diagnostics]);

  useEffect(() => {
    setHasTouchInput(
      window.matchMedia("(pointer: coarse)").matches ||
        navigator.maxTouchPoints > 0,
    );
  }, []);

  useEffect(() => {
    const surface = touchSurfaceRef.current;
    if (!surface) return;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      pinchStartRef.current = {
        distance: getTouchDistance(event.touches[0], event.touches[1]),
        fontSize: fontSizeRef.current,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      const start = pinchStartRef.current;
      if (!start || event.touches.length !== 2) return;

      event.preventDefault();
      const nextFontSize = calculatePinchFontSize(
        start.fontSize,
        start.distance,
        getTouchDistance(event.touches[0], event.touches[1]),
      );
      if (nextFontSize === fontSizeRef.current) return;

      fontSizeRef.current = nextFontSize;
      setFontSize(nextFontSize);
      editorRef.current?.updateOptions({ fontSize: nextFontSize });
    };
    const onTouchEnd = () => {
      pinchStartRef.current = null;
    };

    surface.addEventListener("touchstart", onTouchStart, { passive: true });
    surface.addEventListener("touchmove", onTouchMove, { passive: false });
    surface.addEventListener("touchend", onTouchEnd, { passive: true });
    surface.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      surface.removeEventListener("touchstart", onTouchStart);
      surface.removeEventListener("touchmove", onTouchMove);
      surface.removeEventListener("touchend", onTouchEnd);
      surface.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const handleMount: OnMount = (monacoEditor, monaco) => {
    editorRef.current = monacoEditor;
    monacoRef.current = monaco;
    monacoEditor.updateOptions({ fontSize: fontSizeRef.current });
    const model = monacoEditor.getModel();
    if (model) {
      monaco.editor.setModelMarkers(
        model,
        "cargo",
        toMonacoMarkers(diagnosticsRef.current, monaco),
      );
    }
    codeActionProviderRef.current = monaco.languages.registerCodeActionProvider(
      "rust",
      {
        provideCodeActions(_model, range) {
          const actions = diagnosticsRef.current
            .filter(
              (diagnostic) =>
                diagnostic.fixes.length > 0 &&
                diagnostic.startLineNumber <= range.endLineNumber &&
                diagnostic.endLineNumber >= range.startLineNumber,
            )
            .flatMap((diagnostic) =>
              diagnostic.fixes.map((fix) =>
                createCodeAction(_model.uri, fix, monaco),
              ),
            );
          return { actions, dispose: () => undefined };
        },
      },
    );
    completionProviderRef.current = monaco.languages.registerCompletionItemProvider(
      "rust",
      {
        triggerCharacters: ["#", ":"],
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );

          return {
            suggestions: SOROBAN_SNIPPETS.map((snippet, index) => ({
              label: snippet.label,
              detail: snippet.detail,
              documentation: snippet.documentation,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: snippet.insertText,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: `0${index}`,
            })),
          };
        },
      },
    );
  };

  useEffect(
    () => () => {
      codeActionProviderRef.current?.dispose();
      completionProviderRef.current?.dispose();
    },
    [],
  );

  const applyFix = (fix: DiagnosticFix) => {
    const monacoEditor = editorRef.current;
    const monaco = monacoRef.current;
    if (!monacoEditor || !monaco) return;

    monacoEditor.executeEdits(
      "cargo-quick-fix",
      fix.edits.map((edit) => ({
        range: new monaco.Range(
          edit.startLineNumber,
          edit.startColumn,
          edit.endLineNumber,
          edit.endColumn,
        ),
        text: edit.text,
      })),
    );
    monacoEditor.focus();
  };

  const insertAtCursor = (text: string) => {
    const monacoEditor = editorRef.current;
    const monaco = monacoRef.current;
    const model = monacoEditor?.getModel();
    if (!monacoEditor || !monaco || !model) return;

    const selection = monacoEditor.getSelection();
    const position =
      selection?.getStartPosition() ??
      monacoEditor.getPosition() ??
      new monaco.Position(1, 1);
    const offset = model.getOffsetAt(position);
    monacoEditor.executeEdits("mobile-accessory", [
      {
        range:
          selection ??
          new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
        text,
        forceMoveMarkers: true,
      },
    ]);
    const nextPosition = model.getPositionAt(offset + text.length);
    monacoEditor.setPosition(nextPosition);
    monacoEditor.revealPositionInCenterIfOutsideViewport(nextPosition);
    monacoEditor.focus();
  };

  const moveCursor = (offset: number) => {
    const monacoEditor = editorRef.current;
    const model = monacoEditor?.getModel();
    const position = monacoEditor?.getPosition();
    if (!monacoEditor || !model || !position) return;

    const nextOffset = Math.max(
      0,
      Math.min(model.getValueLength(), model.getOffsetAt(position) + offset),
    );
    const nextPosition = model.getPositionAt(nextOffset);
    monacoEditor.setPosition(nextPosition);
    monacoEditor.revealPositionInCenterIfOutsideViewport(nextPosition);
    monacoEditor.focus();
  };

  const updateFontSize = (nextFontSize: number) => {
    const clampedFontSize = clampEditorFontSize(nextFontSize);
    fontSizeRef.current = clampedFontSize;
    setFontSize(clampedFontSize);
    editorRef.current?.updateOptions({ fontSize: clampedFontSize });
  };

  const keepEditorFocus = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-gray-800 bg-[#1e1e1e] shadow-2xl">
      <div
        ref={touchSurfaceRef}
        className="min-h-0 flex-1 overflow-hidden rounded-t-xl"
      >
        <MonacoEditor
          height="100%"
          width="100%"
          language="rust"
          theme="vs-dark"
          value={code}
          onMount={handleMount}
          onChange={(val) => setCode(val || "")}
          options={{
            minimap: { enabled: false },
            fontSize,
            fontFamily:
              "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
          }}
          loading={
            <div className="flex h-full w-full items-center justify-center text-gray-500">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-teal-500" />
                <span className="font-mono text-xs text-gray-400">Loading editor...</span>
              </div>
            </div>
          }
        />
      </div>
      {diagnostics.length > 0 && (
        <div className="max-h-40 shrink-0 space-y-2 overflow-y-auto border-t border-gray-700 px-3 py-2">
          {diagnostics.map((diagnostic, index) => (
            <div
              key={`${diagnostic.code ?? diagnostic.message}-${diagnostic.startLineNumber}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-gray-300 hover:text-white"
                onClick={() => {
                  editorRef.current?.revealLineInCenter(diagnostic.startLineNumber);
                  editorRef.current?.setPosition({
                    lineNumber: diagnostic.startLineNumber,
                    column: diagnostic.startColumn,
                  });
                  editorRef.current?.focus();
                }}
                title={`Go to line ${diagnostic.startLineNumber}: ${diagnostic.message}`}
              >
                <span
                  className={
                    diagnostic.severity === "error"
                      ? "mr-2 text-rose-400"
                      : diagnostic.severity === "warning"
                        ? "mr-2 text-amber-300"
                        : "mr-2 text-sky-300"
                  }
                >
                  {diagnostic.severity.toUpperCase()}
                </span>
                {diagnostic.code ? `${diagnostic.code}: ` : ""}
                {diagnostic.message}
              </button>
              {diagnostic.fixes.map((fix, fixIndex) => (
                <button
                  key={`${fix.title}-${fixIndex}`}
                  type="button"
                  className="shrink-0 rounded border border-teal-500/40 px-2 py-1 font-medium text-teal-200 hover:border-teal-300 hover:bg-teal-500/10"
                  onClick={() => applyFix(fix)}
                >
                  {fix.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {hasTouchInput && (
        <div
          role="toolbar"
          aria-label="Mobile editor accessory bar"
          className="sticky bottom-0 z-20 flex shrink-0 items-center gap-1 overflow-x-auto rounded-b-xl border-t border-gray-700 bg-[#17191d] px-2 py-2 pb-[env(safe-area-inset-bottom)]"
        >
          <button
            type="button"
            aria-label="Move cursor left"
            title="Move cursor left"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-700 text-gray-200 active:bg-gray-700"
            onPointerDown={keepEditorFocus}
            onClick={() => moveCursor(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label="Move cursor right"
            title="Move cursor right"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-700 text-gray-200 active:bg-gray-700"
            onPointerDown={keepEditorFocus}
            onClick={() => moveCursor(1)}
          >
            <ChevronRight size={18} />
          </button>
          <span className="mx-1 h-6 shrink-0 border-l border-gray-700" />
          {["{", "}", "&", "*", "::"].map((symbol) => (
            <button
              key={symbol}
              type="button"
              aria-label={`Insert ${symbol} at cursor`}
              title={`Insert ${symbol}`}
              className="h-9 min-w-9 shrink-0 rounded border border-gray-700 px-2 font-mono text-base text-teal-100 active:bg-teal-900/50"
              onPointerDown={keepEditorFocus}
              onClick={() => insertAtCursor(symbol)}
            >
              {symbol}
            </button>
          ))}
          <span className="mx-1 h-6 shrink-0 border-l border-gray-700" />
          <button
            type="button"
            aria-label="Decrease editor text size"
            title="Decrease text size"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-700 text-gray-200 active:bg-gray-700"
            onPointerDown={keepEditorFocus}
            onClick={() => updateFontSize(fontSize - 1)}
          >
            <Minus size={16} />
          </button>
          <span className="min-w-10 shrink-0 text-center font-mono text-xs text-gray-300">
            {fontSize}px
          </span>
          <button
            type="button"
            aria-label="Increase editor text size"
            title="Increase text size"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-700 text-gray-200 active:bg-gray-700"
            onPointerDown={keepEditorFocus}
            onClick={() => updateFontSize(fontSize + 1)}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            aria-label="Reset editor text size"
            title="Reset text size"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-700 text-gray-200 active:bg-gray-700"
            onPointerDown={keepEditorFocus}
            onClick={() => updateFontSize(DEFAULT_EDITOR_FONT_SIZE)}
          >
            <RotateCcw size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function getTouchDistance(first: Touch, second: Touch) {
  return Math.hypot(
    first.clientX - second.clientX,
    first.clientY - second.clientY,
  );
}

function toMonacoMarkers(
  diagnostics: CargoDiagnostic[],
  monaco: typeof import("monaco-editor"),
): editor.IMarkerData[] {
  return diagnostics.map((diagnostic) => ({
    severity:
      diagnostic.severity === "error"
        ? monaco.MarkerSeverity.Error
        : diagnostic.severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
    message: diagnostic.message,
    startLineNumber: diagnostic.startLineNumber,
    startColumn: diagnostic.startColumn,
    endLineNumber: diagnostic.endLineNumber,
    endColumn: diagnostic.endColumn,
    source: "rustc",
    code: diagnostic.code,
  }));
}

function createCodeAction(
  resource: editor.ITextModel["uri"],
  fix: DiagnosticFix,
  monaco: typeof import("monaco-editor"),
): languages.CodeAction {
  return {
    title: fix.title,
    kind: monaco.languages.CodeActionKind.QuickFix,
    isPreferred: fix.isPreferred,
    edit: {
      edits: fix.edits.map((edit) => ({
        resource,
        textEdit: {
          range: {
            startLineNumber: edit.startLineNumber,
            startColumn: edit.startColumn,
            endLineNumber: edit.endLineNumber,
            endColumn: edit.endColumn,
          },
          text: edit.text,
        },
      })),
    },
  };
}
