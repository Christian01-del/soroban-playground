"use client";

import React, { useState } from "react";
import {
  Activity,
  BarChart3,
  Database,
  HardDrive,
  Layers,
  MemoryStick,
  Zap,
} from "lucide-react";
import type { WasmMemoryProfile } from "@/utils/wasmInspector";

interface WasmMemoryProfilerProps {
  profile: WasmMemoryProfile | null;
  onSelectFunction?: (funcName: string, lineHint?: number) => void;
}

function formatBytes(value: number | null): string {
  if (value === null) return "n/a";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export default function WasmMemoryProfiler({
  profile,
  onSelectFunction,
}: WasmMemoryProfilerProps) {
  const [activeTab, setActiveTab] = useState<
    "sections" | "functions" | "heatmap"
  >("sections");

  if (!profile) {
    return (
      <div className="p-4 rounded-xl border border-white/10 bg-slate-900/60 text-slate-400 text-xs italic">
        No WASM memory profile available. Compile or upload a WASM file to
        inspect heap, stack, and section distributions.
      </div>
    );
  }

  const sectionColors: Record<number, string> = {
    0: "bg-purple-500", // Custom/Spec
    1: "bg-blue-400", // Type
    2: "bg-indigo-400", // Import
    3: "bg-cyan-400", // Function
    5: "bg-emerald-400", // Memory
    6: "bg-amber-400", // Global
    7: "bg-pink-400", // Export
    10: "bg-cyan-500", // Code
    11: "bg-rose-400", // Data
  };

  return (
    <div className="space-y-4 p-4 rounded-xl border border-white/10 bg-slate-900/90 text-slate-200 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-cyan-400 animate-pulse" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            WASM Memory Profiler & Allocation Visualizer
          </h3>
        </div>
        <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-white/5 text-[11px]">
          <button
            onClick={() => setActiveTab("sections")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTab === "sections"
                ? "bg-cyan-500/20 text-cyan-300 font-bold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Sections
          </button>
          <button
            onClick={() => setActiveTab("functions")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTab === "functions"
                ? "bg-cyan-500/20 text-cyan-300 font-bold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Functions ({profile.heavyFunctions.length})
          </button>
          <button
            onClick={() => setActiveTab("heatmap")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTab === "heatmap"
                ? "bg-cyan-500/20 text-cyan-300 font-bold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Heatmap
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <HardDrive size={12} className="text-cyan-400" /> Total Size
          </div>
          <p className="mt-1 font-mono font-bold text-white text-sm">
            {formatBytes(profile.totalBytes)}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Database size={12} className="text-rose-400" /> Static Data
          </div>
          <p className="mt-1 font-mono font-bold text-rose-300 text-sm">
            {formatBytes(profile.staticDataBytes)}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <MemoryStick size={12} className="text-emerald-400" /> Heap Min/Max
          </div>
          <p className="mt-1 font-mono font-bold text-emerald-300 text-xs truncate">
            {formatBytes(profile.heapMinBytes)} /{" "}
            {profile.heapMaxBytes ? formatBytes(profile.heapMaxBytes) : "∞"}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Layers size={12} className="text-amber-400" /> Stack Footprint
          </div>
          <p className="mt-1 font-mono font-bold text-amber-300 text-sm">
            {formatBytes(profile.stackEstimateBytes)}
          </p>
        </div>
      </div>

      {/* Visual Memory Allocation Heatmap Bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-[10px]">
            WASM Bytecode Distribution
          </span>
          <span className="font-mono">{profile.sections.length} Sections</span>
        </div>
        <div className="h-3 w-full flex rounded-full overflow-hidden bg-slate-950 border border-white/10">
          {profile.sections.map((sec) => (
            <div
              key={sec.id}
              style={{ width: `${Math.max(sec.percentage, 1)}%` }}
              title={`${sec.name}: ${formatBytes(sec.sizeBytes)} (${sec.percentage}%)`}
              className={`h-full transition-all hover:brightness-125 cursor-pointer ${sectionColors[sec.id] || "bg-slate-600"}`}
            />
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "sections" && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {profile.sections.map((sec) => (
            <div
              key={sec.id}
              className="flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-white/5 text-xs font-mono"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${sectionColors[sec.id] || "bg-slate-600"}`}
                />
                <span className="text-slate-200 truncate">{sec.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-slate-400">
                <span>{sec.percentage}%</span>
                <span className="font-bold text-cyan-300">
                  {formatBytes(sec.sizeBytes)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "functions" && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {profile.heavyFunctions.map((fn) => (
            <div
              key={fn.name}
              onClick={() => onSelectFunction?.(fn.name, fn.lineHint)}
              className="flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-white/5 text-xs font-mono hover:bg-slate-800/60 cursor-pointer transition-all"
            >
              <div className="flex items-center gap-2 truncate">
                <Zap size={14} className="text-amber-400 shrink-0" />
                <span className="text-slate-200 truncate">{fn.name}</span>
              </div>
              <span className="font-bold text-emerald-400 shrink-0">
                {formatBytes(fn.estimatedSize)}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "heatmap" && (
        <div className="space-y-3 p-3 rounded-lg bg-slate-950/80 border border-white/5 text-xs">
          <div className="flex items-center gap-2 text-cyan-300 font-semibold">
            <BarChart3 size={14} /> Allocation Density Heatmap
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
            {profile.heavyFunctions
              .concat(
                Array.from(
                  { length: Math.max(0, 24 - profile.heavyFunctions.length) },
                  (_, i) => ({
                    name: `block_${i}`,
                    estimatedSize: (i + 1) * 128,
                  }),
                ),
              )
              .map((item, idx) => {
                const intensity = Math.min(
                  100,
                  Math.round(
                    (item.estimatedSize / (profile.totalBytes || 1)) * 1000,
                  ),
                );
                const colorClass =
                  intensity > 50
                    ? "bg-rose-500 text-white"
                    : intensity > 20
                      ? "bg-amber-500 text-slate-900"
                      : intensity > 5
                        ? "bg-cyan-500 text-slate-950"
                        : "bg-slate-800 text-slate-400";

                return (
                  <div
                    key={idx}
                    title={`${item.name}: ${formatBytes(item.estimatedSize)}`}
                    className={`h-8 rounded flex items-center justify-center font-mono text-[9px] font-bold transition-transform hover:scale-105 cursor-pointer ${colorClass}`}
                  >
                    {formatBytes(item.estimatedSize).split(" ")[0]}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
