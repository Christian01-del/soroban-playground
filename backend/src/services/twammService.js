// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * TwammService – in-memory simulation of the TWAMM Soroban contract.
 *
 * Mirrors the contract's logic so the frontend can interact with a realistic
 * simulation before deploying to testnet.
 *
 * Key behaviours replicated:
 * - Constant-product AMM with configurable fee.
 * - Piecewise-linear virtual order execution (one-sided linear approximation).
 * - Lazy evaluation: pool state only updated when a method is called.
 * - Order cancellation with proportional refund of unexecuted balance.
 */

const SCALE = 1_000_000_000_000_000_000n; // 1e18 BigInt fixed-point

const DEFAULT_ADMIN =
  process.env.TWAMM_ADMIN_ADDRESS ||
  'GTWAMMADMIN0000000000000000000000000000000000000000000000';

function nowIso() {
  return new Date().toISOString();
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** BigInt integer square-root via Newton's method. */
function isqrt(n) {
  if (n <= 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Fixed-point multiply: (a * b) / SCALE */
function fpMul(a, b) {
  return (a * b) / SCALE;
}

/** Fixed-point divide: (a * SCALE) / b */
function fpDiv(a, b) {
  if (b === 0n) return 0n;
  return (a * SCALE) / b;
}

/** Fixed-point sqrt: sqrt(a) where a is in fixed-point. */
function fpSqrt(a) {
  if (a <= 0n) return 0n;
  return isqrt(a * SCALE);
}

/**
 * Advance pool virtual orders by `delta` ledgers.
 * Modelled as one-sided linear settlement where both rates contribute
 * to constant-product updates independently (accurate for small Δt).
 */
function applyVirtualOrders(pool, toLedger) {
  const currentLedger = toLedger ?? pool.lastUpdatedLedger;
  const delta = BigInt(currentLedger - pool.lastUpdatedLedger);

  if (delta <= 0n || (pool.aggRateA === 0n && pool.aggRateB === 0n)) {
    pool.lastUpdatedLedger = currentLedger;
    return;
  }

  let x = BigInt(pool.reserveA) * SCALE;
  let y = BigInt(pool.reserveB) * SCALE;

  // A→B virtual sell
  if (pool.aggRateA > 0n) {
    const soldA = pool.aggRateA * delta; // fp
    const newX = x + soldA;
    const k = fpMul(x, y);
    const newY = fpDiv(k, newX);
    x = newX;
    y = newY;
  }

  // B→A virtual sell
  if (pool.aggRateB > 0n) {
    const soldB = pool.aggRateB * delta; // fp
    const newY = y + soldB;
    const k = fpMul(x, y);
    const newX = fpDiv(k, newY);
    x = newX;
    y = newY;
  }

  pool.reserveA = Number(x / SCALE) || 1;
  pool.reserveB = Number(y / SCALE) || 1;
  pool.lastUpdatedLedger = currentLedger;
}

/** Recompute aggregate rates from active orders. */
function recomputeRates(pool, orders, currentLedger) {
  let ra = 0n;
  let rb = 0n;
  for (const o of orders) {
    if (o.status === 'Active' && o.endLedger > currentLedger) {
      if (o.sellA) {
        ra += BigInt(o.ratePerLedger);
      } else {
        rb += BigInt(o.ratePerLedger);
      }
    }
  }
  pool.aggRateA = ra;
  pool.aggRateB = rb;
}

class TwammService {
  constructor() {
    this.reset();
  }

  reset() {
    this.pool = null;
    this.orders = [];
    this.orderSeq = 0;
    this.currentLedger = 1000; // simulated ledger counter
    this.admin = DEFAULT_ADMIN;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _assertInitialized() {
    if (!this.pool) throw new Error('Pool not initialized');
  }

  _assertNotPaused() {
    if (this.pool.paused) throw new Error('Pool is paused');
  }

  _touch() {
    // Advance simulated ledger by 1 on every interaction (demo behaviour).
    this.currentLedger += 1;
  }

  _settle() {
    applyVirtualOrders(this.pool, this.currentLedger);
    // Mark expired orders.
    for (const o of this.orders) {
      if (o.status === 'Active' && o.endLedger <= this.currentLedger) {
        o.executedAmount = o.totalAmount;
        o.status = 'Completed';
      }
    }
    recomputeRates(this.pool, this.orders, this.currentLedger);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialize the AMM pool.
   * @param {string} admin
   * @param {number} initialA
   * @param {number} initialB
   * @param {number} feeBps
   */
  initialize(admin, initialA, initialB, feeBps = 30) {
    if (this.pool) throw new Error('Already initialized');
    if (initialA <= 0 || initialB <= 0) throw new Error('Invalid amounts');
    if (feeBps > 1000) throw new Error('Fee too high (max 1000 bps)');
    this.admin = admin;
    this.pool = {
      reserveA: initialA,
      reserveB: initialB,
      feeBps,
      admin,
      lastUpdatedLedger: this.currentLedger,
      aggRateA: 0n,
      aggRateB: 0n,
      paused: false,
      createdAt: nowIso(),
    };
    return clone(this._serializePool());
  }

  /**
   * Instant constant-product swap.
   * @param {string} caller
   * @param {boolean} sellA
   * @param {number} amountIn
   * @param {number} minOut
   */
  swap(caller, sellA, amountIn, minOut = 0) {
    this._assertInitialized();
    this._assertNotPaused();
    if (amountIn <= 0) throw new Error('Invalid amount');
    this._touch();
    this._settle();

    const { reserveA, reserveB, feeBps } = this.pool;
    const fee = Math.floor((amountIn * feeBps) / 10_000);
    const effectiveIn = amountIn - fee;

    let amountOut;
    if (sellA) {
      amountOut = Math.floor((reserveB * effectiveIn) / (reserveA + effectiveIn));
      this.pool.reserveA += effectiveIn;
      this.pool.reserveB -= amountOut;
    } else {
      amountOut = Math.floor((reserveA * effectiveIn) / (reserveB + effectiveIn));
      this.pool.reserveB += effectiveIn;
      this.pool.reserveA -= amountOut;
    }

    if (amountOut < minOut) throw new Error('Insufficient output: slippage exceeded');
    if (this.pool.reserveA <= 0 || this.pool.reserveB <= 0)
      throw new Error('Insufficient liquidity');

    return {
      amountIn,
      amountOut,
      fee,
      sellA,
      caller,
      reserveA: this.pool.reserveA,
      reserveB: this.pool.reserveB,
      timestamp: nowIso(),
    };
  }

  /**
   * Add liquidity to the pool.
   */
  addLiquidity(provider, amountA, amountB) {
    this._assertInitialized();
    this._assertNotPaused();
    if (amountA <= 0 || amountB <= 0) throw new Error('Invalid amounts');
    this._touch();
    this._settle();
    this.pool.reserveA += amountA;
    this.pool.reserveB += amountB;
    const lpMinted = Math.floor(Math.sqrt(amountA * amountB));
    return { provider, amountA, amountB, lpMinted, timestamp: nowIso() };
  }

  /**
   * Submit a new TWAMM order.
   * @param {string} owner
   * @param {boolean} sellA
   * @param {number} amount      Total tokens to sell
   * @param {number} durationLedgers
   */
  submitOrder(owner, sellA, amount, durationLedgers) {
    this._assertInitialized();
    this._assertNotPaused();
    if (amount <= 0) throw new Error('Invalid amount');
    if (durationLedgers <= 0) throw new Error('Invalid duration');
    this._touch();
    this._settle();

    const startLedger = this.currentLedger;
    const endLedger = startLedger + durationLedgers;

    // Fixed-point rate per ledger (stored as BigInt for precision but serialised as string).
    const ratePerLedger = Number(
      fpDiv(BigInt(amount) * SCALE, BigInt(durationLedgers) * SCALE),
    );

    this.orderSeq += 1;
    const order = {
      id: this.orderSeq,
      owner,
      sellA,
      totalAmount: amount,
      executedAmount: 0,
      ratePerLedger,
      startLedger,
      endLedger,
      durationLedgers,
      status: 'Active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.orders.push(order);

    // Increment aggregate rate.
    if (sellA) {
      this.pool.aggRateA += BigInt(ratePerLedger);
    } else {
      this.pool.aggRateB += BigInt(ratePerLedger);
    }

    return clone(order);
  }

  /**
   * Cancel an active TWAMM order and compute a proportional refund.
   * @param {string} caller
   * @param {number} orderId
   */
  cancelOrder(caller, orderId) {
    this._assertInitialized();
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) throw new Error('Order not found');
    if (order.owner !== caller) throw new Error('Unauthorized');
    if (order.status !== 'Active') throw new Error('Order is not active');

    this._touch();
    this._settle();

    const remainingLedgers = Math.max(0, order.endLedger - this.currentLedger);
    const duration = order.durationLedgers;
    const refund =
      duration > 0
        ? Math.floor((order.totalAmount * remainingLedgers) / duration)
        : 0;

    order.executedAmount = order.totalAmount - refund;
    order.status = 'Cancelled';
    order.updatedAt = nowIso();

    // Recompute aggregate rates.
    recomputeRates(this.pool, this.orders, this.currentLedger);

    return { orderId, refund, executedAmount: order.executedAmount, status: 'Cancelled' };
  }

  /**
   * Settle (mark as completed) all expired orders.
   */
  settleExpired() {
    this._assertInitialized();
    this._touch();
    this._settle();
    const settled = this.orders.filter((o) => o.status === 'Completed').length;
    return { settled, currentLedger: this.currentLedger };
  }

  // ── Read-only ──────────────────────────────────────────────────────────────

  getPool() {
    this._assertInitialized();
    return clone(this._serializePool());
  }

  getOrder(orderId) {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) throw new Error('Order not found');
    return clone(order);
  }

  listOrders(status) {
    const list = status
      ? this.orders.filter((o) => o.status === status)
      : this.orders;
    return list.map((o) => clone(o));
  }

  spotPrice() {
    this._assertInitialized();
    return this.pool.reserveB / this.pool.reserveA;
  }

  getDashboard() {
    this._assertInitialized();
    const activeOrders = this.orders.filter((o) => o.status === 'Active');
    const completedOrders = this.orders.filter((o) => o.status === 'Completed');
    const cancelledOrders = this.orders.filter((o) => o.status === 'Cancelled');
    const totalVolumeA = this.orders
      .filter((o) => o.sellA)
      .reduce((s, o) => s + o.executedAmount, 0);
    const totalVolumeB = this.orders
      .filter((o) => !o.sellA)
      .reduce((s, o) => s + o.executedAmount, 0);

    return {
      pool: this._serializePool(),
      metrics: {
        totalOrders: this.orders.length,
        activeOrders: activeOrders.length,
        completedOrders: completedOrders.length,
        cancelledOrders: cancelledOrders.length,
        totalVolumeA,
        totalVolumeB,
        spotPrice: this.pool ? this.spotPrice() : null,
        currentLedger: this.currentLedger,
      },
      recentOrders: this.orders.slice(-10).reverse().map((o) => clone(o)),
    };
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  setPaused(admin, paused) {
    this._assertInitialized();
    if (admin !== this.pool.admin && admin !== this.admin)
      throw new Error('Unauthorized');
    this.pool.paused = paused;
    return { paused };
  }

  setFee(admin, feeBps) {
    this._assertInitialized();
    if (admin !== this.pool.admin && admin !== this.admin)
      throw new Error('Unauthorized');
    if (feeBps > 1000) throw new Error('Fee too high (max 1000 bps)');
    this.pool.feeBps = feeBps;
    return { feeBps };
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  _serializePool() {
    if (!this.pool) return null;
    return {
      ...this.pool,
      aggRateA: this.pool.aggRateA.toString(),
      aggRateB: this.pool.aggRateB.toString(),
    };
  }
}

export default new TwammService();
