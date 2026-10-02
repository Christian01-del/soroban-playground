import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PerformanceMonitor from "@/components/PerformanceMonitor";

type ObserverCallback = (list: { getEntries: () => unknown[] }) => void;

class MockPerformanceObserver {
  static instances: MockPerformanceObserver[] = [];
  static supportedEntryTypes = [
    "largest-contentful-paint",
    "layout-shift",
    "first-input",
    "paint",
    "navigation",
  ];

  callback: ObserverCallback;
  observed: string[] = [];
  disconnected = false;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockPerformanceObserver.instances.push(this);
  }

  observe(options: { type?: string }): void {
    this.observed.push(options.type ?? "");
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emit(entries: unknown[]): void {
    this.callback({ getEntries: () => entries });
  }
}

function findObserver(type: string): MockPerformanceObserver | undefined {
  return MockPerformanceObserver.instances.find((instance) => instance.observed.includes(type));
}

beforeEach(() => {
  MockPerformanceObserver.instances = [];
  (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver =
    MockPerformanceObserver;
  Object.defineProperty(window.performance, "timeOrigin", { value: 0, configurable: true });
});

afterEach(() => {
  delete (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver;
});

describe("PerformanceMonitor - opt-in gating", () => {
  it("renders nothing when disabled", () => {
    const { container } = render(<PerformanceMonitor enabled={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing by default", () => {
    const { container } = render(<PerformanceMonitor />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the collapsed trigger when enabled", () => {
    render(<PerformanceMonitor enabled />);

    expect(
      screen.getByRole("button", { name: /show performance monitor/i }),
    ).toBeInTheDocument();
  });
});

describe("PerformanceMonitor - panel interaction", () => {
  it("starts collapsed and expands on click", () => {
    render(<PerformanceMonitor enabled />);

    expect(screen.queryByTestId("performance-monitor-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    expect(screen.getByTestId("performance-monitor-panel")).toBeInTheDocument();
  });

  it("toggles the aria-expanded state", () => {
    render(<PerformanceMonitor enabled />);
    const trigger = screen.getByRole("button", { name: /show performance monitor/i });

    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(
      screen.getByRole("button", { name: /hide performance monitor/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses again", () => {
    render(<PerformanceMonitor enabled />);

    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));
    fireEvent.click(screen.getByRole("button", { name: /hide performance monitor/i }));

    expect(screen.queryByTestId("performance-monitor-panel")).not.toBeInTheDocument();
  });

  it("exposes the table with a caption and column headers", () => {
    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/core web vitals measurements/i)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /metric/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /value/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /rating/i })).toBeInTheDocument();
  });

  it("shows a collecting state before any metric arrives", () => {
    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    expect(screen.getByText(/collecting metrics/i)).toBeInTheDocument();
  });

  it("shows the FPS and memory readings", () => {
    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    expect(screen.getByTestId("performance-monitor-fps")).toBeInTheDocument();
    expect(screen.getByTestId("performance-monitor-memory")).toBeInTheDocument();
  });

  it("reports n/a for memory when the engine does not expose it", () => {
    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    expect(screen.getByTestId("performance-monitor-memory")).toHaveTextContent("n/a");
  });

  it("shows the heap reading when performance.memory exists", () => {
    Object.defineProperty(window.performance, "memory", {
      value: { usedJSHeapSize: 12 * 1024 * 1024 },
      configurable: true,
    });

    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    expect(screen.getByTestId("performance-monitor-memory")).toHaveTextContent("12 MB");

    // @ts-ignore - removing a non-standard property
    delete window.performance.memory;
  });

  it("re-reads the snapshot when refresh is clicked", () => {
    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    act(() => {
      findObserver("largest-contentful-paint")?.emit([
        { entryType: "largest-contentful-paint", startTime: 1800 },
      ]);
    });

    expect(screen.getByTestId("vital-LCP")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(screen.getByTestId("vital-LCP")).toBeInTheDocument();
  });
});

describe("PerformanceMonitor - metric display", () => {
  it("renders a reported LCP with its value and rating", () => {
    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    act(() => {
      findObserver("largest-contentful-paint")?.emit([
        { entryType: "largest-contentful-paint", startTime: 1800 },
      ]);
    });

    const row = screen.getByTestId("vital-LCP");
    expect(row).toHaveTextContent("LCP");
    expect(row).toHaveTextContent("1800 ms");
    expect(row).toHaveTextContent("Good");
  });

  it("marks a poor metric as poor", () => {
    render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    act(() => {
      findObserver("largest-contentful-paint")?.emit([
        { entryType: "largest-contentful-paint", startTime: 9000 },
      ]);
    });

    expect(screen.getByTestId("vital-LCP")).toHaveTextContent("Poor");
  });

  it("formats CLS to three decimals", () => {
    jest.useFakeTimers();

    try {
      render(<PerformanceMonitor enabled />);
      fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

      act(() => {
        findObserver("layout-shift")?.emit([
          { entryType: "layout-shift", startTime: 100, value: 0.1234 },
        ]);
        jest.advanceTimersByTime(1000);
      });

      expect(screen.getByTestId("vital-CLS")).toHaveTextContent("0.123");
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps metrics in canonical order", () => {
    jest.useFakeTimers();

    try {
      render(<PerformanceMonitor enabled />);
      fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

      // INP is emitted first, LCP second; the display must still be canonical.
      act(() => {
        findObserver("first-input")?.emit([
          { entryType: "first-input", startTime: 10, duration: 80 },
        ]);
        findObserver("largest-contentful-paint")?.emit([
          { entryType: "largest-contentful-paint", startTime: 1200 },
        ]);
        jest.advanceTimersByTime(1);
      });

      const names = screen
        .getAllByTestId(/^vital-/)
        .map((element) => element.getAttribute("data-testid"));

      expect(names).toEqual(["vital-LCP", "vital-INP"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops observing on unmount", async () => {
    const { unmount } = render(<PerformanceMonitor enabled />);
    fireEvent.click(screen.getByRole("button", { name: /show performance monitor/i }));

    unmount();

    await waitFor(() => {
      expect(MockPerformanceObserver.instances.every((instance) => instance.disconnected)).toBe(true);
    });
  });
});
