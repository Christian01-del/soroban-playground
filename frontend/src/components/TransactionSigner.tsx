"use client";

import React from "react";
import { Shield, Info, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useWallet } from "./providers/WalletProvider";

interface TransactionSignerProps {
  xdr?: string;
  onSign?: (signedXdr: string) => void;
  onCancel?: () => void;
  isOpen: boolean;
}

export default function TransactionSigner({
  xdr,
  onSign,
  onCancel,
  isOpen,
}: TransactionSignerProps) {
  const { signTransaction, status, error, network } = useWallet();
  const [isSigning, setIsSigning] = React.useState(false);

  if (!isOpen || !xdr) return null;

  const handleSign = async () => {
    setIsSigning(true);
    try {
      const signedXdr = await signTransaction(xdr);
      if (signedXdr && onSign) {
        onSign(signedXdr);
      }
    } catch (err) {
      console.error("Signing failed", err);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Shield size={20} />
            </div>
            <h2 className="text-xl font-semibold text-white">
              Sign Transaction
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Transaction Details
              </span>
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold uppercase">
                {network ?? "TESTNET"}
              </span>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Operations</span>
                <span className="text-white font-medium">1</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Base Fee</span>
                <span className="text-white font-medium">
                  100 stroops (0.00001 XLM)
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Estimated Gas</span>
                <span className="text-emerald-400 font-medium">
                  Low (1.2k units)
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Raw XDR
            </label>
            <div className="p-3 rounded-xl bg-slate-950/50 border border-white/5 font-mono text-[10px] text-slate-400 break-all max-h-24 overflow-y-auto">
              {xdr}
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200/80 text-xs">
            <Info className="shrink-0 mt-0.5 text-amber-400" size={16} />
            <p>
              Always review transaction details in your wallet extension before
              confirming the signature.
            </p>
          </div>
        </div>

        <div className="p-6 bg-white/5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border border-white/10 text-white font-semibold hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSign}
            disabled={isSigning || status !== "connected"}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSigning ? "Check Wallet..." : "Sign Transaction"}
          </button>
        </div>
      </div>
    </div>
  );
}
