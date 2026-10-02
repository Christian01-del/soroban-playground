'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { toastManager } from '../lib/toastManager';

const SENSITIVE_KEY = /(authorization|cookie|password|secret|private.?key|seed|token|mnemonic|signature)/i;

export interface TelemetryLog {
  error: string;
  name?: string;
  stack?: string;
  componentStack?: string;
  details?: Record<string, unknown>;
  url?: string;
  timestamp: string;
  level: 'page' | 'widget' | 'global';
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  level?: 'page' | 'widget' | 'global';
  onReset?: () => void;
  onLogError?: (log: TelemetryLog) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value === 'undefined') return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!SENSITIVE_KEY.test(key)) result[key] = safeValue(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

export function describeUnknownError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown runtime exception',
      stack: error.stack,
      details: safeValue(error) as Record<string, unknown> | undefined,
    };
  }

  if (typeof error === 'string') return { name: 'ThrownValue', message: error || 'Unknown runtime exception' };
  if (error && typeof error === 'object') {
    const details = safeValue(error) as Record<string, unknown>;
    const candidate = details.message;
    return {
      name: typeof details.name === 'string' ? details.name : 'ThrownObject',
      message: typeof candidate === 'string' ? candidate : JSON.stringify(details) || 'Unknown runtime exception',
      stack: typeof details.stack === 'string' ? details.stack : undefined,
      details,
    };
  }
  return { name: 'ThrownValue', message: String(error) || 'Unknown runtime exception' };
}

function safeUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function createDiagnosticLog(
  error: unknown,
  errorInfo: ErrorInfo | null,
  level: ErrorBoundaryProps['level'] = 'global',
  now: Date = new Date(),
): TelemetryLog {
  const described = describeUnknownError(error);
  return {
    error: described.message,
    name: described.name,
    stack: described.stack,
    componentStack: errorInfo?.componentStack || undefined,
    details: described.details,
    url: safeUrl(),
    timestamp: now.toISOString(),
    level: level || 'global',
  };
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null, errorInfo: null };
  private handledErrorKey: string | null = null;

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const log = createDiagnosticLog(error, errorInfo, this.props.level);
    this.setState({ errorInfo });

    const errorKey = `${log.name}:${log.error}:${log.stack || ''}:${log.componentStack || ''}`;
    if (this.handledErrorKey === errorKey) return;
    this.handledErrorKey = errorKey;

    try {
      this.props.onLogError?.(log);
      if (!this.props.onLogError) console.error('[ErrorBoundary Telemetry]', log);
    } catch (loggingError) {
      console.error('[ErrorBoundary Telemetry Failure]', loggingError);
    }

    try {
      toastManager.show({
        title: 'Something went wrong',
        message: log.error,
        type: 'error',
        priority: 'high',
        groupId: `error-boundary:${errorKey}`,
      });
    } catch (toastError) {
      console.error('[ErrorBoundary Toast Failure]', toastError);
    }
  }

  public handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  public handleReloadSession = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  public handleExportDiagnostics = (): void => {
    if (typeof window === 'undefined') return;
    const diagnostics = createDiagnosticLog(this.state.error, this.state.errorInfo, this.props.level);
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `crash-report-${diagnostics.timestamp.replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  public render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const isWidget = this.props.level === 'widget';
    return (
      <div role="alert" className={`p-6 rounded-xl border border-red-500/30 bg-red-950/20 backdrop-blur-md shadow-2xl ${isWidget ? 'max-w-md my-2' : 'max-w-3xl mx-auto my-8'}`}>
        <div className="flex items-center gap-3 text-red-400 mb-3">
          <h3 className="text-xl font-semibold tracking-wide">
            {isWidget ? 'Widget Component Crashed' : 'An Unexpected Error Occurred'}
          </h3>
        </div>
        <p className="text-sm text-gray-300 mb-4 font-mono bg-black/40 p-3 rounded border border-gray-800 break-words">
          {this.state.error?.message || 'Unknown runtime exception'}
        </p>
        <div className="flex flex-wrap gap-3 mt-4">
          <button onClick={this.handleReset} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white">Try Again</button>
          <button onClick={this.handleReloadSession} className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-800 text-gray-200">Reload Session</button>
          <button onClick={this.handleExportDiagnostics} className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-gray-400">Export Crash Diagnostics</button>
        </div>
      </div>
    );
  }
}
