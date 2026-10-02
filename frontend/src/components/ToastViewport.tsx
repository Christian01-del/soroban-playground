'use client';

import { useSyncExternalStore } from 'react';
import { toastManager } from '../lib/toastManager';

let cachedToasts = toastManager.getToasts();
const subscribe = (onStoreChange: () => void) => toastManager.subscribe((toasts) => {
  cachedToasts = toasts;
  onStoreChange();
});
const getSnapshot = () => cachedToasts;
const getServerSnapshot = () => [];

export default function ToastViewport() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!toasts.length) return null;

  return (
    <div aria-label="Notifications" className="fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} role="status" className="rounded-lg border border-red-500/40 bg-slate-950/95 p-4 text-sm text-red-200 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong>{toast.title}</strong>
              {toast.message && <p className="mt-1 text-red-100/80">{toast.message}</p>}
            </div>
            <button aria-label={`Dismiss ${toast.title}`} onClick={() => toastManager.dismiss(toast.id)}>×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
