"use client";

import React from "react";
import { type ContractAbiFunction } from "@/utils/contractAbi";
import WasmSpecFormBuilder from "./WasmSpecFormBuilder";

interface AbiViewerProps {
  abiFunction: ContractAbiFunction;
  values: Record<string, unknown>;
  onFieldChange: (name: string, value: unknown) => void;
}

export default function AbiViewer({
  abiFunction,
  values,
  onFieldChange,
}: AbiViewerProps) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/60 p-4">
      <div className="flex items-center justify-between border-b border-gray-800 pb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
          WASM Spec Parameter Builder
        </span>
        <span className="text-[11px] font-mono text-gray-500">
          {abiFunction.inputs?.length ?? 0} Parameters
        </span>
      </div>
      {abiFunction.doc && (
        <p className="text-[11px] text-gray-400 italic">{abiFunction.doc}</p>
      )}
      <WasmSpecFormBuilder
        inputs={abiFunction.inputs ?? []}
        values={values}
        onChange={onFieldChange}
      />
    </div>
  );
}
