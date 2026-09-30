"use client";

/**
 * OnboardingFlow
 *
 * A step-by-step first-run flow (connect wallet → pick a network → load a
 * starter contract). Each step can run an async action, and the flow is built
 * so that a failing step never leaves the user stuck:
 *
 *   - Errors are caught and surfaced inline with the step that produced them.
 *   - Failed steps can be retried without restarting the flow.
 *   - Steps marked `optional` can be skipped past a persistent failure.
 *   - A step that hangs is bounded by a timeout instead of spinning forever.
 *   - Progress is never advanced on failure, so state stays consistent.
 *
 * Usage:
 *   <OnboardingFlow steps={steps} onComplete={() => setOnboarded(true)} />
 */

import { useCallback, useMemo, useState } from "react";

export interface OnboardingStep {
  id: string;
  title: string;
  description?: string;
  /** Optional async work to run when the user advances past this step. */
  action?: () => Promise<void> | void;
  /** Optional steps can be skipped, including after a failure. */
  optional?: boolean;
}

interface OnboardingFlowProps {
  steps: OnboardingStep[];
  onComplete?: () => void;
  onSkip?: () => void;
  /** Milliseconds before a step action is treated as failed. */
  stepTimeoutMs?: number;
  className?: string;
}

const DEFAULT_STEP_TIMEOUT_MS = 15_000;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Something went wrong. Please try again.";
}

/** Rejects if `promise` has not settled within `timeoutMs`. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `This step timed out after ${Math.round(timeoutMs / 1000)}s.`,
          ),
        ),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export default function OnboardingFlow({
  steps,
  onComplete,
  onSkip,
  stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  className = "",
}: OnboardingFlowProps) {
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const progress = useMemo(
    () => (steps.length ? Math.round((index / steps.length) * 100) : 0),
    [index, steps.length],
  );

  const advance = useCallback(() => {
    setError(null);
    setAttempts(0);
    if (isLast) {
      onComplete?.();
      return;
    }
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [isLast, onComplete, steps.length]);

  const runStep = useCallback(async () => {
    if (!step || busy) return;

    if (!step.action) {
      advance();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Wrap in Promise.resolve so synchronous throws are caught here too.
      await withTimeout(
        Promise.resolve().then(() => step.action?.()),
        stepTimeoutMs,
      );
      advance();
    } catch (err) {
      // Stay on the current step — advancing past a failed action would leave
      // the user in an inconsistent state (e.g. "connected" without a wallet).
      setAttempts((count) => count + 1);
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [advance, busy, step, stepTimeoutMs]);

  const skipStep = useCallback(() => {
    setError(null);
    setAttempts(0);
    if (isLast) {
      onComplete?.();
      return;
    }
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [isLast, onComplete, steps.length]);

  const goBack = useCallback(() => {
    setError(null);
    setAttempts(0);
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  // An empty step list is a caller bug, but it must not crash the app.
  if (!step) {
    return (
      <div
        className={`rounded-lg border border-gray-700 bg-gray-900 p-4 ${className}`}
      >
        <p className="text-sm text-gray-400">
          No onboarding steps are configured.
        </p>
      </div>
    );
  }

  const canSkip = step.optional || attempts >= 2;

  return (
    <section
      className={`rounded-lg border border-gray-700 bg-gray-900 p-5 ${className}`}
      aria-label="Onboarding"
    >
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
          <span>
            Step {index + 1} of {steps.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-100">{step.title}</h2>
      {step.description && (
        <p className="mt-1 text-sm text-gray-400">{step.description}</p>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-700/50 bg-red-900/30 p-3 text-sm text-red-200"
        >
          <p>{error}</p>
          {attempts >= 2 && (
            <p className="mt-1 text-xs text-red-300/80">
              This step has failed {attempts} times.{" "}
              {step.optional
                ? "You can skip it and come back later."
                : "You can retry, or skip for now and finish setup later."}
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runStep}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : error ? "Retry" : isLast ? "Finish" : "Continue"}
        </button>

        {index > 0 && (
          <button
            type="button"
            onClick={goBack}
            disabled={busy}
            className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Back
          </button>
        )}

        {canSkip && (
          <button
            type="button"
            onClick={skipStep}
            disabled={busy}
            className="rounded-md px-3 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            Skip this step
          </button>
        )}

        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="ml-auto text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            Skip onboarding
          </button>
        )}
      </div>
    </section>
  );
}

export { OnboardingFlow };
