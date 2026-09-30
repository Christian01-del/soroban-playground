/**
 * Robust Integration Test Runner Utility
 *
 * Provides enhanced error handling, retries, and detailed reporting for
 * integration tests.
 *
 * Improvements (issue #981):
 * - Always clear the timeout timer (try/finally) so a fetch rejection can't
 *   leave the event loop waiting on a dead timer.
 * - Exponential backoff with `linear` / `none` fallbacks. `retryDelay` is
 *   reused as the base unit so behavior matches the previous version when
 *   callers do not opt in.
 * - Categorize failure causes (network, timeout, parse, http, rate_limit)
 *   so the summary is actionable.
 * - Honor `Retry-After` on HTTP 429 responses (seconds or HTTP-date).
 * - Track per-test duration and emit `durationMs`, `categoryCounts`, and
 *   `failedResults` in the summary.
 *
 * Backward compatibility:
 * - Constructor options are additive (`backoff`, `backoffMaxMs` are new).
 * - `runTest(name, path, method?, body?, headers?)` signature is unchanged.
 * - `getSummary()` adds `durationMs`, `categoryCounts`, `failedResults`
 *   alongside the existing `total/passed/failed/successRate/results`.
 * - Default `maxRetries` (3), `retryDelay` (1000), and `timeout` (10000)
 *   are unchanged.
 */

export const ERROR_CATEGORIES = Object.freeze({
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  PARSE: 'parse',
  HTTP: 'http',
  RATE_LIMIT: 'rate_limit',
  UNKNOWN: 'unknown',
});

/**
 * Network error codes we expect from undici/fetch (`error.cause.code` on
 * Node 20). Kept centralized for testability.
 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export class IntegrationTestRunner {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.options = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      // `backoff` is 'exponential' (default), 'linear', or 'none'.
      backoff: options.backoff || 'exponential',
      backoffMaxMs: options.backoffMaxMs || 30000,
      timeout: options.timeout || 10000,
      verbose: options.verbose || false,
    };
    this.results = [];
    this.startedAt = Date.now();
  }

  /**
   * Compute the delay before the next retry attempt.
   * Honors explicit `Retry-After` when supplied; otherwise falls back to
   * the configured exponential/linear/none schedule with a hard cap.
   */
  _computeRetryDelay(attempt, retryAfterMs) {
    if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) {
      return Math.min(retryAfterMs, this.options.backoffMaxMs);
    }
    const base = this.options.retryDelay;
    let delay;
    switch (this.options.backoff) {
      case 'linear':
        delay = base * attempt;
        break;
      case 'none':
        delay = 0;
        break;
      case 'exponential':
      default:
        // attempt is incremented *before* this call, so first retry sleeps
        // `base * 2^0 = base`, second sleeps `base * 2^1 = 2*base`, etc.
        delay = base * Math.pow(2, Math.max(0, attempt - 1));
        break;
    }
    return Math.min(delay, this.options.backoffMaxMs);
  }

  async _sleep(ms) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Best-effort classification when the throw site is unknown. */
  _classify(error, response) {
    if (response && response.status === 429) {
      return ERROR_CATEGORIES.RATE_LIMIT;
    }
    if (error && error.name === 'AbortError') {
      return ERROR_CATEGORIES.TIMEOUT;
    }
    if (error && error.code === 'parse') {
      return ERROR_CATEGORIES.PARSE;
    }
    if (response && response.status >= 400) {
      return ERROR_CATEGORIES.HTTP;
    }
    const causeCode = error?.cause?.code || error?.code;
    if (causeCode && NETWORK_ERROR_CODES.has(causeCode)) {
      return ERROR_CATEGORIES.NETWORK;
    }
    return ERROR_CATEGORIES.UNKNOWN;
  }

  /** Parse a `Retry-After` header (seconds OR HTTP-date) into ms. */
  _parseRetryAfter(value, now = Date.now()) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - now);
    }
    return null;
  }

  _buildErrorPayload(category, message, details = {}) {
    return { category, message, ...details };
  }

  async runTest(name, path, method = 'GET', body = null, headers = {}) {
    const testStartedAt = Date.now();
    let attempt = 0;
    let lastError = null;
    let lastErrorCategory = ERROR_CATEGORIES.UNKNOWN;
    let lastStatus = null;
    let lastRetryAfterMs = null;

    while (attempt < this.options.maxRetries) {
      // Capture in local scope so the finally block always sees the right
      // timer, even on a non-fetch rejection early in the loop.
      const controller = new AbortController();
      const timeoutMs = this.options.timeout;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      if (this.options.verbose) {
        console.log(
          `[${name}] Attempt ${attempt + 1}/${this.options.maxRetries}...`
        );
      }

      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body ? JSON.stringify(body) : null,
          signal: controller.signal,
        });

        // Always capture Retry-After when the header is present, regardless
        // of the previous classification. We overwrite cautiously — only a
        // fresh header value beats a stale one.
        const retryAfterMs = this._parseRetryAfter(
          response.headers.get('Retry-After')
        );
        if (retryAfterMs !== null) {
          lastRetryAfterMs = retryAfterMs;
        }

        // Decide success vs. failure BEFORE parsing JSON so we don't mis-
        // classify 429 / 5xx with a non-JSON body as a parse error.
        if (response.ok) {
          const data = await this._safeJson(response);
          const durationMs = Date.now() - testStartedAt;
          this.logResult(name, true, {
            status: response.status,
            data,
            durationMs,
            attempts: attempt + 1,
          });
          return {
            success: true,
            data,
            durationMs,
            attempts: attempt + 1,
          };
        }

        if (response.status === 429) {
          attempt++;
          lastStatus = response.status;
          lastErrorCategory = ERROR_CATEGORIES.RATE_LIMIT;
          lastError = this._buildErrorPayload(
            ERROR_CATEGORIES.RATE_LIMIT,
            `HTTP 429: ${response.statusText || 'rate limited'}`,
            {
              status: response.status,
              retryAfterMs: lastRetryAfterMs,
            }
          );
          if (attempt < this.options.maxRetries) {
            const delay = this._computeRetryDelay(attempt, lastRetryAfterMs);
            if (this.options.verbose) {
              console.log(
                `[${name}] Rate limited (HTTP 429); retrying after ${delay}ms`
              );
            }
            await this._sleep(delay);
            continue;
          }
          break;
        }

        // Non-2xx, non-429 — fail; deterministic 4xx won't be retried below.
        const parsedBody = await this._safeJson(response);
        throw Object.assign(
          new Error(
            `HTTP ${response.status}: ${parsedBody.message || response.statusText}`
          ),
          { code: 'http', status: response.status }
        );
      } catch (error) {
        attempt++;
        lastStatus = error.status || null;

        if (error.name === 'AbortError') {
          lastErrorCategory = ERROR_CATEGORIES.TIMEOUT;
          lastError = this._buildErrorPayload(
            ERROR_CATEGORIES.TIMEOUT,
            `Request timed out after ${this.options.timeout}ms`
          );
        } else if (error.code === 'parse') {
          lastErrorCategory = ERROR_CATEGORIES.PARSE;
          lastError = this._buildErrorPayload(
            ERROR_CATEGORIES.PARSE,
            error.message,
            { status: error.status }
          );
        } else if (error.code === 'http') {
          lastErrorCategory = ERROR_CATEGORIES.HTTP;
          lastError = this._buildErrorPayload(
            ERROR_CATEGORIES.HTTP,
            error.message,
            { status: error.status }
          );
          // For deterministic HTTP errors (4xx other than 429), do not retry.
          if (
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ) {
            break;
          }
        } else {
          lastErrorCategory = this._classify(error, null);
          lastError = this._buildErrorPayload(
            lastErrorCategory,
            error.message || String(error)
          );
        }

        if (attempt < this.options.maxRetries) {
          const delay = this._computeRetryDelay(attempt, lastRetryAfterMs);
          if (this.options.verbose) {
            console.log(
              `[${name}] ${lastError.category} failure; retrying in ${delay}ms`
            );
          }
          await this._sleep(delay);
        }
      } finally {
        // Always clear the timer. The original implementation cleared it
        // only after a successful fetch resolution; any rejection path
        // (ECONNREFUSED, DNS error, AbortError, parse error) would leave
        // the timer pending and keep the event loop alive until the
        // timeout window elapsed.
        clearTimeout(timeoutId);
      }
    }

    const durationMs = Date.now() - testStartedAt;
    const errorMessage = (lastError && lastError.message) || 'Unknown failure';
    const errorCategory =
      (lastError && lastError.category) || lastErrorCategory;

    this.logResult(name, false, {
      error: errorMessage,
      errorCategory,
      status: lastStatus,
      durationMs,
      attempts: attempt,
    });

    return {
      success: false,
      error: errorMessage,
      errorCategory,
      durationMs,
      attempts: attempt,
    };
  }

  /**
   * Read response JSON. Throws a `parse`-tagged Error on failure so the
   * caller's catch block can categorize it as `PARSE`. We deliberately
   * rethrow instead of returning a stub — silent fallback would mask real
   * backend bugs (a 200 OK with a non-JSON body is almost always a server
   * regression).
   */
  async _safeJson(response) {
    try {
      return await response.json();
    } catch (parseError) {
      const e = new Error(
        `Failed to parse JSON response (${response.status} ${
          response.statusText || ''
        }): ${parseError.message}`
      );
      e.code = 'parse';
      e.status = response.status;
      throw e;
    }
  }

  logResult(name, success, details) {
    const result = {
      name,
      success,
      timestamp: new Date().toISOString(),
      ...details,
    };
    this.results.push(result);

    if (success) {
      console.log(
        `✅ [PASS] ${name} (${result.durationMs ?? 0}ms, attempt ${
          result.attempts ?? 1
        })`
      );
    } else {
      const category = result.errorCategory ? `[${result.errorCategory}] ` : '';
      console.error(
        `❌ [FAIL] ${name}: ${category}${result.error}` +
          ` (${result.durationMs ?? 0}ms, attempts ${result.attempts ?? 0})`
      );
    }
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.success).length;
    const failed = total - passed;
    const failedResults = this.results.filter((r) => !r.success);
    const categoryCounts = failedResults.reduce((acc, r) => {
      const key = r.errorCategory || ERROR_CATEGORIES.UNKNOWN;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return {
      total,
      passed,
      failed,
      successRate: total > 0 ? (passed / total) * 100 : 0,
      durationMs: Date.now() - this.startedAt,
      categoryCounts,
      failedResults,
      results: this.results,
    };
  }
}
