"use client";

import React from "react";
import {
  Wallet,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  ShieldCheck,
  RefreshCw,
  KeyRound,
  Smartphone,
  Usb,
} from "lucide-react";
import { useWallet, WalletType } from "./providers/WalletProvider";

interface WalletOption {
  id: WalletType;
  name: string;
  description: string;
  icon: React.ReactNode;
  installUrl: string;
  typeBadge: string;
}

export default function WalletConnectionWizard() {
  const {
    connect,
    disconnect,
    activeWallet,
    activeAccount,
    allAccounts,
    switchAccount,
    status,
    error,
    reauthenticationRequired,
    reauthenticate,
    sessionValidation,
    isWalletDetected,
    retry,
    lastAttemptedWallet,
  } = useWallet();

  const wallets: WalletOption[] = [
    {
      id: "freighter",
      name: "Freighter",
      description:
        "Official browser extension for Stellar & Soroban smart contracts",
      icon: <Wallet className="text-cyan-400" size={22} />,
      installUrl: "https://freighter.app",
      typeBadge: "Extension",
    },
    {
      id: "albedo",
      name: "Albedo Link",
      description: "Web-based non-custodial wallet & intent signer",
      icon: <ShieldCheck className="text-purple-400" size={22} />,
      installUrl: "https://albedo.link",
      typeBadge: "Web Link",
    },
    {
      id: "xbull",
      name: "xBull Wallet",
      description: "Cross-platform Stellar & Soroban power wallet",
      icon: <KeyRound className="text-emerald-400" size={22} />,
      installUrl: "https://xbull.app",
      typeBadge: "Extension / Mobile",
    },
    {
      id: "hana",
      name: "Hana Wallet",
      description: "Stellar browser wallet for accounts and Soroban signing",
      icon: <Smartphone className="text-blue-400" size={22} />,
      installUrl: "https://hana.money",
      typeBadge: "Extension",
    },
    {
      id: "walletconnect",
      name: "WalletConnect",
      description: "Connect a compatible Stellar wallet with a QR code",
      icon: <RefreshCw className="text-indigo-300" size={22} />,
      installUrl: "https://walletconnect.com/wallets",
      typeBadge: "Mobile / QR",
    },
    {
      id: "ledger",
      name: "Ledger",
      description: "Review and sign Stellar transactions on your hardware wallet",
      icon: <Usb className="text-amber-300" size={22} />,
      installUrl: "https://www.ledger.com/",
      typeBadge: "WebHID / WebUSB",
    },
  ];

  return (
    <div className="space-y-6">
      {reauthenticationRequired && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-amber-400 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
          role="status"
          aria-live="polite"
        >
          <span>Reconnect your wallet to refresh this session.</span>
          <button
            onClick={reauthenticate}
            className="inline-flex items-center gap-1.5 font-semibold text-amber-200 hover:text-white"
          >
            <RefreshCw size={14} />
            Reconnect
          </button>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Wallet className="text-cyan-400" size={20} />
            Unified Stellar Wallet Suite
          </h2>
          <p className="text-xs text-slate-400">
            Connect your preferred wallet to sign transactions and interact with
            Soroban contracts.
          </p>
        </div>
        {status === "connected" && (
          <button
            onClick={disconnect}
            className="px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-all"
          >
            Disconnect Wallet
          </button>
        )}
      </div>

      {status === "connected" && activeAccount && (
        <div className="p-4 rounded-2xl border border-cyan-500/30 bg-cyan-950/30 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-cyan-300 uppercase tracking-wider">
              Active Wallet Connection
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold uppercase text-[10px]">
              Connected
            </span>
          </div>
          {sessionValidation === "checking" && (
            <p className="text-[11px] text-slate-400" role="status">
              Verifying account on Horizon...
            </p>
          )}
          {sessionValidation === "unavailable" && (
            <p className="text-[11px] text-amber-300" role="status">
              Horizon is unavailable; the wallet remains connected.
            </p>
          )}
          <div className="font-mono text-xs text-slate-200 bg-slate-950 p-2.5 rounded-xl border border-white/5 truncate">
            {activeAccount}
          </div>

          {allAccounts.length > 1 && (
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Switch Account / Signature Key
              </label>
              <select
                value={activeAccount}
                onChange={(e) => switchAccount(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {allAccounts.map((acc) => (
                  <option key={acc.address} value={acc.address}>
                    {acc.name
                      ? `${acc.name} (${acc.address.slice(0, 8)}...)`
                      : acc.address}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {wallets.map((wallet) => {
          const isDetected = isWalletDetected(wallet.id);
          const isActive = activeWallet === wallet.id && status === "connected";
          const isConnecting =
            lastAttemptedWallet === wallet.id && status === "connecting";

          return (
            <div
              key={wallet.id}
              className={`relative flex flex-col p-5 rounded-2xl border transition-all ${
                isActive
                  ? "bg-cyan-500/10 border-cyan-500/50 ring-1 ring-cyan-500/20"
                  : "bg-white/5 border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div
                  className={`p-3 rounded-xl ${isActive ? "bg-cyan-500/20" : "bg-white/5"}`}
                >
                  {wallet.icon}
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-white/5">
                  {wallet.typeBadge}
                </span>
              </div>

              <h3 className="text-base font-bold text-white mb-1 flex items-center gap-1.5">
                {wallet.name}
                {isActive && (
                  <CheckCircle2 className="text-cyan-400 shrink-0" size={18} />
                )}
                {isConnecting && (
                  <Loader2
                    className="text-cyan-400 animate-spin shrink-0"
                    size={18}
                  />
                )}
              </h3>

              <p className="text-xs text-slate-400 leading-relaxed mb-4">
                {wallet.description}
              </p>

              {!isDetected ? (
                <div className="mt-auto space-y-3 pt-2">
                  <p className="text-[11px] text-slate-500">
                    {wallet.id === "walletconnect" &&
                    !process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
                      ? "Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable."
                      : "Not detected in browser."}
                  </p>
                  <a
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    <ExternalLink size={14} />
                    Get {wallet.name}
                  </a>
                </div>
              ) : (
                <button
                  onClick={() => connect(wallet.id)}
                  disabled={status === "connecting"}
                  className={`mt-auto w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                    isActive
                      ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 cursor-default"
                      : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:brightness-110 active:scale-95 shadow-md shadow-cyan-500/20"
                  }`}
                >
                  {isActive
                    ? "Connected"
                    : isConnecting
                      ? "Connecting..."
                      : `Connect ${wallet.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <p>{error}</p>
            {lastAttemptedWallet && status === "error" && (
              <button
                onClick={retry}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-200 hover:text-rose-100 transition-colors"
              >
                <RefreshCw size={14} />
                Retry {lastAttemptedWallet}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
