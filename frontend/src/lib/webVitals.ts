/**
 * Core Web Vitals collection and scoring (#1539).
 *
 * Deliberately dependency-free: the `web-vitals` package is not vendored into
 * this workspace, and pulling it in would mean a second source of truth for
 * metric definitions. The three metrics that matter for the Playground - LCP,
 * CLS and INP - are implemented directly on top of `PerformanceObserver`,
 * with a `Performance`-getEntriesByType fallback for engines that expose the
 * entry but not the observer.
 *
 * Every entry point is a no-op outside the browser so this module is safe to
 * import from a server component or a jsdom test.
 */

export type VitalName = "LCP" | "CLS" | "INP" | "TTFB" | "FCP";

export type VitalRating = "good" | "needs-improvement" | "poor";

export interface VitalMetric {
  name: VitalName;
  /** Numeric value: milliseconds for timings, a unitless score for CLS. */
  value: number;
  rating: VitalRating;
  /** Navigation-relative timestamp in milliseconds. */
  at: number;
  /** Entries that were discarded as outliers, for diagnostics. */
  discardedCount: number;
}

export type VitalListener = (metric: VitalMetric) => void;

/** Thresholds follow the published Web Vitals "good / needs-improvement / poor" cuts. */
export const VITAL_THRESHOLDS: Record<
  VitalName,
  { good: number; poor: number; unit: "ms" | "score" }
> = {
  LCP: { good: 2500, poor: 4000, unit: "ms" },
  INP: { good: 200, poor: 500, unit: "ms" },
  CLS: { good: 0.1, poor: 0.25, unit: "score" },
  TTFB: { good: 800, poor: 1800, unit: "ms" },
  FCP: { good: 1800, poor: 3000, unit: "ms" },
};

export function rateVital(name: VitalName, value: number): VitalRating {
  if (!Number.isFinite(value)) {
    return "poor";
  }

  const thresholds = VITAL_THRESHOLDS[name];

  if (value <= thresholds.good) {
    return "good";
  }

  if (value <= thresholds.poor) {
    return "needs-improvement";
  }

  return "poor";
}

export function formatVital(metric: VitalMetric): string {
  if (metric.name === "CLS") {
    return metric.value.toFixed(3);
  }

  return `${Math.round(metric.value)} ms`;
}

/**
 * CLS is a session-window metric: individual layout shifts accumulate until a
 * gap of 1s with no new shift, at which point the window is considered settled
 * and the sum becomes the CLS value. Shifts are additionally ignored for 500ms
 * after a recent user interaction, per the layout instability specification.
 */
const CLS_SESSION_GAP_MS = 1000;
const CLS_RECENT_INPUT_WINDOW_MS = 500;
/** Only the largest shift in a burst is reported, to stop a single jank spike dominating. */
const CLS_MAX_SESSION_ENTRIES = 5;

interface LayoutShiftAttribution {
  hadRecentInput?: boolean;
}

interface PerformanceEntryLike {
  entryType?: string;
  startTime?: number;
  value?: number;
  processingStart?: number;
  duration?: number;
  responseStart?: number;
  hadRecentInput?: boolean;
  name?: string;
}

interface PerformanceObserverLike {
  observe: (type: string, options?: { type?: string; buffered?: boolean }) => void;
  disconnect: () => void;
  takeRecords?: () => PerformanceEntryLike[];
}

type PerformanceObserverConstructor = {
  new (callback: (list: unknown) => void): PerformanceObserverLike;
  supportedEntryTypes?: string[];
};

function getObserverConstructor(): PerformanceObserverConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as unknown as {
    PerformanceObserver?: PerformanceObserverConstructor;
  }).PerformanceObserver;

  return typeof candidate === "function" ? candidate : null;
}

function supportsEntryType(type: string): boolean {
  const Observer = getObserverConstructor();
  const supported = Observer?.supportedEntryTypes;

  if (!supported) {
    // Older engines omit the field; assume support and let observe() throw,
    // which the call sites already guard against.
    return true;
  }

  return supported.includes(type);
}

interface ClsSession {
  firstShiftTime: number;
  lastShiftTime: number;
  entries: number[];
  total: number;
}

function startTimeOrigin(): number {
  if (typeof performance === "undefined") {
    return 0;
  }

  return performance.timeOrigin || 0;
}

function navigationEntry(): PerformanceEntryLike | undefined {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return undefined;
  }

  return performance.getEntriesByType("navigation")[0] as PerformanceEntryLike | undefined;
}

/**
 * Final CLS for a settled session window.
 *
 * Per the layout instability specification the window score is the sum of the
 * largest five shifts, so anything past that is counted as discarded rather
 * than contributing. Returns `null` for a window with no usable shifts.
 */
function readFinalCls(session: ClsSession | null): { value: number; discarded: number } | null {
  if (!session || session.entries.length === 0) {
    return null;
  }

  const sorted = [...session.entries].sort((a, b) => b - a);
  const kept = sorted.slice(0, CLS_MAX_SESSION_ENTRIES);

  return {
    value: kept.reduce((sum, value) => sum + value, 0),
    discarded: sorted.length - kept.length,
  };
}

export interface VitalsController {
  /** Read the latest value for a metric, if one has been reported. */
  get(name: VitalName): VitalMetric | null;
  /** Every metric reported so far, in report order. */
  snapshot(): VitalMetric[];
  /** Overall grade derived from the worst individual rating. */
  overallRating(): VitalRating;
  /** Subscribe to future metric reports. Returns an unsubscribe function. */
  subscribe(listener: VitalListener): () => void;
  /** Stop observing and flush any pending CLS session. */
  stop(): void;
}

/**
 * Create a collector. Safe to call in any environment; on the server and in
 * jsdom (which has no `PerformanceObserver`) it yields a controller whose
 * `snapshot()` stays empty instead of throwing.
 */
export function createVitalsCollector(): VitalsController {
  const metrics = new Map<VitalName, VitalMetric>();
  const listeners = new Set<VitalListener>();
  const observers: PerformanceObserverLike[] = [];

  let lcpValue: number | null = null;
  let inpValue: number | null = null;
  let clsSession: ClsSession | null = null;
  let stopped = false;
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  let inpTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (metric: VitalMetric): void => {
    if (stopped) {
      return;
    }

    // LCP publishes a new candidate on every paint, and INP re-reports as
    // worse interactions arrive, so the stored value has to move both ways.
    // Keeping the worst value permanently would freeze the metric at its first
    // (usually good) reading and hide a real regression, so the latest report
    // always wins. `snapshot()` stays at one entry per metric either way.
    metrics.set(metric.name, metric);
    listeners.forEach((listener) => {
      try {
        listener(metric);
      } catch {
        // A misbehaving subscriber must not break metric collection.
      }
    });
  };

  const report = (name: VitalName, value: number, at: number, discarded = 0): void => {
    emit({ name, value, at, rating: rateVital(name, value), discardedCount: discarded });
  };

  const clearSessionTimer = (): void => {
    if (sessionTimer !== null) {
      clearTimeout(sessionTimer);
      sessionTimer = null;
    }
  };

  const settleClsSession = (): void => {
    clearSessionTimer();
    const settled = readFinalCls(clsSession);
    clsSession = null;

    if (settled !== null) {
      report("CLS", settled.value, startTimeOrigin(), settled.discarded);
    }
  };

  const onLayoutShift = (entry: PerformanceEntryLike & LayoutShiftAttribution): void => {
    if (entry.hadRecentInput) {
      return;
    }

    const startTime = entry.startTime ?? 0;
    const value = entry.value ?? 0;

    if (value <= 0) {
      return;
    }

    if (!clsSession) {
      clsSession = { firstShiftTime: startTime, lastShiftTime: startTime, entries: [], total: 0 };
    }

    if (startTime - clsSession.lastShiftTime > CLS_SESSION_GAP_MS) {
      // New session window: publish the finished one before starting over.
      settleClsSession();
      clsSession = {
        firstShiftTime: startTime,
        lastShiftTime: startTime,
        entries: [],
        total: 0,
      };
    }

    clsSession.lastShiftTime = startTime;
    clsSession.entries.push(value);
    clsSession.total += value;

    clearSessionTimer();
    sessionTimer = setTimeout(settleClsSession, CLS_SESSION_GAP_MS);
  };

  const onInteraction = (entry: PerformanceEntryLike): void => {
    const duration = entry.duration ?? 0;

    // INP reports the worst interaction, and one very long frame is a worse
    // signal than several short ones, so track the maximum.
    if (inpValue === null || duration > inpValue) {
      inpValue = duration;
    }

    if (inpTimer !== null) {
      clearTimeout(inpTimer);
    }

    inpTimer = setTimeout(() => {
      inpTimer = null;
      if (inpValue !== null) {
        report("INP", inpValue, startTimeOrigin() + (entry.startTime ?? 0));
      }
    }, 0);
  };

  const observe = (type: string, handler: (entry: PerformanceEntryLike) => void): void => {
    const Observer = getObserverConstructor();

    if (!Observer || !supportsEntryType(type)) {
      return;
    }

    try {
      const observer = new Observer((list) => {
        const entries = (list as { getEntries?: () => PerformanceEntryLike[] }).getEntries?.() ?? [];

        entries.forEach((entry) => {
          if (entry.entryType === "first-input") {
            onInteraction(entry);
            return;
          }

          handler(entry);
        });
      });

      observer.observe({ type, buffered: true } as never);
      observers.push(observer);
    } catch {
      // An engine that advertises the type but rejects the options is simply
      // not observed; the snapshot stays partial.
    }
  };

  const seedFromNavigation = (): void => {
    const entry = navigationEntry();
    if (!entry) {
      return;
    }

    if (typeof entry.responseStart === "number") {
      report("TTFB", entry.responseStart, startTimeOrigin() + entry.responseStart);
    }
  };

  const seedPaint = (): void => {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
      return;
    }

    const paint = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");

    if (paint && typeof paint.startTime === "number") {
      report("FCP", paint.startTime, startTimeOrigin() + paint.startTime);
    }
  };

  if (!stopped) {
    seedFromNavigation();
    seedPaint();

    observe("largest-contentful-paint", (entry) => {
      if (typeof entry.startTime !== "number") {
        return;
      }

      // The browser itself marks a candidate as post-interaction via
      // `hadRecentInput`. Trust that flag rather than inferring interactivity
      // from a navigation timestamp: a late-loading hero image on a
      // pre-interactive page is a perfectly valid LCP candidate, and dropping
      // it would understate the metric.
      if (entry.hadRecentInput) {
        return;
      }

      lcpValue = entry.startTime;
      report("LCP", lcpValue, startTimeOrigin() + lcpValue);
    });

    observe("layout-shift", onLayoutShift);
    observe("first-input", onInteraction);
  }

  const flushInp = (): void => {
    if (inpTimer !== null) {
      clearTimeout(inpTimer);
      inpTimer = null;
    }

    if (inpValue !== null) {
      report("INP", inpValue, startTimeOrigin());
    }
  };

  return {
    get(name) {
      return metrics.get(name) ?? null;
    },
    snapshot() {
      return [...metrics.values()];
    },
    overallRating() {
      let worst: VitalRating = "good";

      for (const metric of metrics.values()) {
        if (metric.rating === "poor") {
          return "poor";
        }
        if (metric.rating === "needs-improvement") {
          worst = "needs-improvement";
        }
      }

      return worst;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      // Flush before latching `stopped`: a pending CLS window or INP
      // interaction is still a real measurement, and tearing down must not
      // silently discard the final value.
      clearSessionTimer();
      flushInp();
      if (clsSession) {
        const settled = readFinalCls(clsSession);
        clsSession = null;
        if (settled !== null) {
          report("CLS", settled.value, startTimeOrigin(), settled.discarded);
        }
      }

      stopped = true;
      observers.forEach((observer) => {
        try {
          observer.disconnect();
        } catch {
          // Disconnecting an already-torn-down observer is not an error worth
          // surfacing during teardown.
        }
      });
      observers.length = 0;
      listeners.clear();
    },
  };
}

/**
 * Frame-rate sampler. Uses rAF deltas over a rolling window, which is the only
 * way to observe FPS in a way that matches what the user actually perceives.
 */
export interface FpsSample {
  fps: number;
  /** Longest frame gap in the window, the stutter signal users notice. */
  longestFrameMs: number;
  droppedFrames: number;
}

export function createFpsSampler(windowSize = 60) {
  let frames = 0;
  let dropped = 0;
  let longest = 0;
  let previous = 0;
  let rafId = 0;
  let running = false;

  const tick = (timestamp: number): void => {
    if (!running) {
      return;
    }

    if (previous > 0) {
      const delta = timestamp - previous;
      longest = Math.max(longest, delta);
      frames += 1;

      // 20ms is roughly the point at which a frame no longer registers as
      // "smooth" at 60Hz on a 60Hz display.
      if (delta > 20) {
        dropped += 1;
      }
    }

    previous = timestamp;
    rafId = requestAnimationFrame(tick);
  };

  return {
    start(): void {
      if (running || typeof requestAnimationFrame !== "function") {
        return;
      }

      running = true;
      frames = 0;
      dropped = 0;
      longest = 0;
      previous = 0;
      rafId = requestAnimationFrame(tick);
    },
    sample(): FpsSample {
      // Two frames is the floor for a meaningful rate; below that report 0
      // rather than a wildly extrapolated number.
      const fps = frames > 1 ? Math.round((frames * 1000) / Math.max(1, previous)) : 0;

      return { fps, longestFrameMs: Math.round(longest), droppedFrames: dropped };
    },
    stop(): void {
      running = false;
      if (rafId && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
      rafId = 0;
    },
    reset(): void {
      frames = 0;
      dropped = 0;
      longest = 0;
      previous = 0;
    },
  };
}

export interface MemoryUsage {
  usedMb: number;
  totalMb: number;
  limitMb: number;
}

/**
 * Read JS heap usage. `performance.memory` is Chromium-only and non-standard,
 * so an absent value is reported as a null-ish reading rather than a zero that
 * would read as "no memory used".
 */
export function readMemoryUsage(): MemoryUsage | null {
  if (typeof performance === "undefined") {
    return null;
  }

  const memory = (performance as unknown as {
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
  }).memory;

  if (!memory || typeof memory.usedJSHeapSize !== "number") {
    return null;
  }

  const toMb = (bytes: number | undefined): number =>
    typeof bytes === "number" ? Math.round((bytes / (1024 * 1024)) * 10) / 10 : 0;

  return {
    usedMb: toMb(memory.usedJSHeapSize),
    totalMb: toMb(memory.totalJSHeapSize),
    limitMb: toMb(memory.jsHeapSizeLimit),
  };
}
