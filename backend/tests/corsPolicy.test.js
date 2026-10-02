// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import {
  createCorsPolicy,
  resolveCorsPolicy,
  normalizeOrigin,
  compileOriginPattern,
} from '../src/config/cors.js';

const PROD = { NODE_ENV: 'production' };

function appWith(policy) {
  const app = express();
  app.use(policy.enforceOriginIsolation);
  app.use(policy.corsMiddleware);
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  app.post('/api/mutate', (_req, res) => res.json({ mutated: true }));
  return app;
}

describe('resolveCorsPolicy', () => {
  it('does not allow every origin in production when no allowlist is set', () => {
    const policy = resolveCorsPolicy(PROD);
    expect(policy.production).toBe(true);
    expect(policy.allowAll).toBe(false);
    expect(policy.warnings.join(' ')).toMatch(/No CORS allowlist/);
  });

  it('ignores "*" in production', () => {
    const policy = resolveCorsPolicy({ ...PROD, CORS_ALLOWED_ORIGINS: '*' });
    expect(policy.allowAll).toBe(false);
  });

  it('treats APP_ENV=production as production', () => {
    expect(resolveCorsPolicy({ APP_ENV: 'Production' }).production).toBe(true);
  });

  it('allows everything in production only with the explicit opt-out', () => {
    const policy = resolveCorsPolicy({
      ...PROD,
      CORS_ALLOW_ALL_ORIGINS: 'true',
    });
    expect(policy.allowAll).toBe(true);
    expect(policy.warnings.join(' ')).toMatch(/CORS_ALLOW_ALL_ORIGINS/);
  });

  it('trusts FRONTEND_URL alongside the explicit allowlist', () => {
    const policy = resolveCorsPolicy({
      ...PROD,
      CORS_ALLOWED_ORIGINS: 'https://a.example',
      FRONTEND_URL: 'https://app.vercel.app/',
    });
    expect(policy.origins).toEqual([
      'https://a.example',
      'https://app.vercel.app/',
    ]);
    expect(policy.warnings).toEqual([]);
  });

  it('keeps the permissive default outside production', () => {
    expect(resolveCorsPolicy({}).allowAll).toBe(true);
    expect(resolveCorsPolicy({}).allowLoopback).toBe(true);
    expect(resolveCorsPolicy(PROD).allowLoopback).toBe(false);
  });
});

describe('origin normalisation and wildcards', () => {
  it('normalises case and trailing slashes', () => {
    expect(normalizeOrigin(' HTTPS://App.Example.com/ ')).toBe(
      'https://app.example.com'
    );
  });

  it('matches configured origins regardless of formatting', () => {
    const policy = createCorsPolicy({
      ...PROD,
      CORS_ALLOWED_ORIGINS: 'https://App.Example.com/',
    });
    expect(policy.isOriginAllowed('https://app.example.com')).toBe(true);
  });

  it('wildcards only match a single DNS label', () => {
    const re = compileOriginPattern('https://*.example.com');
    expect(re.test('https://app-1.example.com')).toBe(true);
    // Characters outside a hostname label can no longer satisfy the wildcard.
    expect(re.test('https://evil.com:443@x.example.com')).toBe(false);
    expect(re.test('https://a/b.example.com')).toBe(false);
  });
});

describe('createCorsPolicy', () => {
  it('trusts loopback origins in development once an allowlist exists', () => {
    const policy = createCorsPolicy({
      CORS_ALLOWED_ORIGINS: 'https://app.example',
    });
    expect(policy.isOriginAllowed('http://localhost:3000')).toBe(true);
    expect(policy.isOriginAllowed('http://127.0.0.1:5173')).toBe(true);
    expect(policy.isOriginAllowed('https://other.example')).toBe(false);
  });

  it('can disable the loopback allowance', () => {
    const policy = createCorsPolicy({
      CORS_ALLOWED_ORIGINS: 'https://app.example',
      CORS_ALLOW_LOCALHOST: 'false',
    });
    expect(policy.isOriginAllowed('http://localhost:3000')).toBe(false);
  });

  it('never trusts loopback origins in production', () => {
    const policy = createCorsPolicy({
      ...PROD,
      CORS_ALLOWED_ORIGINS: 'https://app.example',
    });
    expect(policy.isOriginAllowed('http://localhost:3000')).toBe(false);
  });

  it('picks up runtime whitelist changes without being rebuilt', () => {
    let dynamic = [];
    const policy = createCorsPolicy(PROD, () => dynamic);
    expect(policy.isOriginAllowed('https://partner.example')).toBe(false);

    dynamic = ['https://partner.example'];
    expect(policy.isOriginAllowed('https://partner.example')).toBe(true);

    dynamic = [];
    expect(policy.isOriginAllowed('https://partner.example')).toBe(false);
  });
});

describe('CORS middleware (HTTP)', () => {
  const policy = createCorsPolicy({
    ...PROD,
    CORS_ALLOWED_ORIGINS: 'https://app.example,https://*.preview.example',
  });
  const app = appWith(policy);

  it('reflects a trusted origin and varies on Origin', async () => {
    const res = await request(app)
      .get('/api/ping')
      .set('Origin', 'https://app.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.example'
    );
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it('answers preflight for wildcard-matched origins', async () => {
    const res = await request(app)
      .options('/api/mutate')
      .set('Origin', 'https://pr-42.preview.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://pr-42.preview.example'
    );
  });

  it('rejects untrusted origins before the route runs', async () => {
    const res = await request(app)
      .post('/api/mutate')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.mutated).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows requests without an Origin header (server-to-server, probes)', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
  });

  it('allows same-origin browser requests (e.g. the /docs UI)', async () => {
    const res = await request(app)
      .post('/api/mutate')
      .set('Host', 'api.example')
      .set('Origin', 'https://api.example')
      .send({});
    expect(res.status).toBe(200);
  });

  it('can downgrade to header-only enforcement', async () => {
    const lenient = appWith(
      createCorsPolicy({
        ...PROD,
        CORS_ALLOWED_ORIGINS: 'https://app.example',
        CORS_STRICT_ORIGIN_CHECK: 'false',
      })
    );
    const res = await request(lenient)
      .get('/api/ping')
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects every cross-origin browser request in unconfigured production', async () => {
    const locked = appWith(createCorsPolicy(PROD));
    const res = await request(locked)
      .get('/api/ping')
      .set('Origin', 'https://anything.example');
    expect(res.status).toBe(403);
  });
});
