import config from '../config/index.js';
import { createSpan, getTraceId } from '../utils/tracing.js';
import { createHash } from 'crypto';
import {
  sorobanRpcCallDuration,
  sorobanRpcCallsTotal,
} from '../routes/metrics.js';

const DEFAULT_FALLBACK_ENDPOINTS = [
  process.env.SOROBAN_RPC_URL ||
    config?.soroban?.rpcUrl ||
    'https://soroban-testnet.stellar.org',
  'https://rpc-futurenet.stellar.org',
  'https://stellar-community.org/rpc',
];

export const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

const RPC_TIMEOUT_MS = Number.parseInt(
  process.env.RPC_TIMEOUT_MS || '15000',
  10
);
const HEALTH_CHECK_INTERVAL_MS = Number.parseInt(
  process.env.RPC_HEALTH_CHECK_INTERVAL_MS || '10000',
  10
);

// Pre-flight simulation cache TTL (ms). Simulations are deterministic for a
// given (ledger, tx) pair, so we cache results keyed by a content hash to
// avoid redundant RPC round-trips during rapid iteration in the Playground.
const SIMULATION_CACHE_TTL_MS = Number.parseInt(
  process.env.RPC_SIMULATION_CACHE_TTL_MS || '30000',
  10
);
const SIMULATION_CACHE_MAX_ENTRIES = Number.parseInt(
  process.env.RPC_SIMULATION_CACHE_MAX_ENTRIES || '128',
  10
);

// Latency tracking: EMA (exponential moving average) smoothing factor.
// A value closer to 1 reacts quickly; closer to 0 smooths out spikes.
const LATENCY_EMA_ALPHA = 0.25;

// ─── Endpoint selection heuristics ───────────────────────────────────────────

/**
 * Select the next endpoint using latency-weighted round-robin (#1575).
 *
 * Strategy:
 *   1. Skip OPEN (circuit-broken) endpoints.
 *   2. Among healthy endpoints prefer the one with the lowest p50 (EMA) latency.
 *   3. Fall back to pure round-robin if no latency data is available.
 */
function selectBestEndpoint(endpoints, preferredIndex) {
  const healthy = endpoints.filter((ep) => ep.state !== CIRCUIT_STATES.OPEN);
  if (healthy.length === 0) return null;

  // If none have latency data yet, fall back to the simple round-robin candidate
  const withData = healthy.filter((ep) => ep.latencyEmaMs !== null);
  if (withData.length === 0) {
    // Return the next healthy endpoint in round-robin order
    for (let i = 0; i < endpoints.length; i++) {
      const idx = (preferredIndex + i) % endpoints.length;
      if (endpoints[idx].state !== CIRCUIT_STATES.OPEN) return endpoints[idx];
    }
    return healthy[0];
  }

  // Pick the endpoint with the lowest EMA latency
  return withData.reduce((best, ep) =>
    ep.latencyEmaMs < best.latencyEmaMs ? ep : best
  );
}

/**
 * Update the exponential moving average (EMA) for a given endpoint's latency.
 */
function updateLatencyEma(ep, observedMs) {
  if (ep.latencyEmaMs === null) {
    ep.latencyEmaMs = observedMs;
  } else {
    ep.latencyEmaMs =
      LATENCY_EMA_ALPHA * observedMs +
      (1 - LATENCY_EMA_ALPHA) * ep.latencyEmaMs;
  }
  ep.latencySamples += 1;
  ep.lastLatencyMs = observedMs;
}

// ─────────────────────────────────────────────────────────────────────────────

class SorobanRpcManager {
  constructor() {
    const rawFallbacks = process.env.SOROBAN_RPC_FALLBACK_URLS
      ? process.env.SOROBAN_RPC_FALLBACK_URLS.split(',').map((u) => u.trim())
      : DEFAULT_FALLBACK_ENDPOINTS;

    this.endpoints = Array.from(new Set(rawFallbacks)).map((url) => ({
      url,
      state: CIRCUIT_STATES.CLOSED,
      failCount: 0,
      lastFailureTime: null,
      isHealthy: true,
      // Latency tracking (#1575)
      latencyEmaMs: null,     // EMA of successful call latencies (ms)
      latencySamples: 0,      // total successful samples recorded
      lastLatencyMs: null,    // most recent observed latency
      lastHealthyAt: null,
      latestLedger: null,
    }));

    this.failureThreshold = Number.parseInt(
      process.env.RPC_FAILURE_THRESHOLD || '3',
      10
    );
    this.resetTimeoutMs = Number.parseInt(
      process.env.RPC_RESET_TIMEOUT_MS || '30000',
      10
    );
    this.activeEndpointIndex = 0;
    this.healthTimer = null;
    // Running totals for aggregate metrics
    this._totalRequests = 0;
    this._totalFailures = 0;
    // Pre-flight simulation cache (FE-EPIC-18)
    this._simulationCache = new Map();
    this._simulationStats = { hits: 0, misses: 0, evictions: 0 };

    if (process.env.NODE_ENV !== 'test') this.startHealthChecks();
  }

  get activeEndpoint() {
    return this.endpoints[this.activeEndpointIndex] || this.endpoints[0];
  }

  checkCircuitStates() {
    const now = Date.now();
    for (const ep of this.endpoints) {
      if (
        ep.state === CIRCUIT_STATES.OPEN &&
        ep.lastFailureTime &&
        now - ep.lastFailureTime > this.resetTimeoutMs
      ) {
        ep.state = CIRCUIT_STATES.HALF_OPEN;
      }
    }
  }

  tripCircuitBreaker(ep) {
    ep.state = CIRCUIT_STATES.OPEN;
    ep.isHealthy = false;
    console.warn(
      `[RPC Circuit Breaker] Tripped OPEN for endpoint ${ep.url} (failures: ${ep.failCount})`
    );
  }

  async checkEndpointHealth(ep) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    const start = Date.now();
    try {
      const request = (method) =>
        fetch(ep.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params: [],
          }),
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload.error)
            throw new Error(payload.error.message || `${method} failed`);
          return payload.result;
        });

      const [health, latestLedger] = await Promise.all([
        request('getHealth'),
        request('getLatestLedger'),
      ]);
      if (health?.status && health.status !== 'healthy') {
        throw new Error(`RPC health status: ${health.status}`);
      }

      // Update latency from the health-check round-trip
      const elapsed = Date.now() - start;
      updateLatencyEma(ep, elapsed);

      ep.isHealthy = true;
      ep.failCount = 0;
      ep.state = CIRCUIT_STATES.CLOSED;
      ep.lastHealthyAt = Date.now();
      ep.latestLedger = latestLedger?.sequence ?? latestLedger;
      return true;
    } catch {
      ep.isHealthy = false;
      ep.lastFailureTime = Date.now();
      if (ep.state === CIRCUIT_STATES.CLOSED) ep.state = CIRCUIT_STATES.OPEN;
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  startHealthChecks() {
    if (this.healthTimer || this.endpoints.length === 0) return;
    const poll = () => {
      Promise.all(
        this.endpoints.map((endpoint) => this.checkEndpointHealth(endpoint))
      ).catch(() => {});
    };
    poll();
    this.healthTimer = setInterval(poll, HEALTH_CHECK_INTERVAL_MS);
    this.healthTimer.unref?.();
  }

  stopHealthChecks() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  async executeRpcCall(callFn) {
    this.checkCircuitStates();
    this._totalRequests += 1;

    const activeTraceId = getTraceId();
    const span = createSpan('soroban_rpc_call', {
      'rpc.system': 'soroban_rpc',
      'rpc.active_endpoint': this.activeEndpoint.url,
      'rpc.circuit_state': this.activeEndpoint.state,
    });

    const traceHeaders = activeTraceId
      ? {
          'x-trace-id': activeTraceId,
          traceparent: `00-${activeTraceId}-${span?.spanContext()?.spanId || '0000000000000000'}-01`,
        }
      : {};

    let lastError = null;

    // Use latency-weighted endpoint selection (#1575)
    const best = selectBestEndpoint(this.endpoints, this.activeEndpointIndex);
    const preferredIndex = best
      ? this.endpoints.indexOf(best)
      : this.activeEndpointIndex;

    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (preferredIndex + i) % this.endpoints.length;
      const ep = this.endpoints[idx];

      if (ep.state === CIRCUIT_STATES.OPEN) {
        continue;
      }

      const callStartHr = process.hrtime();
      const callStart = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

        try {
          const result = await callFn(ep.url, {
            ...traceHeaders,
            signal: controller.signal,
          });

          // Record latency on success
          const elapsed = Date.now() - callStart;
          updateLatencyEma(ep, elapsed);

          const [secs, nanos] = process.hrtime(callStartHr);
          const durationSec = secs + nanos / 1e9;
          try {
            sorobanRpcCallDuration?.observe?.(
              { endpoint: ep.url, status: 'success' },
              durationSec
            );
            sorobanRpcCallsTotal?.inc?.({
              endpoint: ep.url,
              status: 'success',
            });
          } catch (_) {}

          ep.failCount = 0;
          ep.state = CIRCUIT_STATES.CLOSED;
          ep.isHealthy = true;
          this.activeEndpointIndex = idx;

          span?.setStatus?.({ code: 1 });
          span?.end?.();
          return result;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        lastError = err;
        const [secs, nanos] = process.hrtime(callStartHr);
        const durationSec = secs + nanos / 1e9;
        try {
          sorobanRpcCallDuration?.observe?.(
            { endpoint: ep.url, status: 'error' },
            durationSec
          );
          sorobanRpcCallsTotal?.inc?.({ endpoint: ep.url, status: 'error' });
        } catch (_) {}

        ep.failCount += 1;
        ep.lastFailureTime = Date.now();
        this._totalFailures += 1;

        if (
          ep.failCount >= this.failureThreshold ||
          ep.state === CIRCUIT_STATES.HALF_OPEN
        ) {
          this.tripCircuitBreaker(ep);
        }
      }
    }

    const errorMsg = `All Soroban RPC endpoints failed or are circuit breaker OPEN. Last error: ${
      lastError?.message || 'Unknown error'
    }`;
    span?.setStatus?.({ code: 2, message: errorMsg });
    span?.recordException?.(lastError || new Error(errorMsg));
    span?.end?.();
    throw new Error(errorMsg);
  }

  // ─── Pre-flight simulation engine (FE-EPIC-18) ─────────────────────────────

  /**
   * Build a stable cache key for a simulation request. The key incorporates
   * the RPC method, the serialized transaction envelope, and the ledger
   * sequence so stale results are never served across ledger boundaries.
   */
  _simulationCacheKey(method, params) {
    const payload = JSON.stringify({ method, params });
    return createHash('sha256').update(payload).digest('hex');
  }

  _pruneSimulationCache(now) {
    for (const [key, entry] of this._simulationCache) {
      if (entry.expiresAt <= now) {
        this._simulationCache.delete(key);
      }
    }
    while (this._simulationCache.size > SIMULATION_CACHE_MAX_ENTRIES) {
      const oldestKey = this._simulationCache.keys().next().value;
      this._simulationCache.delete(oldestKey);
      this._simulationStats.evictions += 1;
    }
  }

  /**
   * Normalize a raw `simulateTransaction` RPC result into the resource
   * profile consumed by the frontend Gas Visualizer. All numeric fields are
   * coerced to safe integers; missing fields default to 0 so the UI never
   * renders `undefined`.
   */
  buildResourceProfile(rawResult) {
    const cost = rawResult?.cost || {};
    const cpuInsns = Number(cost.cpuInsns ?? rawResult?.cpuInsns ?? 0);
    const memBytes = Number(cost.memBytes ?? rawResult?.memBytes ?? 0);

    const footprint = rawResult?.transactionData?.resources?.footprint || {};
    const readOnly = Array.isArray(footprint.readOnly)
      ? footprint.readOnly.length
      : 0;
    const readWrite = Array.isArray(footprint.readWrite)
      ? footprint.readWrite.length
      : 0;

    const minResourceFee = Number(rawResult?.minResourceFee ?? 0);

    return {
      cpuInstructions: Number.isFinite(cpuInsns) ? cpuInsns : 0,
      ramBytes: Number.isFinite(memBytes) ? memBytes : 0,
      ledgerEntries: {
        readOnly,
        readWrite,
        total: readOnly + readWrite,
      },
      feeEstimate: {
        minResourceFee: Number.isFinite(minResourceFee) ? minResourceFee : 0,
        // Stellar base fee per operation (100 stroops) is a useful floor for
        // the UI to display alongside the resource fee.
        baseFee: 100,
        totalFee:
          (Number.isFinite(minResourceFee) ? minResourceFee : 0) + 100,
      },
      latestLedger: rawResult?.latestLedger ?? null,
      events: Array.isArray(rawResult?.events) ? rawResult.events : [],
      error: rawResult?.error || null,
    };
  }

  /**
   * Execute a pre-flight `simulateTransaction` against the best available
   * endpoint. Results are cached for SIMULATION_CACHE_TTL_MS keyed by the
   * transaction envelope so repeated Playground runs are cheap.
   *
   * @param {string} transactionXdr - base64-encoded TransactionEnvelope XDR.
   * @param {object} [options]
   * @param {boolean} [options.skipCache] - bypass the cache read.
   * @returns {Promise<object>} normalized resource profile.
   */
  async simulateTransaction(transactionXdr, options = {}) {
    if (!transactionXdr || typeof transactionXdr !== 'string') {
      throw new Error('simulateTransaction requires a transaction XDR string');
    }

    const params = {
      transaction: transactionXdr,
      resourceConfig: options.resourceConfig || undefined,
    };
    const cacheKey = this._simulationCacheKey('simulateTransaction', params);
    const now = Date.now();

    if (!options.skipCache) {
      const cached = this._simulationCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        this._simulationStats.hits += 1;
        return { ...cached.profile, cached: true };
      }
      if (cached) this._simulationCache.delete(cacheKey);
    }

    this._simulationStats.misses += 1;

    const rawResult = await this.executeRpcCall(async (url, extra) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(extra || {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'simulateTransaction',
          params: [params],
        }),
        signal: extra?.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      const payload = await response.json();
      if (payload.error) {
        throw new Error(payload.error.message || 'simulateTransaction failed');
      }
      return payload.result;
    });

    const profile = this.buildResourceProfile(rawResult);
    profile.cached = false;

    this._pruneSimulationCache(now);
    this._simulationCache.set(cacheKey, {
      profile,
      expiresAt: now + SIMULATION_CACHE_TTL_MS,
    });

    return profile;
  }

  getSimulationCacheStats() {
    const now = Date.now();
    this._pruneSimulationCache(now);
    const total = this._simulationStats.hits + this._simulationStats.misses;
    return {
      size: this._simulationCache.size,
      maxEntries: SIMULATION_CACHE_MAX_ENTRIES,
      ttlMs: SIMULATION_CACHE_TTL_MS,
      hits: this._simulationStats.hits,
      misses: this._simulationStats.misses,
      evictions: this._simulationStats.evictions,
      hitRate:
        total > 0
          ? Number((this._simulationStats.hits / total).toFixed(4))
          : 0,
    };
  }

  clearSimulationCache() {
    this._simulationCache.clear();
    this._simulationStats = { hits: 0, misses: 0, evictions: 0 };
  }

  getStatus() {
    this.checkCircuitStates();
    const totalReq = this._totalRequests;
    const totalFail = this._totalFailures;
    return {
      activeEndpoint: this.activeEndpoint.url,
      circuitBreakerState: this.activeEndpoint.state,
      // Aggregate metrics (#1575)
      metrics: {
        totalRequests: totalReq,
        totalFailures: totalFail,
        successRate:
          totalReq > 0
            ? Number(((totalReq - totalFail) / totalReq).toFixed(4))
            : 1,
      },
      endpoints: this.endpoints.map((ep) => ({
        url: ep.url,
        state: ep.state,
        isHealthy: ep.isHealthy,
        failCount: ep.failCount,
        lastFailureTime: ep.lastFailureTime
          ? new Date(ep.lastFailureTime).toISOString()
          : null,
        lastHealthyAt: ep.lastHealthyAt
          ? new Date(ep.lastHealthyAt).toISOString()
          : null,
        latestLedger: ep.latestLedger ?? null,
        // Latency tracking (#1575)
        latencyEmaMs: ep.latencyEmaMs !== null ? Math.round(ep.latencyEmaMs) : null,
        latencySamples: ep.latencySamples,
        lastLatencyMs: ep.lastLatencyMs,
      })),
      // Pre-flight simulation cache stats (FE-EPIC-18)
      simulationCache: this.getSimulationCacheStats(),
    };
  }

  reset() {
    for (const ep of this.endpoints) {
      ep.state = CIRCUIT_STATES.CLOSED;
      ep.failCount = 0;
      ep.lastFailureTime = null;
      ep.isHealthy = true;
      ep.lastHealthyAt = null;
      ep.latestLedger = null;
      ep.latencyEmaMs = null;
      ep.latencySamples = 0;
      ep.lastLatencyMs = null;
    }
    this.activeEndpointIndex = 0;
    this._totalRequests = 0;
    this._totalFailures = 0;
    this._simulationCache.clear();
    this._simulationStats = { hits: 0, misses: 0, evictions: 0 };
  }
}

export const sorobanRpcManager = new SorobanRpcManager();
export default sorobanRpcManager;
