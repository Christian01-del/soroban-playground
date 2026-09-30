"use client";

import React, { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
} from "reactflow";
import type { Edge, Node } from "reactflow";
import "reactflow/dist/style.css";
import type { TransactionCallGraph } from "@/utils/transactionGraph";
import {
  createNodeStyle,
  createEdgeStyle,
} from "@/utils/transactionGraphStyles";

interface TransactionCallGraphCanvasProps {
  graph: TransactionCallGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
}

export default function TransactionCallGraphCanvas({
  graph,
  selectedNodeId,
  onNodeSelect,
}: TransactionCallGraphCanvasProps) {
  const { fitView } = useReactFlow();

  const nodes = useMemo<Node[]>(() => {
    return graph.nodes.map((node) => ({
      id: node.id,
      position: {
        x: node.depth * 320,
        y: node.indexInDepth * 150,
      },
      data: {
        label: (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">
              {node.contractId}
            </p>
            <p className="text-sm font-semibold text-gray-100">
              {node.functionName}
            </p>
            <p className="text-xs text-cyan-300 break-all">
              {node.argsSummary}
            </p>
            {node.resultSummary && (
              <p className="text-xs text-emerald-300 break-all">
                ↳ {node.resultSummary}
              </p>
            )}
          </div>
        ),
      },
      style: createNodeStyle(selectedNodeId === node.id),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
    }));
  }, [graph.nodes, selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    const baseStyle = createEdgeStyle();
    return graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "smoothstep",
      animated: true,
      ...baseStyle,
    }));
  }, [graph.edges]);

  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 });
  }, [fitView, nodes.length]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.25}
      maxZoom={1.8}
      onNodeClick={(_, node) => onNodeSelect(node.id)}
      proOptions={{ hideAttribution: true }}
      className="bg-gray-950"
      defaultEdgeOptions={{
        style: { stroke: "#38bdf8" },
      }}
    >
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        className="!bg-gray-900 !border !border-gray-700"
        nodeColor={(node) =>
          node.id === selectedNodeId ? "#38bdf8" : "#64748b"
        }
      />
      <Controls className="!bg-gray-900 !border !border-gray-700" />
      <Background gap={18} size={1} color="#1f2937" />
    </ReactFlow>
  );
}
