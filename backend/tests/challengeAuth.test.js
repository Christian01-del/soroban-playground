// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Tests for challengeAuth middleware (#1576)
 * – nonce generation & replay protection
 * – JWT signing / verification / revocation
 * – verifyJwtMiddleware Express integration
 * – requireNonce Express integration
 */

import { jest } from '@jest/globals';

// ─── Mock redis service ────────────────────────────────────────────────────
const store = new Map();

jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (key) => store.get(key) ?? null),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key) => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
  },
}));

import {
  generateNonce,
  consumeNonce,
  signAccessToken,
  verifyAccessToken,
  revokeAccessToken,
  verifyJwtMiddleware,
  requireNonce,
} from '../src/middleware/challengeAuth.js';
import redisService from '../src/services/redisService.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function mockReq(overrides = {}) {
  return {
    headers: {},
    cookies: {},
    body: {},
    query: {},
    ...overrides,
  };
}

const TEST_PUBLIC_KEY = 'GAKEYTEST000000000000000000000000000000000000000000000000';

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

// ─── generateNonce ─────────────────────────────────────────────────────────

describe('generateNonce', () => {
  it('returns a non-empty string', async () => {
    const nonce = await generateNonce(TEST_PUBLIC_KEY);
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(20);
  });

  it('stores the nonce in Redis bound to the public key', async () => {
    const nonce = await generateNonce(TEST_PUBLIC_KEY);
    expect(redisService.set).toHaveBeenCalledWith(
      expect.stringContaining(nonce),
      TEST_PUBLIC_KEY,
      expect.any(Number)
    );
  });

  it('generates unique nonces on each call', async () => {
    const n1 = await generateNonce(TEST_PUBLIC_KEY);
    const n2 = await generateNonce(TEST_PUBLIC_KEY);
    expect(n1).not.toBe(n2);
  });

  it('throws when publicKey is missing', async () => {
    await expect(generateNonce('')).rejects.toThrow(/publicKey is required/);
  });
});

// ─── consumeNonce ──────────────────────────────────────────────────────────

describe('consumeNonce', () => {
  it('succeeds on first use and removes pending entry', async () => {
    const nonce = await generateNonce(TEST_PUBLIC_KEY);
    await expect(consumeNonce(nonce, TEST_PUBLIC_KEY)).resolves.toBeUndefined();
    // Pending key should be gone
    const pendingKey = `nonce:pending:${nonce}`;
    expect(store.has(pendingKey)).toBe(false);
  });

  it('throws on replay (second use of same nonce)', async () => {
    const nonce = await generateNonce(TEST_PUBLIC_KEY);
    await consumeNonce(nonce, TEST_PUBLIC_KEY);
    await expect(consumeNonce(nonce, TEST_PUBLIC_KEY)).rejects.toThrow(
      /already been used/
    );
  });

  it('throws when nonce is expired / never issued', async () => {
    await expect(consumeNonce('nonexistent-nonce', TEST_PUBLIC_KEY)).rejects.toThrow(
      /not found or expired/
    );
  });

  it('throws when nonce is used for a different public key', async () => {
    const nonce = await generateNonce(TEST_PUBLIC_KEY);
    await expect(
      consumeNonce(nonce, 'GDIFFERENTKEY00000000000000000000000000000000000000000000')
    ).rejects.toThrow(/different public key/);
  });

  it('throws when either argument is missing', async () => {
    await expect(consumeNonce('', TEST_PUBLIC_KEY)).rejects.toThrow(
      /nonce and publicKey/
    );
    await expect(consumeNonce('abc', '')).rejects.toThrow(
      /nonce and publicKey/
    );
  });
});

// ─── signAccessToken / verifyAccessToken ───────────────────────────────────

describe('signAccessToken / verifyAccessToken', () => {
  it('signs a token and verifies it successfully', async () => {
    const token = signAccessToken({ sub: TEST_PUBLIC_KEY });
    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe(TEST_PUBLIC_KEY);
    expect(payload.type).toBe('access');
    expect(payload.jti).toBeDefined();
  });

  it('includes role and permissions claims', async () => {
    const token = signAccessToken({
      sub: TEST_PUBLIC_KEY,
      role: 'admin',
      permissions: ['queue:write'],
    });
    const payload = await verifyAccessToken(token);
    expect(payload.role).toBe('admin');
    expect(payload.permissions).toContain('queue:write');
  });

  it('throws when sub is missing', () => {
    expect(() => signAccessToken({ role: 'user' })).toThrow(/sub claim/);
  });

  it('throws on tampered token', async () => {
    const token = signAccessToken({ sub: TEST_PUBLIC_KEY });
    const tampered = token.slice(0, -10) + 'TAMPERED00';
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it('throws when token is revoked', async () => {
    const token = signAccessToken({ sub: TEST_PUBLIC_KEY });
    const payload = await verifyAccessToken(token);
    await revokeAccessToken(payload.jti, payload.exp);
    await expect(verifyAccessToken(token)).rejects.toThrow(/revoked/);
  });
});

// ─── verifyJwtMiddleware ───────────────────────────────────────────────────

describe('verifyJwtMiddleware', () => {
  it('calls next() with req.user populated on valid Bearer token', async () => {
    const token = signAccessToken({ sub: TEST_PUBLIC_KEY });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    await verifyJwtMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.sub).toBe(TEST_PUBLIC_KEY);
    expect(req.user.publicKey).toBe(TEST_PUBLIC_KEY);
  });

  it('calls next() for valid cookie token', async () => {
    const token = signAccessToken({ sub: TEST_PUBLIC_KEY });
    const req = mockReq({ cookies: { accessToken: token } });
    const res = mockRes();
    const next = jest.fn();

    await verifyJwtMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 401 when no token is present', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await verifyJwtMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('missing token') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid / malformed token', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer not.a.jwt' } });
    const res = mockRes();
    const next = jest.fn();

    await verifyJwtMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── requireNonce ──────────────────────────────────────────────────────────

describe('requireNonce', () => {
  it('calls next() when a valid nonce is supplied in the header', async () => {
    const nonce = await generateNonce(TEST_PUBLIC_KEY);
    const req = mockReq({
      headers: { 'x-request-nonce': nonce },
      body: { publicKey: TEST_PUBLIC_KEY },
    });
    const res = mockRes();
    const next = jest.fn();

    await requireNonce(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.nonceVerified).toBe(true);
  });

  it('returns 400 when the nonce header is absent', async () => {
    const req = mockReq({ body: { publicKey: TEST_PUBLIC_KEY } });
    const res = mockRes();
    const next = jest.fn();

    await requireNonce(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('X-Request-Nonce') })
    );
  });

  it('returns 400 when publicKey / address is absent', async () => {
    const req = mockReq({ headers: { 'x-request-nonce': 'some-nonce' } });
    const res = mockRes();
    const next = jest.fn();

    await requireNonce(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 401 on nonce replay', async () => {
    const nonce = await generateNonce(TEST_PUBLIC_KEY);
    const req = () =>
      mockReq({
        headers: { 'x-request-nonce': nonce },
        body: { publicKey: TEST_PUBLIC_KEY },
      });

    // First use succeeds
    await requireNonce(req(), mockRes(), jest.fn());
    // Second use (replay)
    const res = mockRes();
    const next = jest.fn();
    await requireNonce(req(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
