"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Pause,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import StorageViewer from "@/components/StorageViewer";
import type { LedgerState } from "@/utils/transactionGraph";
import {
  useStorageTimelineStore,
  type StorageSnapshot,
} from "@/state/storageTimeline";

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
    },
  },
];

function snapshotToFrame(snap: StorageSnapshot, index: number): SnapshotFrame {
  const sourceToCategory: Record<string, StorageCategory> = {
    deployment: "instance",
    transaction: "persistent",
  };
  return {
    id: index,
    label: snap.label,
    contractMethod: snap.contextLabel,
    timestamp: snap.capturedAt,
    category: sourceToCategory[snap.source] ?? "instance",
    state: snap.state,
  };
}

const PLAY_INTERVAL_MS = 1200;

export default function StorageStateDiffDebugger() {
  const storeSnapshots = useStorageTimelineStore((s) => s.snapshots);
  const storeCurrentIndex = useStorageTimelineStore((s) => s.currentIndex);
  const selectSnapshotIndex = useStorageTimelineStore(
    (s) => s.selectSnapshotIndex,
  );
  const clearSnapshots = useStorageTimelineStore((s) => s.clearSnapshots);

  const liveFrames: SnapshotFrame[] = useMemo(
    () =>
      storeSnapshots.length > 0
        ? storeSnapshots.map(snapshotToFrame)
        : DEMO_SNAPSHOT_FRAMES,
    [storeSnapshots],
  );

  const isLive = storeSnapshots.length > 0;

  const [localIndex, setLocalIndex] = useState<number>(0);
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | StorageCategory
  >("all");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentFrameIndex = isLive ? storeCurrentIndex : localIndex;

  const setFrameIndex = (index: number) => {
    if (isLive) {
      selectSnapshotIndex(index);
    } else {
      setLocalIndex(index);
    }
  };

  useEffect(() => {
    if (!isLive) setLocalIndex(0);
  }, [isLive]);

  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        const total = liveFrames.length;
        const next = currentFrameIndex + 1;
        if (next >= total) {
          setIsPlaying(false);
        } else {
          setFrameIndex(next);
        }
      }, PLAY_INTERVAL_MS);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, currentFrameIndex, liveFrames.length]);

  const visibleFrames = useMemo(() => {
    if (selectedCategory === "all") return liveFrames;
    return liveFrames.filter((f) => f.category === selectedCategory);
  }, [liveFrames, selectedCategory]);

  const visibleIndex = useMemo(() => {
    if (selectedCategory === "all") return currentFrameIndex;
    const globalFrame = liveFrames[currentFrameIndex];
    if (!globalFrame) return 0;
    const idx = visibleFrames.findIndex((f) => f.id === globalFrame.id);
    return idx === -1 ? 0 : idx;
  }, [selectedCategory, liveFrames, currentFrameIndex, visibleFrames]);

  const currentFrame = visibleFrames[visibleIndex] ?? visibleFrames[0];
  const previousFrame =
    visibleIndex > 0 ? visibleFrames[visibleIndex - 1] : undefined;

  const handleNextFrame = () => {
    const globalIdx = liveFrames.indexOf(currentFrame);
    if (globalIdx < liveFrames.length - 1) setFrameIndex(globalIdx + 1);
  };

  const handlePrevFrame = () => {
    const globalIdx = liveFrames.indexOf(currentFrame);
    if (globalIdx > 0) setFrameIndex(globalIdx - 1);
  };

  const handleReset = () => {
    setFrameIndex(0);
    setIsPlaying(false);
  };

  const handleClear = () => {
    if (isLive) clearSnapshots();
    setLocalIndex(0);
    setIsPlaying(false);
  };

  const filteredCurrentState = useMemo(() => {
    if (!currentFrame) return {};
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
  }, [currentFrame, searchQuery]);

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

  if (!currentFrame) return null;

  const atStart = visibleIndex === 0;
  const atEnd = visibleIndex === visibleFrames.length - 1;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 backdrop-blur-xl shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-teal-400 uppercase tracking-widest">
              <History size={16} />
              <span>Smart Contract Storage Inspector</span>
              {!isLive && (
                <span className="text-slate-500 normal-case font-normal">
                  (demo)
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-white mt-1 flex items-center gap-2">
              Time-Travel Debugger & State Diff
            </h2>
          </div>

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
              disabled={atStart}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
              title="Step backward"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setIsPlaying((p) => !p)}
              disabled={atEnd && !isPlaying}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
              title={isPlaying ? "Pause" : "Play"}
              aria-label={isPlaying ? "Pause playback" : "Play playback"}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span className="font-mono text-xs font-semibold text-teal-300 px-3 tabular-nums">
              Frame {visibleIndex + 1} / {visibleFrames.length}
            </span>
            <button
              onClick={handleNextFrame}
              disabled={atEnd}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
              title="Step forward"
            >
              <ChevronRight size={16} />
            </button>
            {isLive && (
              <button
                onClick={handleClear}
                className="p-2 rounded-lg text-rose-400 hover:text-rose-200 hover:bg-slate-800 transition"
                title="Clear snapshots"
                aria-label="Clear snapshots"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

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
            max={Math.max(0, visibleFrames.length - 1)}
            value={visibleIndex}
            onChange={(e) => {
              const vis = Number(e.target.value);
              const globalIdx = liveFrames.indexOf(visibleFrames[vis]);
              if (globalIdx !== -1) setFrameIndex(globalIdx);
            }}
            className="w-full accent-teal-400 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
            aria-label="Storage timeline slider"
          />
        </div>

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

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
        <StorageViewer
          storage={filteredCurrentState}
          previousStorage={filteredPreviousState}
          contextLabel={currentFrame.label}
          totalFrames={visibleFrames.length}
          currentFrame={visibleIndex}
          capturedAt={currentFrame.timestamp}
          onScrubTimeline={(index) => {
            const globalIdx = liveFrames.indexOf(visibleFrames[index]);
            if (globalIdx !== -1) setFrameIndex(globalIdx);
          }}
        />
      </div>
    </div>
  );
}
