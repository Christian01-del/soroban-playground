// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * LoadingSkeleton – Issue #942
 *
 * Robust loading skeleton component with comprehensive error handling and
 * edge-case management. Provides animated placeholder UI while content loads
 * and surfaces clear error states with optional retry capability.
 */

import React, { Component, ErrorInfo, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkeletonVariant = "text" | "circle" | "rect" | "card";

export interface SkeletonLine {
  /** Variant of the skeleton line */
  variant?: SkeletonVariant;
  /** Width of the skeleton line (CSS value, e.g. "100%", "60%", "120px") */
  width?: string;
  /** Height of the skeleton line (CSS value) */
  height?: string;
  /** Optional extra CSS class */
  className?: string;
}

export interface LoadingSkeletonProps {
  /**
   * Number of skeleton rows to render when `lines` is not supplied.
   * Defaults to 3.
   */
  rows?: number;
  /**
   * Explicitly configured skeleton lines.  When supplied, `rows` is ignored.
   */
  lines?: SkeletonLine[];
  /** Whether the skeleton is in an error state. */
  error?: Error | string | null;
  /** Called when the user clicks the "Retry" button in the error state. */
  onRetry?: () => void;
  /** Whether the skeleton is still loading (shows skeleton) or done (renders children). */
  isLoading?: boolean;
  /** Content to render once loading is complete. */
  children?: ReactNode;
  /** Optional CSS class on the root element. */
  className?: string;
  /** ARIA label for the loading region. Defaults to "Loading content". */
  ariaLabel?: string;
  /** Variant used for all auto-generated rows. Defaults to "text". */
  variant?: SkeletonVariant;
  /** Animation style. Defaults to "pulse". */
  animation?: "pulse" | "wave" | "none";
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  onRetry?: () => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class SkeletonErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      "[LoadingSkeleton] Uncaught error in skeleton subtree:",
      error,
      info,
    );
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="skeleton-error-boundary"
          style={{
            padding: "16px",
            borderRadius: "8px",
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: "14px",
          }}
        >
          <strong>Something went wrong.</strong>
          {this.state.error && (
            <p style={{ marginTop: "4px", marginBottom: "8px" }}>
              {this.state.error.message}
            </p>
          )}
          {this.props.onRetry && (
            <button
              onClick={this.handleRetry}
              aria-label="Retry loading"
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                background: "#dc2626",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Retry
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseError(
  error: Error | string | null | undefined,
): string | null {
  if (!error) return null;
  if (error instanceof Error)
    return error.message || "An unexpected error occurred.";
  if (typeof error === "string")
    return error.trim() || "An unexpected error occurred.";
  return "An unexpected error occurred.";
}

function buildLines(rows: number, variant: SkeletonVariant): SkeletonLine[] {
  return Array.from({ length: Math.max(1, rows) }, (_, i) => ({
    variant,
    // Stagger widths for a more natural look
    width: i % 3 === 0 ? "100%" : i % 3 === 1 ? "80%" : "60%",
  }));
}

const ANIMATION_CLASS: Record<string, string> = {
  pulse: "skeleton-pulse",
  wave: "skeleton-wave",
  none: "",
};

function SingleLine({
  line,
  animation,
}: {
  line: SkeletonLine;
  animation: string;
}): React.ReactElement {
  const { variant = "text", width = "100%", height, className = "" } = line;

  const baseStyle: React.CSSProperties = {
    display: "block",
    background: "#e5e7eb",
    borderRadius: variant === "circle" ? "50%" : "4px",
    width,
    height:
      height ??
      (variant === "circle" ? width : variant === "card" ? "120px" : "16px"),
    marginBottom: variant === "card" ? "12px" : "8px",
  };

  return (
    <span
      role="presentation"
      aria-hidden="true"
      data-variant={variant}
      className={[ANIMATION_CLASS[animation], className]
        .filter(Boolean)
        .join(" ")}
      style={baseStyle}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LoadingSkeleton({
  rows = 3,
  lines,
  error = null,
  onRetry,
  isLoading = true,
  children,
  className = "",
  ariaLabel = "Loading content",
  variant = "text",
  animation = "pulse",
}: LoadingSkeletonProps): React.ReactElement {
  // Resolve the error message – handles both Error objects and strings
  const errorMessage = normaliseError(error);

  // --- Error state ---
  if (errorMessage) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        data-testid="skeleton-error"
        className={className}
        style={{
          padding: "16px",
          borderRadius: "8px",
          background: "#fee2e2",
          border: "1px solid #fca5a5",
          color: "#991b1b",
          fontSize: "14px",
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>Failed to load content</p>
        <p
          data-testid="skeleton-error-message"
          style={{ margin: "4px 0 8px", fontWeight: 400 }}
        >
          {errorMessage}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            aria-label="Retry loading"
            data-testid="skeleton-retry-button"
            style={{
              padding: "6px 14px",
              borderRadius: "4px",
              background: "#dc2626",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // --- Loaded state ---
  if (!isLoading) {
    // Gracefully handle the case where children is missing
    if (children == null) {
      return <div data-testid="skeleton-empty" className={className} />;
    }
    return <>{children}</>;
  }

  // --- Loading state ---
  const resolvedLines: SkeletonLine[] = lines ?? buildLines(rows, variant);

  // Guard against invalid/empty lines array
  if (!Array.isArray(resolvedLines) || resolvedLines.length === 0) {
    console.warn(
      "[LoadingSkeleton] No lines to render – falling back to default rows.",
    );
    const fallback = buildLines(rows, variant);
    return renderSkeleton(fallback, ariaLabel, animation, className);
  }

  return renderSkeleton(resolvedLines, ariaLabel, animation, className);
}

function renderSkeleton(
  lines: SkeletonLine[],
  ariaLabel: string,
  animation: string,
  className: string,
): React.ReactElement {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      aria-busy="true"
      data-testid="loading-skeleton"
      className={className}
    >
      <span className="sr-only">{ariaLabel}</span>
      {lines.map((line, idx) => (
        <SingleLine key={idx} line={line} animation={animation} />
      ))}
    </div>
  );
}

export default LoadingSkeleton;
