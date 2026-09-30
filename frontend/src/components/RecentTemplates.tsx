"use client";

import React, { useEffect, useState } from "react";
import { TemplateItem } from "./FavoritesManager";

const STORAGE_KEY = "tpl_recents";

type RecentEntry = { id: string; at: number };

export function useRecents() {
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setRecents(JSON.parse(raw));
    } catch {
      setRecents([]);
    }
  }, []);

  useEffect(() => {
    const onStorage = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        setRecents(raw ? JSON.parse(raw) : []);
      } catch {
        setRecents([]);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
    } catch {}
  }, [recents]);

  const record = (id: string) => {
    setRecents((prev) => {
      const filtered = prev.filter((r) => r.id !== id);
      return [{ id, at: Date.now() }, ...filtered].slice(0, 20);
    });
  };

  return { recents, record, setRecents };
}

export default function RecentTemplates({
  templates,
  onOpen,
}: {
  templates: TemplateItem[];
  onOpen?: (t: TemplateItem) => void;
}) {
  const { recents, record } = useRecents();

  const items = recents
    .map((r) => ({ ...r, meta: templates.find((t) => t.id === r.id) }))
    .filter((r) => r.meta)
    .slice(0, 10) as Array<RecentEntry & { meta: TemplateItem }>;

  return (
    <div className="p-3 bg-slate-900/40 border border-slate-800 rounded-xl">
      <h3 className="text-xs font-semibold text-slate-300 uppercase mb-2">
        Recent
      </h3>
      {items.length === 0 ? (
        <p className="text-[12px] text-slate-500">No recent templates yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between p-2 rounded bg-slate-800/50"
            >
              <div>
                <div className="text-sm text-white">{r.meta.name}</div>
                <div className="text-[11px] text-slate-400">
                  {r.meta.description}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    record(r.id);
                    onOpen?.(r.meta);
                  }}
                  className="px-2 py-1 text-xs rounded bg-teal-500/10 text-teal-300 border border-teal-500/20"
                >
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
