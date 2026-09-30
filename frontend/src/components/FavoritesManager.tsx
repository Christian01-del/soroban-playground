"use client";

import React, { useEffect, useState } from "react";

export type TemplateItem = {
  id: string;
  name: string;
  category?: string;
  path?: string;
  description?: string;
};

const STORAGE_KEY = "tpl_favorites";

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch {
      setFavorites([]);
    }
  }, []);

  useEffect(() => {
    const onStorage = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        setFavorites(raw ? JSON.parse(raw) : []);
      } catch {
        setFavorites([]);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch {}
  }, [favorites]);

  const toggle = (id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [id, ...prev],
    );
  };

  const isFavorite = (id: string) => favorites.includes(id);

  return { favorites, toggle, isFavorite, setFavorites };
}

export default function FavoritesManager({
  templates,
  onOpen,
}: {
  templates: TemplateItem[];
  onOpen?: (t: TemplateItem) => void;
}) {
  const { favorites, toggle } = useFavorites();

  const favTemplates = favorites
    .map((id) => templates.find((t) => t.id === id))
    .filter(Boolean) as TemplateItem[];

  return (
    <div className="p-3 bg-slate-900/40 border border-slate-800 rounded-xl">
      <h3 className="text-xs font-semibold text-slate-300 uppercase mb-2">
        Favorites
      </h3>
      {favTemplates.length === 0 ? (
        <p className="text-[12px] text-slate-500">
          No favorites yet — click the star on a template.
        </p>
      ) : (
        <div className="space-y-2">
          {favTemplates.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between bg-slate-800/50 p-2 rounded"
            >
              <div>
                <div className="text-sm font-medium text-white">{t.name}</div>
                <div className="text-[11px] text-slate-400">
                  {t.description}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpen?.(t)}
                  className="px-2 py-1 text-xs rounded bg-teal-500/10 text-teal-300 border border-teal-500/20"
                >
                  Open
                </button>
                <button
                  onClick={() => toggle(t.id)}
                  title="Unfavorite"
                  className="text-amber-400 hover:text-amber-300"
                >
                  ★
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
