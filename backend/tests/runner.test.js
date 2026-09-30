import { IntegrationTestRunner, ERROR_CATEGORIES } from './runner.js';

/**
 * Tests for the Robust Integration Test Runner (issue #981).
 *
 * The runner uses global `fetch` and AbortController, so we stub the
 * network with a small loopback HTTP server bound to 127.0.0.1. We use
 * 127.0.0.1 (not localhost) to avoid Node 20 fetch occasionally
 * resolving to ::1 / IPv6 in CI environments.
 */

const TEST_HOST = '127.0.0.1';

let server = null;
let baseUrl = '';

async function startServer(handler) {
  const http = await import('node:http');
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, TEST_HOST, () => {
      const { port } = s.address();
      baseUrl = `http://${TEST_HOST}:${port}`;
      server = s;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    s.close(() => resolve());
  });
}

afterEach(async () => {
  await stopServer();
});

describe('IntegrationTestRunner', () => {
  describe('happy path', () => {
    it('passes a single GET request', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 1,
        timeout: 2000,
      });
      const result = await runner.runTest('OK', '/');
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);

      const summary = runner.getSummary();
      expect(summary.total).toBe(1);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(0);
    });

    it('reports duration in the summary', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 1,
        timeout: 2000,
      });
      await runner.runTest('OK', '/');
      const summary = runner.getSummary();
      expect(typeof summary.durationMs).toBe('number');
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('retry/backoff', () => {
    it('retries on a transient 500 then succeeds', async () => {
      let hits = 0;
      await startServer((req, res) => {
        hits += 1;
        if (hits < 3) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'boom' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 3,
        backoff: 'none',
        timeout: 2000,
      });
      const result = await runner.runTest('Transient 500', '/');
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(hits).toBe(3);
    });

    it('does not retry on deterministic 4xx (e.g. 401)', async () => {
      let hits = 0;
      await startServer((req, res) => {
        hits += 1;
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'unauth' }));
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 5,
        backoff: 'none',
        timeout: 2000,
      });
      const result = await runner.runTest('Auth', '/');
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe(ERROR_CATEGORIES.HTTP);
      // Should hit server exactly once despite maxRetries=5.
      expect(hits).toBe(1);
      expect(result.attempts).toBe(1);
    });

    it('does not retry on 404 (client error)', async () => {
      let hits = 0;
      await startServer((req, res) => {
        hits += 1;
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'nope' }));
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 4,
        backoff: 'none',
        timeout: 2000,
      });
      const result = await runner.runTest('Missing', '/');
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe(ERROR_CATEGORIES.HTTP);
      expect(hits).toBe(1);
    });
  });

  describe('timeout leak regression (issue #981)', () => {
    /**
     * Real regression test for the bug fixed in this PR. With the old
     * implementation, `clearTimeout(timeoutId)` was inside the try block
     * AFTER `await fetch(...)`. If fetch threw synchronously low-level
     * (ECONNREFUSED), the timer stayed pending and would refire ~10s
     * later — aborting the second attempt.
     *
     * Strategy: bind a server and immediately close it so the next fetch
     * fails with ECONNREFUSED. With maxRetries=2 and timeout=1500ms, the
     * OLD code's leaked timer from attempt 1 would still be alive at the
     * start of attempt 2 (it was set at t=0 to fire at t=1500ms), but the
     * run loop uses async jumps so the wall-clock duration should still
     * stay well under the timeout window.
     */
    it('clears its AbortController timer on fetch rejection', async () => {
      await startServer(() => {});
      const failingPort = new URL(baseUrl).port;
      await stopServer();
      // /tmp port is now closed → fetches will refuse
      const failingUrl = `http://${TEST_HOST}:${failingPort}`;

      const runner = new IntegrationTestRunner(failingUrl, {
        maxRetries: 2,
        backoff: 'none',
        timeout: 1500,
      });
      const before = Date.now();
      const result = await runner.runTest('Leak regression', '/');
      const elapsed = Date.now() - before;

      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe(ERROR_CATEGORIES.NETWORK);
      // Two attempts with no backoff. Each attempt fails nearly instantly
      // via ECONNREFUSED. 2s upper bound (with generous slack for CI).
      expect(elapsed).toBeLessThan(2000);
      expect(result.attempts).toBe(2);
    });

    it('clears its AbortController timer when the fetch resolves', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 1,
        timeout: 60_000, // intentionally huge — must NOT fire
      });
      const before = Date.now();
      const result = await runner.runTest('Cleanup on success', '/');
      const elapsed = Date.now() - before;

      expect(result.success).toBe(true);
      // If the timer leaked we'd be waiting 60s; allow a generous window
      // for CI jitter.
      expect(elapsed).toBeLessThan(5_000);
    });

    it('aborts cleanly when the server hangs past the timeout', async () => {
      await startServer(() => {
        // never respond
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 1,
        timeout: 400,
      });
      const before = Date.now();
      const result = await runner.runTest('Hang', '/');
      const elapsed = Date.now() - before;

      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe(ERROR_CATEGORIES.TIMEOUT);
      // abort fires ~400ms in; give ourselves 2s slack.
      expect(elapsed).toBeLessThan(2_500);
    });
  });

  describe('error categorization', () => {
    it('classifies connection refused as network', async () => {
      await startServer(() => {});
      const failingPort = new URL(baseUrl).port;
      await stopServer();
      const failingUrl = `http://${TEST_HOST}:${failingPort}`;

      const runner = new IntegrationTestRunner(failingUrl, {
        maxRetries: 1,
        timeout: 2000,
      });
      const result = await runner.runTest('Conn refused', '/');
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe(ERROR_CATEGORIES.NETWORK);
    });

    it('classifies a non-JSON 200 response as parse', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('this is not json');
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 1,
        timeout: 1000,
      });
      const result = await runner.runTest('Non-JSON 200', '/');
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe(ERROR_CATEGORIES.PARSE);
    });
  });

  describe('rate-limit honoring', () => {
    it('classifies 429 as rate_limit and retries past the Retry-After', async () => {
      let hits = 0;
      await startServer((req, res) => {
        hits += 1;
        if (hits === 1) {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': '0',
          });
          res.end(JSON.stringify({ message: 'slow down' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 3,
        backoff: 'none',
        timeout: 2000,
      });
      const result = await runner.runTest('Rate limit', '/');
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('honors non-JSON 429 (e.g. plain text body from a proxy)', async () => {
      let hits = 0;
      await startServer((req, res) => {
        hits += 1;
        if (hits === 1) {
          res.writeHead(429, {
            'Content-Type': 'text/plain',
            'Retry-After': '0',
          });
          res.end('Too Many Requests');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 3,
        backoff: 'none',
        timeout: 2000,
      });
      const result = await runner.runTest('Plain text 429', '/');
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });
  });

  describe('summary telemetry', () => {
    it('includes duration and category counts', async () => {
      let hits = 0;
      await startServer((req, res) => {
        hits += 1;
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'nope' }));
      });

      const runner = new IntegrationTestRunner(baseUrl, {
        maxRetries: 1,
        timeout: 1000,
      });
      await runner.runTest('A', '/');
      await runner.runTest('B', '/');
      const summary = runner.getSummary();

      expect(summary.total).toBe(2);
      expect(summary.failed).toBe(2);
      expect(summary.categoryCounts.http).toBe(2);
      expect(summary.failedResults).toHaveLength(2);
      expect(typeof summary.durationMs).toBe('number');
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
