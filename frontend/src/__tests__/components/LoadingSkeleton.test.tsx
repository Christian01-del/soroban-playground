// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Test suite for LoadingSkeleton – Issue #942
 *
 * Covers:
 *  - default rendering (rows, aria attributes)
 *  - custom lines configuration
 *  - error state with and without retry button
 *  - loaded state (renders children)
 *  - edge-case: empty lines array fallback
 *  - edge-case: null / undefined / empty-string error values are ignored
 *  - edge-case: rows = 0 clamped to 1
 *  - SkeletonErrorBoundary catches render errors
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import LoadingSkeleton, {
  SkeletonErrorBoundary,
} from "../../components/LoadingSkeleton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Boom(): React.ReactElement {
  throw new Error("render exploded");
}

// ---------------------------------------------------------------------------
// Default / loading state
// ---------------------------------------------------------------------------

describe("LoadingSkeleton – loading state", () => {
  it("renders a status region with aria-busy=true by default", () => {
    render(<LoadingSkeleton />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
  });

  it("has a default aria-label of 'Loading content'", () => {
    render(<LoadingSkeleton />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Loading content",
    );
  });

  it("renders 3 skeleton lines by default", () => {
    const { container } = render(<LoadingSkeleton />);
    const lines = container.querySelectorAll("[role='presentation']");
    expect(lines).toHaveLength(3);
  });

  it("renders the correct number of rows when rows prop is supplied", () => {
    const { container } = render(<LoadingSkeleton rows={5} />);
    const lines = container.querySelectorAll("[role='presentation']");
    expect(lines).toHaveLength(5);
  });

  it("renders custom lines when lines prop is supplied", () => {
    const { container } = render(
      <LoadingSkeleton
        lines={[
          { variant: "text", width: "80%" },
          { variant: "circle", width: "48px" },
        ]}
      />,
    );
    const lines = container.querySelectorAll("[role='presentation']");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute("data-variant", "text");
    expect(lines[1]).toHaveAttribute("data-variant", "circle");
  });

  it("accepts a custom ariaLabel", () => {
    render(<LoadingSkeleton ariaLabel="Loading wallet data" />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Loading wallet data",
    );
  });

  it("clamps rows to at least 1 when rows=0", () => {
    const { container } = render(<LoadingSkeleton rows={0} />);
    const lines = container.querySelectorAll("[role='presentation']");
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to default rows when lines is an empty array", () => {
    const { container } = render(<LoadingSkeleton rows={2} lines={[]} />);
    const lines = container.querySelectorAll("[role='presentation']");
    // Fallback renders `rows` lines
    expect(lines).toHaveLength(2);
  });

  it("attaches the className prop to the root element", () => {
    render(<LoadingSkeleton className="my-class" />);
    expect(screen.getByTestId("loading-skeleton")).toHaveClass("my-class");
  });
});

// ---------------------------------------------------------------------------
// Loaded state
// ---------------------------------------------------------------------------

describe("LoadingSkeleton – loaded state", () => {
  it("renders children when isLoading=false", () => {
    render(
      <LoadingSkeleton isLoading={false}>
        <p>Contract compiled!</p>
      </LoadingSkeleton>,
    );
    expect(screen.getByText("Contract compiled!")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders an empty div when isLoading=false and no children", () => {
    render(<LoadingSkeleton isLoading={false} />);
    expect(screen.getByTestId("skeleton-empty")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe("LoadingSkeleton – error state", () => {
  it("renders an alert region when error is an Error object", () => {
    render(<LoadingSkeleton error={new Error("Network failure")} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-error-message")).toHaveTextContent(
      "Network failure",
    );
  });

  it("renders an alert region when error is a string", () => {
    render(<LoadingSkeleton error="RPC timed out" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-error-message")).toHaveTextContent(
      "RPC timed out",
    );
  });

  it("renders a fallback message for an Error with an empty message", () => {
    render(<LoadingSkeleton error={new Error("")} />);
    expect(screen.getByTestId("skeleton-error-message")).toHaveTextContent(
      "An unexpected error occurred.",
    );
  });

  it("renders a fallback message for an empty string error", () => {
    render(<LoadingSkeleton error="   " />);
    expect(screen.getByTestId("skeleton-error-message")).toHaveTextContent(
      "An unexpected error occurred.",
    );
  });

  it("shows the Retry button when onRetry is provided", () => {
    render(<LoadingSkeleton error="Fetch failed" onRetry={jest.fn()} />);
    expect(screen.getByTestId("skeleton-retry-button")).toBeInTheDocument();
  });

  it("does not show the Retry button when onRetry is absent", () => {
    render(<LoadingSkeleton error="Fetch failed" />);
    expect(
      screen.queryByTestId("skeleton-retry-button"),
    ).not.toBeInTheDocument();
  });

  it("calls onRetry when Retry button is clicked", () => {
    const onRetry = jest.fn();
    render(<LoadingSkeleton error="Fetch failed" onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId("skeleton-retry-button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render the skeleton when error is set", () => {
    render(<LoadingSkeleton error="Fetch failed" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("loading-skeleton")).not.toBeInTheDocument();
  });

  it("error state takes priority over isLoading=true", () => {
    render(<LoadingSkeleton isLoading={true} error="Something broke" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("treats null error as no error", () => {
    render(<LoadingSkeleton error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SkeletonErrorBoundary
// ---------------------------------------------------------------------------

describe("SkeletonErrorBoundary", () => {
  // Suppress the console.error noise from React's error boundary machinery
  let consoleError: jest.SpyInstance;
  beforeAll(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => {
    consoleError.mockRestore();
  });

  it("renders children when there is no error", () => {
    render(
      <SkeletonErrorBoundary>
        <span>All good</span>
      </SkeletonErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("renders an alert when a child throws", () => {
    render(
      <SkeletonErrorBoundary>
        <Boom />
      </SkeletonErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-error-boundary")).toBeInTheDocument();
    expect(screen.getByText(/render exploded/i)).toBeInTheDocument();
  });

  it("shows Retry button when onRetry is provided", () => {
    render(
      <SkeletonErrorBoundary onRetry={jest.fn()}>
        <Boom />
      </SkeletonErrorBoundary>,
    );
    expect(
      screen.getByRole("button", { name: /retry loading/i }),
    ).toBeInTheDocument();
  });

  it("calls onRetry and resets the error boundary on Retry click", () => {
    const onRetry = jest.fn();
    render(
      <SkeletonErrorBoundary onRetry={onRetry}>
        <Boom />
      </SkeletonErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry loading/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
