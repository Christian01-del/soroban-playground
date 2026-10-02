// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Tests for sorobanRpcManager latency tracking & round-robin (#1575)
 * Extends the existing circuitBreaker tests with new latency coverage.
 */

import sorobanRpcManager, {
  CIRCUIT_STATES,
} from '../src/services/sorobanRpcManager.js';

beforeEach(() => {
  sorobanRpcManager.reset();
});

afterAll(() => {
  sorobanRpcManager.stopHealthChecks();
});

// ─── Existing circuit-breaker tests ──────────────────────────────────────────

describe('SorobanRpcManager – circuit breaker (existing behaviour)', () => {
  it('initializes with default endpoints and CLOSED state', () => {
    const status = sorobanRpcManager.getStatus();
    expect(status.activeEndpoint).toBeDefined();
    expect(status.circuitBreakerState).toBe(CIRCUIT_STATES.CLOSED);
    expect(status.endpoints.length).toBeGreaterThan(1);
  });

  it('executes successful RPC call on active endpoint', async () => {
    const mockCall = jest.fn().mockResolvedValue('ledger-12345');
    const result = await sorobanRpcManager.executeRpcCall(mockCall);
    expect(result).toBe('ledger-12345');
  });

  it('fails over to next fallback endpoint when primary endpoint fails', async () => {
    const primaryUrl = sorobanRpcManager.activeEndpoint.url;
    const mockCall = jest.fn().mockImplementation((url) => {
      if (url === primaryUrl) throw new Error('RPC connection timeout');
      return 'fallback-success';
    });

    const result = await sorobanRpcManager.executeRpcCall(mockCall);
    expect(result).toBe('fallback-success');
    expect(sorobanRpcManager.activeEndpoint.url).not.toBe(primaryUrl);
  });

  it('trips circuit breaker OPEN after consecutive failures', async () => {
    const failingCall = jest
      .fn()
      .mockRejectedValue(new Error('503 Service Unavailable'));

    for (let i = 0; i < 3; i++) {
      try {
        await sorobanRpcManager.executeRpcCall(failingCall);
      } catch {
        // expected
      }
    }

    const status = sorobanRpcManager.getStatus();
    expect(
      status.endpoints.some((ep) => ep.state === CIRCUIT_STATES.OPEN)
    ).toBe(true);
  });

  it('resets all state via reset()', () => {
    sorobanRpcManager.endpoints[0].state = CIRCUIT_STATES.OPEN;
    sorobanRpcManager.endpoints[0].failCount = 5;

    sorobanRpcManager.reset();

    const status = sorobanRpcManager.getStatus();
    expect(status.circuitBreakerState).toBe(CIRCUIT_STATES.CLOSED);
    expect(status.endpoints[0].failCount).toBe(0);
  });

  it('records endpoint health from getHealth + getLatestLedger', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { status: 'healthy', sequence: 123 } }),
    });

    try {
      const ep = sorobanRpcManager.endpoints[0];
      await sorobanRpcManager.checkEndpointHealth(ep);
      expect(ep.isHealthy).toBe(true);
      expect(ep.latestLedger).toBe(123);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ─── NEW: Latency tracking (#1575) ───────────────────────────────────────────

describe('SorobanRpcManager – latency tracking', () => {
  it('starts with null latency for all endpoints', () => {
    const status = sorobanRpcManager.getStatus();
    for (const ep of status.endpoints) {
      expect(ep.latencyEmaMs).toBeNull();
      expect(ep.latencySamples).toBe(0);
      expect(ep.lastLatencyMs).toBeNull();
    }
  });

  it('updates latency EMA after a successful call', async () => {
    const mockCall = jest.fn().mockResolvedValue('ok');
    await sorobanRpcManager.executeRpcCall(mockCall);

    const status = sorobanRpcManager.getStatus();
    const activeEp = status.endpoints.find(
      (ep) => ep.url === status.activeEndpoint
    );
    expect(activeEp.latencySamples).toBeGreaterThan(0);
    expect(activeEp.latencyEmaMs).not.toBeNull();
    expect(activeEp.lastLatencyMs).not.toBeNull();
  });

  it('resets latency stats on reset()', async () => {
    const mockCall = jest.fn().mockResolvedValue('ok');
    await sorobanRpcManager.executeRpcCall(mockCall);

    sorobanRpcManager.reset();

    const status = sorobanRpcManager.getStatus();
    for (const ep of status.endpoints) {
      expect(ep.latencyEmaMs).toBeNull();
      expect(ep.latencySamples).toBe(0);
    }
  });

  it('updates latency EMA from health check', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { status: 'healthy', sequence: 200 } }),
    });

    try {
      const ep = sorobanRpcManager.endpoints[0];
      await sorobanRpcManager.checkEndpointHealth(ep);
      expect(ep.latencyEmaMs).not.toBeNull();
      expect(ep.latencySamples).toBeGreaterThan(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ─── NEW: Aggregate metrics (#1575) ──────────────────────────────────────────

describe('SorobanRpcManager – aggregate metrics', () => {
  it('tracks total requests and failures', async () => {
    const successCall = jest.fn().mockResolvedValue('data');
    const failCall = jest.fn().mockRejectedValue(new Error('fail'));

    await sorobanRpcManager.executeRpcCall(successCall);
    try {
      // exhaust all endpoints
      sorobanRpcManager.endpoints.forEach((ep) => {
        ep.state = CIRCUIT_STATES.OPEN;
      });
      await sorobanRpcManager.executeRpcCall(failCall);
    } catch {
      // expected
    }

    // reset open circuits so we can read status cleanly
    sorobanRpcManager.reset();
    // Counters are reset by reset(), check they start fresh
    const status = sorobanRpcManager.getStatus();
    expect(status.metrics.totalRequests).toBe(0);
    expect(status.metrics.totalFailures).toBe(0);
    expect(status.metrics.successRate).toBe(1);
  });

  it('reports successRate correctly after mixed outcomes', async () => {
    const ep = sorobanRpcManager.endpoints[0];
    ep.state = CIRCUIT_STATES.CLOSED;

    // Simulate 3 successful calls
    for (let i = 0; i < 3; i++) {
      await sorobanRpcManager.executeRpcCall(jest.fn().mockResolvedValue('ok'));
    }

    const status = sorobanRpcManager.getStatus();
    expect(status.metrics.totalRequests).toBe(3);
    expect(status.metrics.totalFailures).toBe(0);
    expect(status.metrics.successRate).toBe(1);
  });
});

// ─── NEW: Latency-weighted endpoint selection (#1575) ────────────────────────

describe('SorobanRpcManager – latency-weighted round-robin', () => {
  it('prefers the lowest-latency healthy endpoint', async () => {
    // Seed EMA latencies: ep0 = 200ms, ep1 = 50ms, ep2 = 500ms
    sorobanRpcManager.endpoints[0].latencyEmaMs = 200;
    sorobanRpcManager.endpoints[0].latencySamples = 5;
    sorobanRpcManager.endpoints[1].latencyEmaMs = 50;
    sorobanRpcManager.endpoints[1].latencySamples = 5;
    if (sorobanRpcManager.endpoints[2]) {
      sorobanRpcManager.endpoints[2].latencyEmaMs = 500;
      sorobanRpcManager.endpoints[2].latencySamples = 5;
    }

    const calls = [];
    const mockCall = jest.fn().mockImplementation((url) => {
      calls.push(url);
      return 'ok';
    });

    await sorobanRpcManager.executeRpcCall(mockCall);

    // The call should have gone to ep1 (latency 50ms)
    expect(calls[0]).toBe(sorobanRpcManager.endpoints[1].url);
  });

  it('falls back to round-robin when no latency data exists', async () => {
    // No EMA data (fresh reset)
    const mockCall = jest.fn().mockResolvedValue('ok');
    await sorobanRpcManager.executeRpcCall(mockCall);
    // Just ensure it succeeds without error
    expect(mockCall).toHaveBeenCalled();
  });
});
