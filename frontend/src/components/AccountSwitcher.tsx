"use client";

import React from "react";
import { User, Copy, Check, ChevronDown, LogOut } from "lucide-react";
import { useWallet } from "./providers/WalletProvider";

export default function AccountSwitcher() {
  const {
    activeAccount,
    allAccounts,
    switchAccount,
    disconnect,
    activeWallet,
  } = useWallet();
  const [copied, setCopied] = React.useState(false);

  if (!activeAccount)
    return (
      <div className="rounded-2xl border border-white/8 bg-white/5 overflow-hidden p-4">
        <p className="text-sm text-slate-400">No active account connected.</p>
      </div>
    );

  const copyToClipboard = async (text: string) => {
    try {
      if (!navigator?.clipboard || !navigator.clipboard.writeText) {
        console.warn("Clipboard API not available");
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy address to clipboard", e);
    }
  };

  const shortAddress = (address?: string) => {
    if (!address || typeof address !== "string") return "-";
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 overflow-hidden">
      <div className="p-4 border-b border-white/8 bg-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-slate-900">
            <User size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Active {activeWallet} Account
            </p>
            <p className="font-mono text-sm text-white">
              {shortAddress(activeAccount)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => copyToClipboard(activeAccount)}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Copy address"
          >
            {copied ? (
              <Check size={16} className="text-emerald-400" />
            ) : (
              <Copy size={16} />
            )}
          </button>
          <button
            onClick={disconnect}
            className="p-2 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
            title="Disconnect"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      <div className="p-2 max-h-48 overflow-y-auto">
        <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Connected Accounts
        </p>
        {(Array.isArray(allAccounts) ? allAccounts : []).map((account) => (
          <button
            key={account.address}
            onClick={() => switchAccount(account.address)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all ${
              activeAccount === account.address
                ? "bg-cyan-500/10 text-cyan-300"
                : "text-slate-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className="font-mono">{shortAddress(account.address)}</span>
            {activeAccount === account.address && <Check size={14} />}
          </button>
        ))}
      </div>

      <div className="px-5 py-3 bg-slate-900/50">
        <p className="text-[11px] text-slate-400 italic">
          Tip: Change active account in your {activeWallet} extension to see
          more accounts.
        </p>
      </div>
    </div>
  );
}
