const MAX_ERROR_LENGTH = 500;

export type CompileErrorType =
  "compilation" | "network" | "timeout" | "rate-limit" | "unknown";

export interface CompileError {
  message: string;
  type: CompileErrorType;
  code?: string;
  retryable: boolean;
}

export function truncateMessage(msg: string): string {
  if (msg.length > MAX_ERROR_LENGTH) {
    return msg.slice(0, MAX_ERROR_LENGTH) + "...";
  }
  return msg;
}

export function classifyError(msg: string): {
  type: CompileErrorType;
  retryable: boolean;
} {
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { type: "timeout", retryable: true };
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("429")
  ) {
    return { type: "rate-limit", retryable: true };
  }
  if (
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("fetch failed")
  ) {
    return { type: "network", retryable: true };
  }
  if (
    lower.includes("syntax") ||
    lower.includes("error[E") ||
    lower.includes("compilation")
  ) {
    return { type: "compilation", retryable: false };
  }
  return { type: "unknown", retryable: false };
}
