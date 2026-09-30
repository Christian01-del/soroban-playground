"use client";

import { useWallet } from "../components/providers/WalletProvider";

export type WalletStatus =
  "idle" | "connecting" | "connected" | "error" | "unavailable";

export interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string | null>;
  retry: () => Promise<void>;
  lastAttemptedWallet: string | null;
}

export function useFreighterWallet(): WalletState {
  const wallet = useWallet();

  return {
    status: wallet.status as WalletStatus,
    address: wallet.address,
    network: wallet.network,
    error: wallet.error,
    connect: () => wallet.connect("freighter"),
    disconnect: wallet.disconnect,
    signTransaction: wallet.signTransaction,
    retry: () => wallet.retry(),
    lastAttemptedWallet: wallet.lastAttemptedWallet,
  };
}
