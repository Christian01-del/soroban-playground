"use client";

import React, { useMemo } from "react";
import { AlertCircle, UserCheck } from "lucide-react";
import {
  type ContractAbiFunctionInput,
  normalizeType,
  validateSorobanType,
} from "@/utils/contractAbi";
import { useWallet } from "./providers/WalletProvider";

interface WasmSpecFormBuilderProps {
  inputs: ContractAbiFunctionInput[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

const FormInputItem = React.memo(({
  input,
  value,
  onChange,
  activeWalletAddress,
}: {
  input: ContractAbiFunctionInput;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  activeWalletAddress: string | null;
}) => {
  const inputId = `wasm-spec-input-${input.name}`;
  const kind = useMemo(() => normalizeType(input.type), [input.type]);
  const fieldError = useMemo(
    () => (value !== undefined ? validateSorobanType(input.name, input.type, value) : null),
    [input.name, input.type, value],
  );

  return (
    <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/50 border border-white/5">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
          <span>{input.name}</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-white/5">
            {input.type}
          </span>
        </label>
        {kind === "address" && activeWalletAddress && (
          <button
            type="button"
            onClick={() => onChange(input.name, activeWalletAddress)}
            className="flex items-center gap-1 text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <UserCheck size={12} />
            Use Active Wallet
          </button>
        )}
      </div>

      {input.doc && <p className="text-[11px] text-slate-400">{input.doc}</p>}

      {kind === "bool" ? (
        <label htmlFor={inputId} className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-900 border border-white/10 text-xs text-slate-200 cursor-pointer">
          <input
            id={inputId}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(input.name, e.target.checked)}
            className="w-4 h-4 rounded text-cyan-500 bg-slate-950 border-slate-700"
          />
          <span>Enable / True</span>
        </label>
      ) : kind === "address" ? (
        <input
          id={inputId}
          type="text"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(input.name, e.target.value)}
          placeholder="G... or C... (56 characters)"
          className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
        />
      ) : kind === "symbol" ? (
        <input
          id={inputId}
          type="text"
          maxLength={32}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(input.name, e.target.value)}
          placeholder="e.g. transfer, admin, token_id"
          className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
        />
      ) : kind === "u128" ? (
        <input
          id={inputId}
          type="text"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(input.name, e.target.value)}
          placeholder="e.g. 1000000000000000000"
          className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
        />
      ) : kind === "enum" && input.enumVariants && input.enumVariants.length > 0 ? (
        <select
          id={inputId}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(input.name, e.target.value)}
          className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
        >
          <option value="">Select Variant</option>
          {input.enumVariants.map((variant) => (
            <option key={variant} value={variant}>
              {variant}
            </option>
          ))}
        </select>
      ) : kind === "vec" ? (
        <div className="space-y-2">
          <textarea
            id={inputId}
            rows={2}
            value={Array.isArray(value) ? JSON.stringify(value) : String(value ?? "[]")}
            onChange={(e) => {
              try {
                const arr = JSON.parse(e.target.value);
                onChange(input.name, arr);
              } catch {
                onChange(input.name, e.target.value);
              }
            }}
            placeholder='["item1", "item2"] or [10, 20]'
            className="w-full bg-slate-900 border border-white/10 rounded-lg p-2.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500 resize-none"
          />
        </div>
      ) : kind === "number" ? (
        <input
          id={inputId}
          type="number"
          value={value === undefined || value === null || value === "" ? "" : String(value)}
          onChange={(e) => onChange(input.name, e.target.value)}
          className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
        />
      ) : (
        <input
          id={inputId}
          type="text"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(input.name, e.target.value)}
          placeholder={`Enter ${input.type}`}
          className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
        />
      )}

      {fieldError && (
        <p className="flex items-center gap-1 text-[11px] text-rose-400 pt-0.5">
          <AlertCircle size={12} className="shrink-0" />
          {fieldError}
        </p>
      )}
    </div>
  );
});
FormInputItem.displayName = "FormInputItem";

export default function WasmSpecFormBuilder({ inputs, values, onChange }: WasmSpecFormBuilderProps) {
  const { address: activeWalletAddress } = useWallet();

  if (!inputs || inputs.length === 0) {
    return (
      <div className="p-3 rounded-lg bg-slate-950/40 border border-white/5 text-xs text-slate-400 italic">
        This contract method requires no parameters.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {inputs.map((input) => (
        <FormInputItem
          key={input.name}
          input={input}
          value={values[input.name]}
          onChange={onChange}
          activeWalletAddress={activeWalletAddress}
        />
      ))}
    </div>
  );
}
