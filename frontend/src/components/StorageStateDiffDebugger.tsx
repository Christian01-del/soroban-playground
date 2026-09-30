"use client";

import React, { useState, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Eye,
  FileCode,
  History,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import StorageViewer from "@/components/StorageViewer";
import type { LedgerState } from "@/utils/transactionGraph";

export type StorageCategory = "instance" | "persistent" | "temporary";

export interface SnapshotFrame {
  id: number;
  label: string;
  contractMethod: string;
  timestamp: string;
  category: StorageCategory;
  state: LedgerState;
}

const DEMO_SNAPSHOT_FRAMES: SnapshotFrame[] = [
  {
    id: 1,
    label: "Initial State (Pre-Execution)",
    contractMethod: "initialize(admin, asset)",
    timestamp: "10:00:00.000",
    category: "instance",
    state: {
      admin: "GABC1234567890XYZTESTACCOUNTADDRESSFULL1234567890AB",
      is_initialized: true,
      token_symbol: "USDC",
      total_deposits: 0,
      active_auctions: 0,
    },
  },
  {
    id: 2,
    label: "Invocation #1: Deposit Asset",
    contractMethod: "deposit(user_a, 5000)",
    timestamp: "10:00:15.200",
    category: "persistent",
    state: {
      admin: "GABC1234567890XYZTESTACCOUNTADDRESSFULL1234567890AB",
      is_initialized: true,
      token_symbol: "USDC",
      total_deposits: 5000,
      active_auctions: 0,
      "balances.user_a": 5000,
      "nonce.user_a": 1,
      temp_session_key: "sess_8923748291",
    },
  },
  {
    id: 3,
    label: "Invocation #2: Create Auction",
    contractMethod: "create_auction(id=101, start_price=1000)",
    timestamp: "10:00:32.850",
    category: "instance",
    state: {
      admin: "GABC1234567890XYZTESTACCOUNTADDRESSFULL1234567890AB",
      is_initialized: true,
      token_symbol: "USDC",
      total_deposits: 5000,
      active_auctions: 1,
      "balances.user_a": 5000,
      "nonce.user_a": 1,
      "auction.101.seller": "user_a",
      "auction.101.start_price": 1000,
      "auction.101.status": "active",
      temp_session_key: "sess_8923748291",
    },
  },
  {
    id: 4,
    label: "Invocation #3: Bid & Settlement",
    contractMethod: "buy(buyer=user_b, amount=900)",
    timestamp: "10:01:05.110",
    category: "temporary",
    state: {
      admin: "GABC1234567890XYZTESTACCOUNTADDRESSFULL1234567890AB",
      is_initialized: true,
      token_symbol: "USDC",
      total_deposits: 5900,
      active_auctions: 0,
      "balances.user_a": 5900,
      "balances.user_b": 4100,
      "nonce.user_a": 1,
      "nonce.user_b": 1,
      "auction.101.seller": "user_a",
      "auction.101.winner": "user_b",
      "auction.101.final_price": 900,
      "auction.101.status": "settled",
      // temp_session_key expired/removed
    },
  },
];

export default function StorageStateDiffDebugger() {
  const [frames, setFrames] = useState<SnapshotFrame[]>(DEMO_SNAPSHOT_FRAMES);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | StorageCategory
  >("all");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const currentFrame = frames[currentFrameIndex] ?? frames[0];
  const previousFrame =
    currentFrameIndex > 0 ? frames[currentFrameIndex - 1] : undefined;

  const handleNextFrame = () => {
    if (currentFrameIndex < frames.length - 1) {
      setCurrentFrameIndex((prev) => prev + 1);
    }
  };

  const handlePrevFrame = () => {
    if (currentFrameIndex > 0) {
      setCurrentFrameIndex((prev) => prev - 1);
    }
  };

  const handleReset = () => {
    setCurrentFrameIndex(0);
    setIsPlaying(false);
  };

  // Filtered storage state based on search query
  const filteredCurrentState = useMemo(() => {
    if (!searchQuery) return currentFrame.state;
    const q = searchQuery.toLowerCase();
    const result: LedgerState = {};
    for (const [key, val] of Object.entries(currentFrame.state)) {
      if (
        key.toLowerCase().includes(q) ||
        String(val).toLowerCase().includes(q)
      ) {
        result[key] = val;
      }
    }
    return result;
  }, [currentFrame.state, searchQuery]);

  const filteredPreviousState = useMemo(() => {
    if (!previousFrame) return undefined;
    if (!searchQuery) return previousFrame.state;
    const q = searchQuery.toLowerCase();
    const result: LedgerState = {};
    for (const [key, val] of Object.entries(previousFrame.state)) {
      if (
        key.toLowerCase().includes(q) ||
        String(val).toLowerCase().includes(q)
      ) {
        result[key] = val;
      }
    }
    return result;
  }, [previousFrame, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 backdrop-blur-xl shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-teal-400 uppercase tracking-widest">
              <History size={16} />
              <span>Smart Contract Storage Inspector</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-1 flex items-center gap-2">
              Time-Travel Debugger & State Diff
            </h2>
          </div>

          {/* Time travel playback buttons */}
          <div className="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800">
            <button
              onClick={handleReset}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Reset to initial frame"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={handlePrevFrame}
              disabled={currentFrameIndex === 0}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
              title="Step backward"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-mono text-xs font-semibold text-teal-300 px-3 tabular-nums">
              Frame {currentFrameIndex + 1} / {frames.length}
            </span>
            <button
              onClick={handleNextFrame}
              disabled={currentFrameIndex === frames.length - 1}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
              title="Step forward"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Timeline Slider */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span className="truncate">
              Method:{" "}
              <strong className="text-teal-300">
                {currentFrame.contractMethod}
              </strong>
            </span>
            <span className="text-slate-500">{currentFrame.timestamp}</span>
          </div>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={currentFrameIndex}
            onChange={(e) => setCurrentFrameIndex(Number(e.target.value))}
            className="w-full accent-teal-400 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
          />
        </div>

        {/* Category filter tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
          <div className="flex items-center gap-1.5">
            {(["all", "instance", "persistent", "temporary"] as const).map(
              (cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition ${
                    selectedCategory === cat
                      ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  {cat}
                </button>
              ),
            )}
          </div>

          {/* Filter Search input */}
          <div className="relative w-full sm:w-64">
            <Search
              size={14}
              className="absolute left-3 top-2.5 text-slate-500"
            />
            <input
              type="text"
              placeholder="Search storage key/val…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500/60"
            />
          </div>
        </div>
      </div>

      {/* Storage State Diff Viewer Component */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
        <StorageViewer
          storage={filteredCurrentState}
          previousStorage={filteredPreviousState}
          contextLabel={currentFrame.label}
          totalFrames={frames.length}
          currentFrame={currentFrameIndex}
          capturedAt={currentFrame.timestamp}
          onScrubTimeline={(index) => setCurrentFrameIndex(index)}
        />
      </div>
    </div>
  );
}
