// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Test suite for LoggingMiddleware – Issue #961
 *
 * Covers:
 *  - Logs info on 2xx responses
 *  - Logs warn on 4xx responses
 *  - Logs error on 5xx responses
 *  - Includes method, url, statusCode, durationMs, requestId in log record
 *  - Assigns a new x-request-id header when none is present
 *  - Propagates an existing x-request-id header
 *  - Exposes req.requestId for downstream handlers
 *  - Skips logging for configured skip paths (e.g. /healthz)
 *  - Redacts sensitive headers when includeHeaders=true
 *  - Does NOT log request body by default
 *  - Logs request body when logRequestBody=true
 *  - Falls back gracefully when logger has no level-specific method
 *  - redactHeaders: redacts known sensitive keys and preserves others
 *  - resolveLogLevel: maps status codes to correct levels
 *  - buildLogRecord: returns the expected shape
 */

import express from 'express';
import request from 'supertest';
import {
  buildLogRecord,
  createLoggingMiddleware,
  redactHeaders,
  resolveLogLevel,
} from '../src/middleware/loggingMiddleware.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Waits for the `finish` event listener registered by the middleware to fire.
 * The middleware registers its logic on `res.on('finish', …)` which fires
 * after the response has been sent.  A single `setImmediate` tick is enough.
 */
function waitForFinish() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeApp(
  middlewareOptions = {},
  routeStatus = 200,
  routeBody = { ok: true }
) {
  const app = express();
  app.use(express.json());
  app.use(createLoggingMiddleware(middlewareOptions));
  app.get('/api/test', (_req, res) => res.status(routeStatus).json(routeBody));
  app.get('/healthz', (_req, res) => res.json({ status: 'up' }));
  app.post('/api/data', (req, res) =>
    res.status(201).json({ received: req.body })
  );
  return app;
}

// ---------------------------------------------------------------------------
// Unit: pure helpers
// ---------------------------------------------------------------------------

describe('resolveLogLevel', () => {
  it('returns "info" for 200', () => expect(resolveLogLevel(200)).toBe('info'));
  it('returns "info" for 201', () => expect(resolveLogLevel(201)).toBe('info'));
  it('returns "info" for 301', () => expect(resolveLogLevel(301)).toBe('info'));
  it('returns "warn" for 400', () => expect(resolveLogLevel(400)).toBe('warn'));
  it('returns "warn" for 404', () => expect(resolveLogLevel(404)).toBe('warn'));
  it('returns "warn" for 422', () => expect(resolveLogLevel(422)).toBe('warn'));
  it('returns "error" for 500', () =>
    expect(resolveLogLevel(500)).toBe('error'));
  it('returns "error" for 503', () =>
    expect(resolveLogLevel(503)).toBe('error'));
});

describe('redactHeaders', () => {
  it('redacts Authorization header', () => {
    const result = redactHeaders({ authorization: 'Bearer abc123' });
    expect(result.authorization).toBe('[REDACTED]');
  });

  it('redacts Cookie header', () => {
    const result = redactHeaders({ cookie: 'session=xyz' });
    expect(result.cookie).toBe('[REDACTED]');
  });

  it('redacts x-api-key header', () => {
    const result = redactHeaders({ 'x-api-key': 'my-key' });
    expect(result['x-api-key']).toBe('[REDACTED]');
  });

  it('preserves non-sensitive headers', () => {
    const result = redactHeaders({
      'content-type': 'application/json',
      accept: '*/*',
    });
    expect(result['content-type']).toBe('application/json');
    expect(result['accept']).toBe('*/*');
  });

  it('handles mixed sensitive and safe headers', () => {
    const result = redactHeaders({
      authorization: 'Bearer token',
      'content-type': 'application/json',
    });
    expect(result.authorization).toBe('[REDACTED]');
    expect(result['content-type']).toBe('application/json');
  });

  it('uses a custom sensitive header set', () => {
    const custom = new Set(['x-custom-secret']);
    const result = redactHeaders(
      { 'x-custom-secret': 'value', safe: 'ok' },
      custom
    );
    expect(result['x-custom-secret']).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });

  it('returns empty object when headers is empty', () => {
    expect(redactHeaders({})).toEqual({});
  });
});

describe('buildLogRecord', () => {
  it('returns the expected shape', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/contracts',
      headers: { 'user-agent': 'jest' },
      ip: '127.0.0.1',
    };
    const record = buildLogRecord({
      req,
      statusCode: 200,
      durationMs: 45,
      requestId: 'test-id',
    });
    expect(record).toMatchObject({
      requestId: 'test-id',
      method: 'GET',
      url: '/api/contracts',
      statusCode: 200,
      durationMs: 45,
      userAgent: 'jest',
      ip: '127.0.0.1',
    });
  });

  it('falls back to null for missing userAgent and ip', () => {
    const req = { method: 'POST', originalUrl: '/deploy', headers: {} };
    const record = buildLogRecord({
      req,
      statusCode: 201,
      durationMs: 10,
      requestId: 'r1',
    });
    expect(record.userAgent).toBeNull();
    expect(record.ip).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: Express middleware
// ---------------------------------------------------------------------------

describe('createLoggingMiddleware – log levels', () => {
  it('calls logger.info on a 200 response', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    await request(app).get('/api/test').expect(200);
    await waitForFinish();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('calls logger.warn on a 404 response', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = express();
    app.use(createLoggingMiddleware({ logger }));
    app.get('/api/test', (_req, res) =>
      res.status(404).json({ error: 'not found' })
    );

    await request(app).get('/api/test').expect(404);
    await waitForFinish();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('calls logger.error on a 500 response', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = express();
    app.use(createLoggingMiddleware({ logger }));
    app.get('/api/test', (_req, res) =>
      res.status(500).json({ error: 'server error' })
    );

    await request(app).get('/api/test').expect(500);
    await waitForFinish();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('createLoggingMiddleware – log record contents', () => {
  it('includes method, url, statusCode, durationMs in the log record', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    await request(app).get('/api/test').expect(200);
    await waitForFinish();

    const [, record] = logger.info.mock.calls[0];
    expect(record.method).toBe('GET');
    expect(record.url).toBe('/api/test');
    expect(record.statusCode).toBe(200);
    expect(typeof record.durationMs).toBe('number');
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes requestId in the log record', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    await request(app).get('/api/test').expect(200);
    await waitForFinish();

    const [, record] = logger.info.mock.calls[0];
    expect(typeof record.requestId).toBe('string');
    expect(record.requestId.length).toBeGreaterThan(0);
  });
});

describe('createLoggingMiddleware – request id', () => {
  it('sets x-request-id response header', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    const res = await request(app).get('/api/test');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('propagates an existing x-request-id from the request', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    const res = await request(app)
      .get('/api/test')
      .set('x-request-id', 'client-provided-id');
    expect(res.headers['x-request-id']).toBe('client-provided-id');

    await waitForFinish();
    const [, record] = logger.info.mock.calls[0];
    expect(record.requestId).toBe('client-provided-id');
  });
});

describe('createLoggingMiddleware – skip paths', () => {
  it('does not log health-check requests by default', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    await request(app).get('/healthz').expect(200);
    await waitForFinish();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs requests not in the skip list', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    await request(app).get('/api/test').expect(200);
    await waitForFinish();

    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('respects custom skip paths', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = express();
    app.use(createLoggingMiddleware({ logger, skipPaths: ['/api/test'] }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    await request(app).get('/api/test').expect(200);
    await waitForFinish();

    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('createLoggingMiddleware – headers', () => {
  it('does not include headers in the log record by default', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 200);

    await request(app)
      .get('/api/test')
      .set('authorization', 'Bearer secret')
      .expect(200);
    await waitForFinish();

    const [, record] = logger.info.mock.calls[0];
    expect(record.headers).toBeUndefined();
  });

  it('includes and redacts headers when includeHeaders=true', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger, includeHeaders: true }, 200);

    await request(app)
      .get('/api/test')
      .set('authorization', 'Bearer secret')
      .set('content-type', 'application/json')
      .expect(200);
    await waitForFinish();

    const [, record] = logger.info.mock.calls[0];
    expect(record.headers).toBeDefined();
    expect(record.headers.authorization).toBe('[REDACTED]');
    // content-type is not sensitive
    expect(record.headers['content-type']).not.toBe('[REDACTED]');
  });
});

describe('createLoggingMiddleware – request body', () => {
  it('does not log request body by default', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger }, 201);

    await request(app)
      .post('/api/data')
      .send({ name: 'contract', secret: 'abc' })
      .expect(201);
    await waitForFinish();

    const [, record] = logger.info.mock.calls[0];
    expect(record.body).toBeUndefined();
  });

  it('logs the request body when logRequestBody=true', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const app = makeApp({ logger, logRequestBody: true }, 201);

    await request(app)
      .post('/api/data')
      .send({ name: 'my-contract' })
      .expect(201);
    await waitForFinish();

    const [, record] = logger.info.mock.calls[0];
    expect(record.body).toBeDefined();
    expect(record.body.name).toBe('my-contract');
  });
});

describe('createLoggingMiddleware – fallback logger', () => {
  it('falls back to logger.info when logger has no warn method', async () => {
    const logger = { info: jest.fn() };
    const app = express();
    app.use(createLoggingMiddleware({ logger }));
    app.get('/api/test', (_req, res) => res.status(404).json({}));

    await request(app).get('/api/test').expect(404);
    await waitForFinish();

    // No warn method – should fall back to info
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});
