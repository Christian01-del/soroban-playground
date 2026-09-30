import React from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

export type Toast = { type: "success" | "error"; message: string } | null;

export default function ToastBanner({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-center gap-3 rounded-lg border p-4 text-sm ${
        toast.type === "success"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/40 bg-red-500/10 text-red-300"
      }`}
    >
      {toast.type === "success" ? (
        <CheckCircle2 size={16} className="shrink-0" />
      ) : (
        <AlertCircle size={16} className="shrink-0" />
      )}
      {toast.message}
    </div>
  );
}
