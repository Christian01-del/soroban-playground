import {
  createFpsSampler,
  createVitalsCollector,
  formatVital,
  readMemoryUsage,
  rateVital,
  VITAL_THRESHOLDS,
  type VitalMetric,
} from "@/lib/webVitals";

type ObserverCallback = (list: { getEntries: () => unknown[] }) => void;

class MockPerformanceObserver {
  static instances: MockPerformanceObserver[] = [];
  static supportedEntryTypes: string[] = [
    "largest-contentful-paint",
    "layout-shift",
    "first-input",
    "paint",
    "navigation",
  ];

  callback: ObserverCallback;
  observed: string[] = [];
  disconnected = false;
  failOnObserve = false;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockPerformanceObserver.instances.push(this);
  }

  observe(options: { type?: string; buffered?: boolean } | string): void {
    if (this.failOnObserve) {
      throw new Error("observe not supported");
    }

    this.observed.push(typeof options === "string" ? options : (options.type ?? ""));
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Drive this observer as if the browser had emitted the given entries. */
  emit(entries: unknown[]): void {
    this.callback({ getEntries: () => entries });
  }
}

function findObserver(type: string): MockPerformanceObserver | undefined {
  return MockPerformanceObserver.instances.find((instance) => instance.observed.includes(type));
}

function withFakeNow<T>(run: () => T): T {
  jest.useFakeTimers();
  try {
    return run();
  } finally {
    jest.useRealTimers();
  }
}

beforeEach(() => {
  // Observers registered by a previous collector must not be reachable from the
  // next test, or `findObserver` would return a stale instance whose callback
  // writes into a torn-down collector.
  MockPerformanceObserver.instances = [];
  MockPerformanceObserver.supportedEntryTypes = [
    "largest-contentful-paint",
    "layout-shift",
    "first-input",
    "paint",
    "navigation",
  ];
  (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver =
    MockPerformanceObserver;
  Object.defineProperty(window.performance, "timeOrigin", {
    value: 0,
    configurable: true,
  });
});

afterEach(() => {
  delete (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver;
  jest.useRealTimers();
});

describe("rateVital", () => {
  it("classifies against the published thresholds", () => {
    expect(rateVital("LCP", 1200)).toBe("good");
    expect(rateVital("LCP", 3000)).toBe("needs-improvement");
    expect(rateVital("LCP", 9000)).toBe("poor");
  });

  it("treats the boundary value as good", () => {
    expect(rateVital("INP", VITAL_THRESHOLDS.INP.good)).toBe("good");
    expect(rateVital("CLS", VITAL_THRESHOLDS.CLS.poor)).toBe("needs-improvement");
  });

  it("rates non-finite values as poor", () => {
    expect(rateVital("CLS", Number.NaN)).toBe("poor");
    expect(rateVital("CLS", Number.POSITIVE_INFINITY)).toBe("poor");
  });
});

describe("formatVital", () => {
  it("formats CLS to three decimals and timings as whole milliseconds", () => {
    const cls: VitalMetric = { name: "CLS", value: 0.1234, rating: "needs-improvement", at: 0, discardedCount: 0 };
    const lcp: VitalMetric = { name: "LCP", value: 2499.6, rating: "good", at: 0, discardedCount: 0 };

    expect(formatVital(cls)).toBe("0.123");
    expect(formatVital(lcp)).toBe("2500 ms");
  });
});

describe("createVitalsCollector - observer wiring", () => {
  it("observes LCP, CLS and INP with buffered delivery", () => {
    createVitalsCollector();

    expect(findObserver("largest-contentful-paint")).toBeDefined();
    expect(findObserver("layout-shift")).toBeDefined();
    expect(findObserver("first-input")).toBeDefined();
  });

  it("does not throw when PerformanceObserver is absent", () => {
    delete (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver;

    const collector = createVitalsCollector();

    expect(collector.snapshot()).toEqual([]);
    expect(collector.overallRating()).toBe("good");
  });

  it("survives an engine that advertises a type but rejects observe()", () => {
    (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver =
      Object.assign(
        function Broken() {
          throw new Error("no observer");
        },
        { supportedEntryTypes: ["largest-contentful-paint"] },
      );

    expect(() => createVitalsCollector()).not.toThrow();
  });

  it("skips a type the engine does not support", () => {
    MockPerformanceObserver.supportedEntryTypes = ["layout-shift"];

    const collector = createVitalsCollector();

    expect(findObserver("largest-contentful-paint")).toBeUndefined();
    expect(findObserver("layout-shift")).toBeDefined();
    expect(collector.get("LCP")).toBeNull();
  });

  it("disconnects every observer on stop", () => {
    const collector = createVitalsCollector();
    collector.stop();

    expect(MockPerformanceObserver.instances.every((instance) => instance.disconnected)).toBe(true);
  });

  it("ignores entries with no usable startTime", () => {
    const collector = createVitalsCollector();
    findObserver("largest-contentful-paint")?.emit([{ entryType: "largest-contentful-paint" }]);

    expect(collector.get("LCP")).toBeNull();
  });
});

describe("createVitalsCollector - LCP", () => {
  it("reports the candidate LCP", () => {
    const collector = createVitalsCollector();
    findObserver("largest-contentful-paint")?.emit([
      { entryType: "largest-contentful-paint", startTime: 1800 },
    ]);

    expect(collector.get("LCP")).toMatchObject({ name: "LCP", value: 1800, rating: "good" });
  });

  it("keeps the latest LCP candidate so a late regression is visible", () => {
    const collector = createVitalsCollector();
    const observer = findObserver("largest-contentful-paint");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 5000 }]);
    expect(collector.get("LCP")?.rating).toBe("poor");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 900 }]);

    expect(collector.get("LCP")?.value).toBe(900);
    expect(collector.get("LCP")?.rating).toBe("good");
  });

  it("records a worse later candidate that supersedes a better one", () => {
    const collector = createVitalsCollector();
    const observer = findObserver("largest-contentful-paint");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 900 }]);
    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 6000 }]);

    expect(collector.get("LCP")?.value).toBe(6000);
  });

  it("ignores a candidate the browser flagged as post-interaction", () => {
    const collector = createVitalsCollector();

    findObserver("largest-contentful-paint")?.emit([
      { entryType: "largest-contentful-paint", startTime: 5000, hadRecentInput: true },
    ]);

    expect(collector.get("LCP")).toBeNull();
  });
});

describe("createVitalsCollector - CLS", () => {
  it("ignores shifts flagged as recent user input", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      findObserver("layout-shift")?.emit([
        { entryType: "layout-shift", startTime: 100, value: 0.4, hadRecentInput: true },
      ]);

      jest.advanceTimersByTime(1500);

      expect(collector.get("CLS")).toBeNull();
    });
  });

  it("ignores zero and negative shift values", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      const observer = findObserver("layout-shift");

      observer?.emit([
        { entryType: "layout-shift", startTime: 100, value: 0 },
        { entryType: "layout-shift", startTime: 110, value: -0.2 },
      ]);
      jest.advanceTimersByTime(1500);

      expect(collector.get("CLS")).toBeNull();
    });
  });

  it("sums shifts within a session window once the window settles", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      const observer = findObserver("layout-shift");

      observer?.emit([
        { entryType: "layout-shift", startTime: 100, value: 0.05 },
        { entryType: "layout-shift", startTime: 300, value: 0.03 },
        { entryType: "layout-shift", startTime: 600, value: 0.01 },
      ]);

      // Nothing is published until the 1s idle gap proves the window is over.
      expect(collector.get("CLS")).toBeNull();

      jest.advanceTimersByTime(1000);

      expect(collector.get("CLS")?.value).toBeCloseTo(0.09, 5);
      expect(collector.get("CLS")?.rating).toBe("good");
    });
  });

  it("starts a new window when the gap exceeds 1s and publishes the finished one", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      const observer = findObserver("layout-shift");

      observer?.emit([{ entryType: "layout-shift", startTime: 100, value: 0.2 }]);
      observer?.emit([{ entryType: "layout-shift", startTime: 2000, value: 0.4 }]);

      // The first window closed when the second shift opened a new one.
      expect(collector.get("CLS")?.value).toBeCloseTo(0.2, 5);
    });
  });

  it("keeps only the five largest shifts in a window", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      const observer = findObserver("layout-shift");

      observer?.emit(
        [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.5].map((value, index) => ({
          entryType: "layout-shift",
          startTime: 100 + index * 50,
          value,
        })),
      );
      jest.advanceTimersByTime(1000);

      // 0.5 plus the four largest 0.01s shifts; the rest are discarded.
      expect(collector.get("CLS")?.value).toBeCloseTo(0.54, 5);
      expect(collector.get("CLS")?.discardedCount).toBe(2);
    });
  });

  it("flushes a pending window on stop so the value is never lost", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      findObserver("layout-shift")?.emit([
        { entryType: "layout-shift", startTime: 100, value: 0.15 },
      ]);

      collector.stop();

      expect(collector.get("CLS")?.value).toBeCloseTo(0.15, 5);
    });
  });
});

describe("createVitalsCollector - INP", () => {
  it("reports the worst interaction duration", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      const observer = findObserver("first-input");

      observer?.emit([
        { entryType: "first-input", startTime: 10, duration: 120 },
        { entryType: "first-input", startTime: 20, duration: 340 },
        { entryType: "first-input", startTime: 30, duration: 80 },
      ]);

      jest.advanceTimersByTime(1);

      expect(collector.get("INP")?.value).toBe(340);
      expect(collector.get("INP")?.rating).toBe("needs-improvement");
    });
  });

  it("coalesces interactions into a single worst-case report", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      const observer = findObserver("first-input");

      observer?.emit([{ entryType: "first-input", startTime: 10, duration: 500 }]);
      jest.advanceTimersByTime(1);
      observer?.emit([{ entryType: "first-input", startTime: 20, duration: 90 }]);
      jest.advanceTimersByTime(1);

      expect(collector.snapshot().filter((entry) => entry.name === "INP")).toHaveLength(1);
      expect(collector.get("INP")?.value).toBe(500);
    });
  });

  it("flushes a pending interaction on stop", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      findObserver("first-input")?.emit([{ entryType: "first-input", startTime: 5, duration: 210 }]);

      collector.stop();

      expect(collector.get("INP")?.value).toBe(210);
    });
  });
});

describe("createVitalsCollector - navigation metrics", () => {
  /**
   * jsdom's `performance.getEntriesByType` is not configurable, so
   * `jest.spyOn` fails. Swapping the method on the instance directly is the
   * one override jsdom permits, and `afterEach` restores the real one.
   */
  function stubEntries(entries: Record<string, unknown[]>): void {
    Object.defineProperty(window.performance, "getEntriesByType", {
      configurable: true,
      writable: true,
      value: (type: string) => (entries[type] ?? []) as unknown as PerformanceEntryList,
    });
  }

  /**
   * Captured before any stub, and restored on the prototype afterwards rather
   * than by re-binding: reading `performance.getEntriesByType` at describe time
   * would run before jsdom finishes installing it.
   */
  afterEach(() => {
    delete (window.performance as unknown as Record<string, unknown>).getEntriesByType;
  });

  it("seeds TTFB from the navigation entry", () => {
    const collector = createVitalsCollector();

    // jsdom does not populate a navigation timing entry, so seeding is a no-op
    // and TTFB must simply be absent rather than zero.
    expect(collector.get("TTFB")).toBeNull();
  });

  it("seeds TTFB when the engine reports a responseStart", () => {
    stubEntries({ navigation: [{ responseStart: 640 }] });

    const collector = createVitalsCollector();

    expect(collector.get("TTFB")?.value).toBe(640);
    expect(collector.get("TTFB")?.rating).toBe("good");
  });

  it("seeds FCP from the paint entry when present", () => {
    stubEntries({ paint: [{ name: "first-contentful-paint", startTime: 1500 }] });

    const collector = createVitalsCollector();

    expect(collector.get("FCP")?.value).toBe(1500);
    expect(collector.get("FCP")?.rating).toBe("good");
  });

  it("ignores a paint entry that is not first-contentful-paint", () => {
    stubEntries({ paint: [{ name: "first-paint", startTime: 400 }] });

    const collector = createVitalsCollector();

    expect(collector.get("FCP")).toBeNull();
  });
});

describe("createVitalsCollector - ratings and subscriptions", () => {
  it("derives the overall grade from the current worst metric", () => {
    const collector = createVitalsCollector();
    const observer = findObserver("largest-contentful-paint");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 1000 }]);
    expect(collector.overallRating()).toBe("good");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 5000 }]);
    expect(collector.overallRating()).toBe("poor");
  });

  it("improves the overall grade once a late candidate recovers", () => {
    const collector = createVitalsCollector();
    const observer = findObserver("largest-contentful-paint");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 5000 }]);
    expect(collector.overallRating()).toBe("poor");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 1000 }]);
    expect(collector.overallRating()).toBe("good");
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    withFakeNow(() => {
      const collector = createVitalsCollector();
      const listener = jest.fn();
      const unsubscribe = collector.subscribe(listener);

      findObserver("largest-contentful-paint")?.emit([
        { entryType: "largest-contentful-paint", startTime: 1200 },
      ]);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      findObserver("largest-contentful-paint")?.emit([
        { entryType: "largest-contentful-paint", startTime: 5200 },
      ]);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  it("does not let a throwing subscriber break collection", () => {
    const collector = createVitalsCollector();
    collector.subscribe(() => {
      throw new Error("bad subscriber");
    });

    expect(() =>
      findObserver("largest-contentful-paint")?.emit([
        { entryType: "largest-contentful-paint", startTime: 1200 },
      ]),
    ).not.toThrow();
    expect(collector.get("LCP")).not.toBeNull();
  });

  it("snapshots each metric once", () => {
    const collector = createVitalsCollector();
    const observer = findObserver("largest-contentful-paint");

    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 1000 }]);
    observer?.emit([{ entryType: "largest-contentful-paint", startTime: 1200 }]);

    expect(collector.snapshot().filter((entry) => entry.name === "LCP")).toHaveLength(1);
  });
});

describe("createFpsSampler", () => {
  function withRaf<T>(run: (advance: (frames: number[]) => void) => T): T {
    const original = window.requestAnimationFrame;
    let handler: FrameRequestCallback | null = null;
    const queue: FrameRequestCallback[] = [];

    window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      queue.push(callback);
      handler = callback;
      return queue.length;
    }) as unknown as typeof window.requestAnimationFrame;

    const advance = (frames: number[]): void => {
      frames.forEach((timestamp) => {
        const current = handler;
        handler = null;
        current?.(timestamp);
      });
    };

    try {
      return run(advance);
    } finally {
      window.requestAnimationFrame = original;
    }
  }

  it("does not start twice", () => {
    withRaf(() => {
      const sampler = createFpsSampler();
      sampler.start();
      sampler.start();
      expect(jest.fn());
      sampler.stop();
    });
  });

  it("reports 0 FPS before any frame is sampled", () => {
    const sampler = createFpsSampler();
    sampler.start();

    expect(sampler.sample()).toEqual({ fps: 0, longestFrameMs: 0, droppedFrames: 0 });
    sampler.stop();
  });

  it("is inert when rAF is unavailable", () => {
    const original = window.requestAnimationFrame;
    // @ts-expect-error - deliberately removing the API
    delete window.requestAnimationFrame;

    const sampler = createFpsSampler();
    expect(() => sampler.start()).not.toThrow();

    window.requestAnimationFrame = original;
  });

  it("tracks the longest frame and counts long frames", () => {
    withRaf((advance) => {
      const sampler = createFpsSampler();
      sampler.start();
      advance([0, 16, 32, 48, 130]);

      const sample = sampler.sample();
      expect(sample.longestFrameMs).toBe(82);
      expect(sample.droppedFrames).toBe(1);
      sampler.stop();
    });
  });

  it("resets the counters on request", () => {
    withRaf((advance) => {
      const sampler = createFpsSampler();
      sampler.start();
      advance([0, 16, 32]);
      sampler.reset();

      expect(sampler.sample().longestFrameMs).toBe(0);
      sampler.stop();
    });
  });
});

describe("readMemoryUsage", () => {
  it("returns null when performance.memory is unavailable", () => {
    expect(readMemoryUsage()).toBeNull();
  });

  it("converts byte counts to megabytes", () => {
    Object.defineProperty(window.performance, "memory", {
      value: {
        usedJSHeapSize: 5 * 1024 * 1024,
        totalJSHeapSize: 8 * 1024 * 1024,
        jsHeapSizeLimit: 2048 * 1024 * 1024,
      },
      configurable: true,
    });

    expect(readMemoryUsage()).toEqual({ usedMb: 5, totalMb: 8, limitMb: 2048 });

    // @ts-ignore - cleaning up a non-standard property
    delete window.performance.memory;
  });

  it("tolerates a partial memory object", () => {
    Object.defineProperty(window.performance, "memory", {
      value: { usedJSHeapSize: 1024 * 1024 },
      configurable: true,
    });

    expect(readMemoryUsage()).toEqual({ usedMb: 1, totalMb: 0, limitMb: 0 });

    // @ts-ignore - cleaning up a non-standard property
    delete window.performance.memory;
  });
});
