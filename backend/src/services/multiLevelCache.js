// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { LRUCache } from 'lru-cache';
import redisService from './redisService.js';

const L1_TTL_MS = 30_000;
const L1_MAX = 1000;
const L2_TTL_S = 300;
const SCAN_COUNT = 100;

export class MultiLevelCache {
  /**
   * @param {object} opts
   * @param {number} [opts.l1TtlMs]  - L1 (in-memory) TTL in milliseconds
   * @param {number} [opts.maxL1]    - Maximum entries in L1
   * @param {number} [opts.l2TtlS]   - L2 (Redis) TTL in seconds
   */
  constructor(opts = {}) {
    this.l1TtlMs = opts.l1TtlMs ?? L1_TTL_MS;
    this.l1 = new LRUCache({ max: opts.maxL1 ?? L1_MAX, ttl: this.l1TtlMs });
    this.l2TtlS = opts.l2TtlS ?? L2_TTL_S;
    this.inflight = new Map();
  }

  /**
   * Retrieve a value by key, falling through L1 → L2 → fetchFn.
   * Concurrent requests for the same key are deduplicated (stampede protection).
   *
   * @param {string} key
   * @param {function(): Promise<*>} fetchFn - called on cache miss
   * @returns {Promise<*>}
   */
  async get(key, fetchFn) {
    const l1Val = this.l1.get(key);
    if (l1Val !== undefined) return l1Val;

    const l2Raw = await redisService.get(key);
    if (l2Raw !== null) {
      const parsed = this.#safeParse(l2Raw);
      this.l1.set(key, parsed, { ttl: this.#resolveL1Ttl(key) });
      return parsed;
    }

    if (this.inflight.has(key)) return this.inflight.get(key);

    const promise = fetchFn()
      .then((value) => {
        if (value !== undefined && value !== null) {
          this.l1.set(key, value);
          redisService.set(key, JSON.stringify(value), this.l2TtlS);
        }
        return value;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Check whether a key exists in either L1 or L2.
   * Does not call fetchFn or populate caches.
   *
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    if (this.l1.has(key)) return true;
    const l2Val = await redisService.get(key);
    return l2Val !== null;
  }

  /**
   * Return the number of entries in L1.
   * Note: this does not include L2 (Redis) entries.
   */
  get size() {
    return this.l1.size;
  }

  async invalidate(key) {
    this.l1.delete(key);
    await redisService.delete(key);
  }

  async invalidatePattern(prefix) {
    for (const k of this.l1.keys()) {
      if (k.startsWith(prefix)) this.l1.delete(k);
    }
    // Use cursor-based SCAN — never KEYS (O(N), blocks Redis event loop)
    if (!redisService.isFallbackMode && redisService.client) {
      let cursor = '0';
      do {
        const [next, keys] = await redisService.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          SCAN_COUNT
        );
        cursor = next;
        if (keys.length) await redisService.client.del(...keys);
      } while (cursor !== '0');
    }
  }

  clear() {
    this.l1.clear();
    this.inflight.clear();
  }

  /**
   * Parse a raw Redis value, falling back to the raw string on failure.
   */
  #safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Resolve the L1 TTL by capping it to the remaining L2 TTL
   * so we don't re-fetch L2 unnecessarily.
   */
  async #resolveL1Ttl(key) {
    let l1Ttl = this.l1TtlMs;
    if (!redisService.isFallbackMode && redisService.client) {
      try {
        const remainingS = await redisService.client.ttl(key);
        if (remainingS > 0) {
          l1Ttl = Math.min(this.l1TtlMs, remainingS * 1000);
        }
      } catch {
        // best-effort — fall back to default L1 TTL
      }
    }
    return l1Ttl;
  }
}

export const multiLevelCache = new MultiLevelCache();
export default multiLevelCache;
