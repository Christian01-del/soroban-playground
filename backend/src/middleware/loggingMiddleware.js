// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Logging Middleware – Issue #961
 *
 * Structured HTTP request/response logging middleware for the Soroban
 * Playground backend.
 *
 * Features:
 *  - Logs method, URL, status code, response time (ms), and request id
 *  - Pluggable logger (defaults to console) – easy to swap for Winston/Pino
 *  - Redacts a configurable set of sensitive headers (Authorization, Cookie, …)
 *  - Optional request body logging (disabled by default to avoid large payloads)
 *  - Skips logging for configured path prefixes (e.g. /healthz)
 *  - Generates a unique request-id (X-Request-Id header) per request when absent
 *  - Logs at "info" for 2xx/3xx, "warn" for 4xx, "error" for 5xx
 */

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
]);

const DEFAULT_SKIP_PATHS = ['/healthz', '/health', '/ping', '/metrics'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a sanitised copy of the headers object with sensitive values redacted.
 *
 * @param {Record<string, string|string[]>} headers
 * @param {Set<string>} sensitiveHeaders
 * @returns {Record<string, string|string[]>}
 */
export function redactHeaders(
  headers = {},
  sensitiveHeaders = DEFAULT_SENSITIVE_HEADERS
) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = sensitiveHeaders.has(key.toLowerCase())
      ? '[REDACTED]'
      : value;
  }
  return result;
}

/**
 * Maps an HTTP status code to a log level string.
 *
 * @param {number} statusCode
 * @returns {'info'|'warn'|'error'}
 */
export function resolveLogLevel(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

/**
 * Builds the structured log record for a completed request.
 *
 * @param {object} options
 * @returns {object}
 */
export function buildLogRecord({ req, statusCode, durationMs, requestId }) {
  return {
    requestId,
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode,
    durationMs,
    userAgent: req.headers?.['user-agent'] ?? null,
    ip: req.ip || req.socket?.remoteAddress || null,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a structured logging middleware.
 *
 * @param {object} [options]
 * @param {object}   [options.logger]           Logger with info/warn/error methods. Defaults to console.
 * @param {boolean}  [options.logRequestBody]   Log sanitised request body. Defaults to false.
 * @param {Set<string>} [options.sensitiveHeaders]  Header names (lowercase) to redact.
 * @param {string[]} [options.skipPaths]        Path prefixes that suppress logging.
 * @param {boolean}  [options.includeHeaders]   Include sanitised request headers in the log record.
 * @returns {function} Express middleware
 */
export function createLoggingMiddleware(options = {}) {
  const {
    logger = console,
    logRequestBody = false,
    sensitiveHeaders = DEFAULT_SENSITIVE_HEADERS,
    skipPaths = DEFAULT_SKIP_PATHS,
    includeHeaders = false,
  } = options;

  return function loggingMiddleware(req, res, next) {
    const url = req.originalUrl || req.url || '/';

    // Skip logging for configured paths
    const shouldSkip = skipPaths.some((prefix) => url.startsWith(prefix));
    if (shouldSkip) {
      return next();
    }

    // Assign or propagate a request id
    const requestId =
      req.headers?.['x-request-id'] ||
      (typeof randomUUID === 'function' ? randomUUID() : `req-${Date.now()}`);

    // Expose on request so route handlers can reference it
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const statusCode = res.statusCode;
      const level = resolveLogLevel(statusCode);

      const record = buildLogRecord({ req, statusCode, durationMs, requestId });

      if (includeHeaders) {
        record.headers = redactHeaders(req.headers, sensitiveHeaders);
      }

      if (logRequestBody && req.body && Object.keys(req.body).length > 0) {
        record.body = req.body;
      }

      const message = `${req.method} ${url} ${statusCode} ${durationMs}ms`;

      if (typeof logger[level] === 'function') {
        logger[level](message, record);
      } else {
        // Fallback for loggers that only expose a generic log method
        logger.info(message, record);
      }
    });

    return next();
  };
}

export default createLoggingMiddleware();
