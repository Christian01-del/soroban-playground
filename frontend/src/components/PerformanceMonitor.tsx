"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Gauge, X } from "lucide-react";
import {
  createFpsSampler,
  createVitalsCollector,
  formatVital,
  readMemoryUsage,
  type FpsSample,
  type MemoryUsage,
  type VitalsController,
  type VitalMetric,
  type VitalName,
} from "@/lib/webVitals";

const RATING_STYLES: Record<VitalMetric["rating"], string> = {
  good: "text-emerald-300",
  "needs-improvement": "text-amber-300",
  poor: "text-rose-300",
};

const RATING_DOTS: Record<VitalMetric["rating"], string> = {
  good: "bg-emerald-400",
  "needs-improvement": "bg-amber-400",
  poor: "bg-rose-400",
};

const VITAL_ORDER: VitalName[] = ["LCP", "INP", "CLS", "TTFB", "FCP"];

const RATING_LABELS: Record<VitalMetric["rating"], string> = {
  good: "Good",
  "needs-improvement": "Needs improvement",
  poor: "Poor",
};

/**
 * Developer-facing Core Web Vitals widget (#1539).
 *
 * Reports the five metrics the CI Lighthouse gate tracks, plus live FPS and JS
 * heap. It renders nothing until mounted and stays hidden by default so it never
 * affects the layout-shift score it is measuring - the widget is `position:
 * fixed` and gated behind a `visibility` change rather than being toggled into
 * the document flow.
 */
export default function PerformanceMonitor({ enabled = false }: { enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [metrics, setMetrics] = useState<VitalMetric[]>([]);
  const [fps, setFps] = useState<FpsSample>({ fps: 0, longestFrameMs: 0, droppedFrames: 0 });
  const [memory, setMemory] = useState<MemoryUsage | null>(null);
  const collectorRef = useRef<VitalsController | null>(null);

  useEffect(() => {
    const controller = createVitalsCollector();
    collectorRef.current = controller;
    setMetrics(controller.snapshot());

    const unsubscribe = controller.subscribe((metric) => {
      setMetrics((previous) => {
        const next = previous.filter((entry) => entry.name !== metric.name);
        return [...next, metric].sort(
          (left, right) => VITAL_ORDER.indexOf(left.name) - VITAL_ORDER.indexOf(right.name),
        );
      });
    });

    return () => {
      unsubscribe();
      controller.stop();
      collectorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const sampler = createFpsSampler();
    sampler.start();
    setFps(sampler.sample());
    setMemory(readMemoryUsage());

    const frameTimer = setInterval(() => {
      setFps(sampler.sample());
      sampler.reset();
    }, 1000);

    const memoryTimer = setInterval(() => {
      setMemory(readMemoryUsage());
    }, 5000);

    return () => {
      clearInterval(frameTimer);
      clearInterval(memoryTimer);
      sampler.stop();
    };
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((previous) => !previous);
  }, []);

  const handleClear = useCallback(() => {
    setMetrics(collectorRef.current?.snapshot() ?? []);
  }, []);

  if (!enabled) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 font-mono text-xs">
      {open ? (
        <div
          data-testid="performance-monitor-panel"
          className="w-64 rounded-xl border border-gray-800 bg-gray-950/95 p-3 shadow-2xl backdrop-blur"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold uppercase tracking-widest text-gray-400">
              <Activity size={12} className="text-cyan-400" />
              Web Vitals
            </span>
            <button
              type="button"
              onClick={handleClear}
              className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
            >
              refresh
            </button>
          </div>

          <table className="w-full">
            <caption className="sr-only">Core Web Vitals measurements</caption>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-600">
                <th scope="col" className="font-medium">
                  Metric
                </th>
                <th scope="col" className="font-medium">
                  Value
                </th>
                <th scope="col" className="font-medium">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-2 text-[11px] italic text-gray-500">
                    Collecting metrics…
                  </td>
                </tr>
              ) : (
                metrics.map((metric) => (
                  <tr key={metric.name} data-testid={`vital-${metric.name}`}>
                    <td className="py-1 text-gray-400">{metric.name}</td>
                    <td className={`py-1 ${RATING_STYLES[metric.rating]}`}>{formatVital(metric)}</td>
                    <td className="py-1">
                      <span className="flex items-center gap-1 text-[10px] text-gray-500">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${RATING_DOTS[metric.rating]}`}
                        />
                        {RATING_LABELS[metric.rating]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="mt-3 border-t border-gray-800 pt-2 text-[11px] text-gray-400">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Gauge size={12} className="text-cyan-400" />
                FPS
              </span>
              <span data-testid="performance-monitor-fps">
                {fps.fps}
                {fps.droppedFrames > 0 ? (
                  <span className="text-rose-300"> ({fps.droppedFrames} long)</span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span>JS heap</span>
              <span data-testid="performance-monitor-memory">
                {memory ? `${memory.usedMb} MB` : "n/a"}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={open ? "Hide performance monitor" : "Show performance monitor"}
        className="flex items-center gap-1.5 rounded-full border border-gray-800 bg-gray-950/95 px-3 py-1.5 text-gray-400 shadow-lg hover:text-cyan-300"
      >
        <Gauge size={13} />
        {open ? <X size={13} /> : null}
        <span className="text-[11px]">Perf</span>
      </button>
    </div>
  );
}
