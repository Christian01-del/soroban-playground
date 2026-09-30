"use client";

import React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { TxStatus } from "@/hooks/useTransactionTracker";

export type TxIconSize = 14 | 16;

interface TxIconProps {
  status: TxStatus;
  size?: TxIconSize;
}

export default function TxIcon({ status, size = 14 }: TxIconProps) {
  if (status === "pending") {
    return (
      <div
        role="status"
        aria-label="Pending transaction"
        className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-b-transparent border-amber-400 shrink-0 mt-0.5"
      />
    );
  }
  if (status === "success") {
    return (
      <CheckCircle2
        size={size}
        className="text-emerald-400 shrink-0 mt-0.5"
        aria-label="Transaction succeeded"
      />
    );
  }
  return (
    <XCircle
      size={size}
      className="text-rose-400 shrink-0 mt-0.5"
      aria-label="Transaction failed"
    />
  );
}
