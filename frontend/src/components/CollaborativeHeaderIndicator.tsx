"use client";

import React from "react";
import { Users, Wifi, WifiOff } from "lucide-react";
import type { PeerUser } from "@/hooks/useCollaborativeEditor";

interface CollaborativeHeaderIndicatorProps {
  peers: PeerUser[];
  isConnected: boolean;
  docId?: string;
}

export function CollaborativeHeaderIndicator({
  peers,
  isConnected,
  docId = "default-doc",
}: CollaborativeHeaderIndicatorProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 font-medium">
        {isConnected ? (
          <Wifi className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-slate-500" />
        )}
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Collab ({peers.length + 1})
        </span>
      </div>

      <div className="flex -space-x-1 overflow-hidden">
        <div
          title="You"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-600 text-[10px] font-bold text-white ring-2 ring-slate-950"
        >
          Y
        </div>
        {peers.map((peer) => (
          <div
            key={peer.id}
            title={`${peer.name} (${peer.cursor ? `L${peer.cursor.line}:C${peer.cursor.column}` : "Active"})`}
            style={{ backgroundColor: peer.color || "#6366f1" }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-slate-950 uppercase"
          >
            {peer.name.charAt(0)}
          </div>
        ))}
      </div>
    </div>
  );
}
