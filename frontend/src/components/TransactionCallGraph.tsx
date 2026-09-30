"use client";

import React from "react";
import { GitBranchPlus } from "lucide-react";
import { ReactFlowProvider } from "reactflow";
import type { TransactionCallGraph } from "@/utils/transactionGraph";
import TransactionCallGraphCanvas from "@/components/TransactionCallGraphCanvas";

interface TransactionCallGraphProps {
  graph: TransactionCallGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
}

export default function TransactionCallGraph({
  graph,
  selectedNodeId,
  onNodeSelect,
}: TransactionCallGraphProps) {
  return (
    <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg mt-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center">
        <GitBranchPlus size={16} className="mr-2 text-cyan-400" />
        Transaction Call Graph
      </h3>
      {graph.nodes.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          Run a contract call to visualize cross-contract invocation paths.
        </p>
      ) : (
        <div className="h-[380px] w-full rounded-lg overflow-hidden border border-gray-800">
          <ReactFlowProvider>
            <TransactionCallGraphCanvas
              graph={graph}
              selectedNodeId={selectedNodeId}
              onNodeSelect={onNodeSelect}
            />
          </ReactFlowProvider>
        </div>
      )}
    </div>
  );
}
