"use client";

import React from "react";
import { BookOpen, Code2 } from "lucide-react";
import ShareSnippet from "@/components/ShareSnippet";
import {
  selectCode,
  usePlaygroundStore,
} from "@/state/playgroundStore";

interface ActionToolbarProps {
  apiBaseUrl: string;
  onFormat: () => void;
}

function ActionToolbar({ apiBaseUrl, onFormat }: ActionToolbarProps) {
  const code = usePlaygroundStore(selectCode);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onFormat}
        className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20"
      >
        <Code2 size={14} />
        Format
      </button>
      <a
        href="https://developers.stellar.org/docs/build/smart-contracts/getting-started"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-200"
      >
        <BookOpen size={14} />
        Soroban Docs
      </a>
      <ShareSnippet code={code} apiBaseUrl={apiBaseUrl} />
    </div>
  );
}

export default React.memo(ActionToolbar);