"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Code2 } from "lucide-react";
import ActionToolbar from "@/components/playground/ActionToolbar";
import {
  selectCode,
  selectSetCode,
  usePlaygroundStore,
} from "@/state/playgroundStore";

const Editor = dynamic(() => import("@/components/Editor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full text-gray-500">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500" />
        <span className="text-xs font-mono text-gray-400">
          Loading editor...
        </span>
      </div>
    </div>
  ),
});

interface EditorPaneProps {
  apiBaseUrl: string;
  onFormat: () => void;
}

function EditorPane({ apiBaseUrl, onFormat }: EditorPaneProps) {
  const code = usePlaygroundStore(selectCode);
  const setCode = usePlaygroundStore(selectSetCode);

  return (
    <section className="flex min-h-[560px] flex-col border-b border-white/8 p-4 lg:border-b-0 lg:border-r">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            <Code2 size={14} />
            Contract Editor
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Edit `lib.rs`, then compile against the backend toolchain.
          </p>
        </div>
        <ActionToolbar apiBaseUrl={apiBaseUrl} onFormat={onFormat} />
      </div>
      <Editor code={code} setCode={setCode} />
    </section>
  );
}

export default React.memo(EditorPane);