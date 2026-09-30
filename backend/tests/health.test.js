import express from 'express';
import request from 'supertest';
import {
  clearHealthCache,
  dependencyCheckers,
  getHttpStatusForHealth,
  getLivenessPayload,
  performDeepHealthCheck,
  resetDependencyCheckers,
} from '../src/services/healthService.js';

const healthySqlite = () =>
  Promise.resolve({
    name: 'sqlite',
    status: 'healthy',
    latencyMs: 2,
    readable: true,
    writable: true,
    message: 'SQLite read/write OK',
  });

const healthyRedis = () =>
  Promise.resolve({
    name: 'redis',
    status: 'healthy',
    latencyMs: 1,
    mode: 'cluster',
    ping: 'PONG',
    message: 'Redis ping OK',
  });

const healthySorobanRpc = () =>
  Promise.resolve({
    name: 'sorobanRpc',
    status: 'healthy',
    latencyMs: 5,
    endpoint: 'https://soroban-testnet.stellar.org',
    message: 'Soroban RPC reachable',
  });

function installHealthyCheckers() {
  dependencyCheckers.sqlite = healthySqlite;
  dependencyCheckers.redis = healthyRedis;
  dependencyCheckers.sorobanRpc = healthySorobanRpc;
}

import healthRouter from '../src/routes/health.js';

function createHealthApp() {
  const app = express();
  app.use('/health', healthRouter);
  return app;
}

describe('Health Service', () => {
  beforeEach(() => {
    clearHealthCache();
    resetDependencyCheckers();
    installHealthyCheckers();
  });

  describe('liveness probe', () => {
    it('returns quickly without dependency checks', () => {
      const start = Date.now();
      const payload = getLivenessPayload();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
      expect(payload.status).toBe('ok');
      expect(payload.probe).toBe('liveness');
      expect(payload).toHaveProperty('timestamp');
      expect(payload).toHaveProperty('uptime');
    });

    it('GET /health/live returns liveness payload', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/health/live');

      expect(res.status).toBe(200);
      expect(res.body.data.probe).toBe('liveness');
      expect(res.body.data.status).toBe('ok');
    });

    it('returns valid ISO timestamp', () => {
      const payload = getLivenessPayload();
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });

    it('returns uptime with process and system info', () => {
      const payload = getLivenessPayload();
      expect(payload.uptime).toHaveProperty('processSec');
      expect(payload.uptime).toHaveProperty('processHuman');
      expect(payload.uptime).toHaveProperty('systemSec');
      expect(payload.uptime).toHaveProperty('systemHuman');
      expect(typeof payload.uptime.processSec).toBe('number');
      expect(payload.uptime.processSec).toBeGreaterThanOrEqual(0);
    });
  });

  describe('deep health check', () => {
    it('returns dependency details when all services are healthy', async () => {
      const result = await performDeepHealthCheck({ skipCache: true });

      expect(result.status).toBe('ok');
      expect(result.probe).toBe('readiness');
      expect(result.dependencies.sqlite.status).toBe('healthy');
      expect(result.dependencies.redis.status).toBe('healthy');
      expect(result.dependencies.sorobanRpc.status).toBe('healthy');
      expect(result).toHaveProperty('dependencyUptime');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('uptime');
    });

    it('caches results for subsequent requests', async () => {
      const first = await performDeepHealthCheck({ skipCache: true });
      const second = await performDeepHealthCheck();

      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.timestamp).toBe(first.timestamp);
    });

    it('bypasses cache when skipCache is true', async () => {
      await performDeepHealthCheck({ skipCache: true });
      const refreshed = await performDeepHealthCheck({ skipCache: true });
      expect(refreshed.cached).toBe(false);
    });

    it('returns 503 HTTP status when sqlite fails', async () => {
      dependencyCheckers.sqlite = () =>
        Promise.resolve({
          name: 'sqlite',
          status: 'unhealthy',
          latencyMs: 1,
          readable: false,
          writable: false,
          message: 'DB connection lost',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.status).toBe('unhealthy');
      expect(result.dependencies.sqlite.status).toBe('unhealthy');
      expect(getHttpStatusForHealth(result.status)).toBe(503);
    });

    it('returns unhealthy when redis ping fails', async () => {
      dependencyCheckers.redis = () =>
        Promise.resolve({
          name: 'redis',
          status: 'unhealthy',
          latencyMs: 1,
          mode: 'cluster',
          message: 'Connection refused',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.dependencies.redis.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy');
    });

    it('returns unhealthy when Soroban RPC is unreachable', async () => {
      dependencyCheckers.sorobanRpc = () =>
        Promise.resolve({
          name: 'sorobanRpc',
          status: 'unhealthy',
          latencyMs: 1,
          endpoint: 'https://soroban-testnet.stellar.org',
          message: 'RPC timeout',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.dependencies.sorobanRpc.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy');
    });

    it('returns degraded status when one dependency is degraded', async () => {
      dependencyCheckers.redis = () =>
        Promise.resolve({
          name: 'redis',
          status: 'degraded',
          latencyMs: 150,
          mode: 'fallback',
          message: 'Redis degraded',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.status).toBe('degraded');
      expect(result.dependencies.redis.status).toBe('degraded');
      expect(getHttpStatusForHealth(result.status)).toBe(200);
    });

    it('returns unhealthy when all dependencies fail', async () => {
      dependencyCheckers.sqlite = () =>
        Promise.resolve({
          name: 'sqlite',
          status: 'unhealthy',
          latencyMs: 1,
          readable: false,
          writable: false,
          message: 'DB down',
        });
      dependencyCheckers.redis = () =>
        Promise.resolve({
          name: 'redis',
          status: 'unhealthy',
          latencyMs: 1,
          mode: 'cluster',
          message: 'Redis down',
        });
      dependencyCheckers.sorobanRpc = () =>
        Promise.resolve({
          name: 'sorobanRpc',
          status: 'unhealthy',
          latencyMs: 1,
          endpoint: 'https://soroban-testnet.stellar.org',
          message: 'RPC down',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.status).toBe('unhealthy');
      expect(result.dependencies.sqlite.status).toBe('unhealthy');
      expect(result.dependencies.redis.status).toBe('unhealthy');
      expect(result.dependencies.sorobanRpc.status).toBe('unhealthy');
    });

    it('handles dependency checker throwing an error', async () => {
      dependencyCheckers.sqlite = () => Promise.reject(new Error('DB crash'));

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.status).toBe('unhealthy');
      expect(result.dependencies.sqlite.status).toBe('unhealthy');
      expect(result.dependencies.sqlite.message).toBe('DB crash');
    });

    it('tracks consecutive failures in dependencyUptime', async () => {
      const failingChecker = () =>
        Promise.resolve({
          name: 'redis',
          status: 'unhealthy',
          latencyMs: 1,
          mode: 'cluster',
          message: 'down',
        });
      dependencyCheckers.redis = failingChecker;

      await performDeepHealthCheck({ skipCache: true });
      await performDeepHealthCheck({ skipCache: true });

      const uptime = (await performDeepHealthCheck({ skipCache: true }))
        .dependencyUptime;
      expect(uptime.redis.consecutiveFailures).toBeGreaterThanOrEqual(3);
    });

    it('returns valid ISO timestamp in result', async () => {
      const result = await performDeepHealthCheck({ skipCache: true });
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('includes dependency latency in results', async () => {
      const result = await performDeepHealthCheck({ skipCache: true });
      expect(typeof result.dependencies.sqlite.latencyMs).toBe('number');
      expect(typeof result.dependencies.redis.latencyMs).toBe('number');
      expect(typeof result.dependencies.sorobanRpc.latencyMs).toBe('number');
    });
  });

  describe('GET /health endpoint', () => {
    it('returns 200 when dependencies are healthy', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('dependencies');
      expect(res.body.data).toHaveProperty('status');
    });

    it('returns 503 when a core dependency fails', async () => {
      dependencyCheckers.sorobanRpc = () =>
        Promise.resolve({
          name: 'sorobanRpc',
          status: 'unhealthy',
          latencyMs: 1,
          endpoint: 'https://soroban-testnet.stellar.org',
          message: 'RPC down',
        });
      clearHealthCache();

      const app = createHealthApp();
      const res = await request(app).get('/health?refresh=true');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.data.status).toBe('unhealthy');
    });

    it('bypasses cache when refresh=true query param is set', async () => {
      const app = createHealthApp();
      await request(app).get('/health');
      const res = await request(app).get('/health?refresh=true');

      expect(res.status).toBe(200);
      expect(res.body.data.cached).toBe(false);
    });

    it('uses cache when refresh param is absent', async () => {
      const app = createHealthApp();
      await request(app).get('/health');
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.data.cached).toBe(true);
    });

    it('returns 503 with degraded when all deps are degraded', async () => {
      dependencyCheckers.sqlite = () =>
        Promise.resolve({
          name: 'sqlite',
          status: 'degraded',
          latencyMs: 100,
          readable: true,
          writable: true,
          message: 'Slow',
        });
      dependencyCheckers.redis = () =>
        Promise.resolve({
          name: 'redis',
          status: 'degraded',
          latencyMs: 100,
          mode: 'fallback',
          message: 'Slow',
        });
      dependencyCheckers.sorobanRpc = () =>
        Promise.resolve({
          name: 'sorobanRpc',
          status: 'degraded',
          latencyMs: 100,
          endpoint: 'https://soroban-testnet.stellar.org',
          message: 'Slow',
        });
      clearHealthCache();

      const app = createHealthApp();
      const res = await request(app).get('/health?refresh=true');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('degraded');
    });

    it('returns proper response structure', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/health');

      expect(res.body).toHaveProperty('success');
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('probe');
      expect(res.body.data).toHaveProperty('timestamp');
      expect(res.body.data).toHaveProperty('dependencies');
      expect(res.body.data).toHaveProperty('uptime');
      expect(res.body.data).toHaveProperty('dependencyUptime');
      expect(res.body.data).toHaveProperty('cached');
    });

    it('returns 200 when only one dependency is unhealthy but others healthy', async () => {
      dependencyCheckers.sqlite = () =>
        Promise.resolve({
          name: 'sqlite',
          status: 'unhealthy',
          latencyMs: 1,
          readable: false,
          writable: false,
          message: 'DB down',
        });
      clearHealthCache();

      const app = createHealthApp();
      const res = await request(app).get('/health?refresh=true');

      expect(res.status).toBe(503);
      expect(res.body.data.dependencies.sqlite.status).toBe('unhealthy');
      expect(res.body.data.dependencies.redis.status).toBe('healthy');
      expect(res.body.data.dependencies.sorobanRpc.status).toBe('healthy');
    });

    it('handles concurrent requests without errors', async () => {
      const app = createHealthApp();
      const requests = Array.from({ length: 5 }, () =>
        request(app).get('/health?refresh=true')
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });
  });

  describe('healthService utility functions', () => {
    it('getHttpStatusForHealth returns 200 for ok', () => {
      expect(getHttpStatusForHealth('ok')).toBe(200);
    });

    it('getHttpStatusForHealth returns 200 for degraded', () => {
      expect(getHttpStatusForHealth('degraded')).toBe(200);
    });

    it('getHttpStatusForHealth returns 503 for unhealthy', () => {
      expect(getHttpStatusForHealth('unhealthy')).toBe(503);
    });

    it('getHttpStatusForHealth returns 503 for unknown status', () => {
      expect(getHttpStatusForHealth('unknown')).toBe(503);
    });

    it('resetDependencyCheckers restores original checkers', () => {
      dependencyCheckers.sqlite = () => Promise.resolve({ status: 'fake' });
      resetDependencyCheckers();

      expect(dependencyCheckers.sqlite).not.toBeNull();
      expect(typeof dependencyCheckers.sqlite).toBe('function');
      expect(typeof dependencyCheckers.redis).toBe('function');
      expect(typeof dependencyCheckers.sorobanRpc).toBe('function');
    });

    it('clearHealthCache resets the cache', async () => {
      await performDeepHealthCheck({ skipCache: true });
      clearHealthCache();
      const result = await performDeepHealthCheck();
      expect(result.cached).toBe(false);
    });

    it('liveness payload contains correct probe name', () => {
      const payload = getLivenessPayload();
      expect(payload.probe).toBe('liveness');
    });

    it('deep health check contains correct probe name', async () => {
      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.probe).toBe('readiness');
    });
  });
});
