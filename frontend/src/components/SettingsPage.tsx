"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [theme, setTheme] = useState("dark");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [feedback, setFeedback] = useState("");

  function handleSave() {
    setFeedback("Preferences saved successfully.");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">
            Settings
          </p>
          <h1 className="text-3xl font-semibold text-white">Preferences</h1>
          <p className="text-sm text-slate-400">
            Customize the workspace defaults for your Soroban Playground
            experience.
          </p>
        </header>

        <section className="mt-8 space-y-6" aria-label="Preferences">
          <div className="space-y-2">
            <label
              htmlFor="theme-select"
              className="block text-sm font-medium text-slate-200"
            >
              Theme
            </label>
            <select
              id="theme-select"
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>

          <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-800/70 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-white">
                Email notifications
              </span>
              <span className="block text-xs text-slate-400">
                Receive updates when your workflows change.
              </span>
            </span>
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(event) =>
                setNotificationsEnabled(event.target.checked)
              }
              aria-label="Email notifications"
            />
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-800/70 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-white">
                Auto-save drafts
              </span>
              <span className="block text-xs text-slate-400">
                Persist edits automatically while you work.
              </span>
            </span>
            <input
              type="checkbox"
              checked={autoSaveEnabled}
              onChange={(event) => setAutoSaveEnabled(event.target.checked)}
              aria-label="Auto-save drafts"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              Save Preferences
            </button>
            <span className="text-sm text-cyan-300" role="status">
              {feedback}
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
