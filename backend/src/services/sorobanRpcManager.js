import config from '../config/index.js';
import { createSpan, getTraceId } from '../utils/tracing.js';
import { validateInvocationAuth } from '../utils/invocationAuth.js';
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

// Latency tracking: EMA (exponential moving average) smoothing factor.
// A value closer to 1 reacts quickly; closer to 0 smooths out spikes.
const LATENCY_EMA_ALPHA = 0.25;

// ─── Custom Invocation Authorization Matrix (require_auth) ───────────────────
// In-browser test simulations may inject arbitrary invoker addresses, mock
// signatures, and custom authorization trees. The mock engine below evaluates
// a require_auth matrix locally so simulations do not hit the network.
const AUTH_MATRIX_MAX_DEPTH = Number.parseInt(
  process.env.AUTH_MATRIX_MAX_DEPTH || '8',
  10
);

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

// ─── Mock require_auth engine ────────────────────────────────────────────────

/**
 * Normalize a single authorization entry from the injected matrix.
 * Accepts either a string invoker address or an object describing the
 * required auth tree node.
 */
function normalizeAuthEntry(entry) {
  if (typeof entry === 'string') {
    return { invoker: entry, signature: null, subInvocations: [] };
  }
  if (!entry || typeof entry !== 'object') return null;
  return {
    invoker: entry.invoker ?? entry.address ?? null,
    signature: entry.signature ?? entry.mockSignature ?? null,
    contractId: entry.contractId ?? entry.contract ?? null,
    fnName: entry.fnName ?? entry.fn ?? null,
    subInvocations: Array.isArray(entry.subInvocations)
      ? entry.subInvocations
      : Array.isArray(entry.sub_invocations)
        ? entry.sub_invocations
        : [],
  };
}

/**
 * Recursively evaluate an authorization tree against the injected context.
 * Returns { authorized, reason, matched } describing the outcome.
 */
function evaluateAuthNode(node, context, depth = 0) {
  if (depth > AUTH_MATRIX_MAX_DEPTH) {
    return { authorized: false, reason: 'AUTH_MATRIX_MAX_DEPTH_EXCEEDED' };
  }
  const normalized = normalizeAuthEntry(node);
  if (!normalized) {
    return { authorized: false, reason: 'INVALID_AUTH_ENTRY' };
  }

  const { invoker, signature, contractId, fnName, subInvocations } = normalized;
  const allowedInvokers = context.invokers || [];
  const allowedSignatures = context.signatures || [];

  if (!invoker) {
    return { authorized: false, reason: 'MISSING_INVOKER' };
  }
  if (allowedInvokers.length > 0 && !allowedInvokers.includes(invoker)) {
    return { authorized: false, reason: 'INVOKER_NOT_AUTHORIZED', invoker };
  }
  if (contractId && context.contractId && contractId !== context.contractId) {
    return { authorized: false, reason: 'CONTRACT_MISMATCH', contractId };
  }
  if (fnName && context.fnName && fnName !== context.fnName) {
    return { authorized: false, reason: 'FN_MISMATCH', fnName };
  }
  if (signature) {
    if (allowedSignatures.length > 0 && !allowedSignatures.includes(signature)) {
      return { authorized: false, reason: 'SIGNATURE_NOT_AUTHORIZED', signature };
    }
    if (context.requireSignature && !allowedSignatures.includes(signature)) {
      return { authorized: false, reason: 'SIGNATURE_REQUIRED', signature };
    }
  } else if (context.requireSignature) {
    return { authorized: false, reason: 'SIGNATURE_REQUIRED' };
  }

  for (const child of subInvocations) {
    const childResult = evaluateAuthNode(child, context, depth + 1);
    if (!childResult.authorized) return childResult;
  }

  return { authorized: true, reason: 'AUTHORIZED', invoker };
}

/**
 * Build a mock authorization matrix from an injected simulation payload.
 * The payload shape mirrors what the Playground UI sends from the browser:
 *   { invokers: [...], signatures: [...], tree: {...}, requireSignature: bool }
 */
function buildMockAuthMatrix(payload = {}) {
  const invokers = Array.isArray(payload.invokers)
    ? payload.invokers.filter((v) => typeof v === 'string')
    : [];
  const signatures = Array.isArray(payload.signatures)
    ? payload.signatures.filter((v) => typeof v === 'string')
    : [];
  const tree = payload.tree ?? payload.authTree ?? null;
  const requireSignature = Boolean(payload.requireSignature);
  return { invokers, signatures, tree, requireSignature };
}

/**
 * Evaluate a custom invocation authorization matrix locally.
 * Returns a structured result suitable for surfacing in the simulation UI.
 */
function evaluateInvocationAuth(payload = {}) {
  const matrix = buildMockAuthMatrix(payload);
  const context = {
    invokers: matrix.invokers,
    signatures: matrix.signatures,
    contractId: payload.contractId ?? null,
    fnName: payload.fnName ?? null,
    requireSignature: matrix.requireSignature,
  };

  if (!matrix.tree) {
    // No explicit tree: fall back to flat invoker/signature checks.
    if (matrix.invokers.length === 0) {
      return { authorized: false, reason: 'NO_INVOKERS_PROVIDED' };
    }
    if (matrix.requireSignature && matrix.signatures.length === 0) {
      return { authorized: false, reason: 'SIGNATURE_REQUIRED' };
    }
    return { authorized: true, reason: 'AUTHORIZED_FLAT' };
  }

  return evaluateAuthNode(matrix.tree, context);
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
    // Mock authorization matrix state for in-browser simulations
    this._authMatrix = null;

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

  /**
   * Inject a custom invocation authorization matrix for simulations.
   * Validates the payload schema before persisting it on the manager.
   */
  setAuthMatrix(payload = {}) {
    const validation = validateInvocationAuth(payload);
    if (!validation.valid) {
      throw new Error(
        `Invalid invocation auth matrix: ${validation.errors.join(', ')}`
      );
    }
    this._authMatrix = buildMockAuthMatrix(payload);
    return this._authMatrix;
  }

  /**
   * Evaluate the currently injected authorization matrix (or a one-off
   * payload) without performing any network calls.
   */
  evaluateAuth(payload = null) {
    const source = payload ?? this._authMatrix ?? {};
    return evaluateInvocationAuth(source);
  }

  clearAuthMatrix() {
    this._authMatrix = null;
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
    this._authMatrix = null;
  }
}

export const sorobanRpcManager = new SorobanRpcManager();
export { evaluateInvocationAuth, buildMockAuthMatrix, evaluateAuthNode };
export default sorobanRpcManager;
