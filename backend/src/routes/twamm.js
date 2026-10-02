// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import twammService from '../services/twammService.js';

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actorFrom(req) {
  const h = req.headers['x-actor-address'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (typeof req.body?.actor === 'string' && req.body.actor.trim())
    return req.body.actor.trim();
  return '';
}

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function ok(res, data, message = 'Success', status = 200) {
  return res.status(status).json({ success: true, status: 'success', message, data });
}

function fail(res, statusCode, message, details) {
  return res.status(statusCode).json({
    success: false,
    status: 'error',
    message,
    ...(details ? { details } : {}),
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/twamm
 * Dashboard overview: pool state, metrics, recent orders.
 */
router.get('/', (_req, res) => {
  try {
    const dashboard = twammService.getDashboard();
    return ok(res, dashboard, 'TWAMM dashboard loaded');
  } catch (err) {
    return fail(res, 503, err.message);
  }
});

/**
 * GET /api/twamm/health
 */
router.get('/health', (_req, res) => {
  let poolState = null;
  try {
    poolState = twammService.getPool();
  } catch {
    // not initialized
  }
  return ok(res, {
    status: 'ok',
    initialized: !!poolState,
    paused: poolState?.paused ?? null,
    currentLedger: twammService.currentLedger,
    timestamp: new Date().toISOString(),
    service: 'soroban-playground-twamm',
  });
});

/**
 * POST /api/twamm/initialize
 * Body: { admin?, initialA, initialB, feeBps? }
 */
router.post('/initialize', (req, res) => {
  const actor = actorFrom(req);
  const errors = [];
  if (!isPositiveNumber(req.body?.initialA)) errors.push('initialA must be a positive number');
  if (!isPositiveNumber(req.body?.initialB)) errors.push('initialB must be a positive number');
  if (
    req.body?.feeBps !== undefined &&
    (!Number.isInteger(req.body.feeBps) || req.body.feeBps < 0 || req.body.feeBps > 1000)
  ) {
    errors.push('feeBps must be an integer 0-1000');
  }
  if (errors.length) return fail(res, 400, 'Validation failed', errors);

  try {
    const adminAddr = actor || req.body?.admin || twammService.admin;
    const pool = twammService.initialize(
      adminAddr,
      req.body.initialA,
      req.body.initialB,
      req.body.feeBps ?? 30,
    );
    return ok(res, pool, 'Pool initialized', 201);
  } catch (err) {
    return fail(res, 409, err.message);
  }
});

/**
 * GET /api/twamm/pool
 * Returns current pool state.
 */
router.get('/pool', (_req, res) => {
  try {
    return ok(res, twammService.getPool(), 'Pool state loaded');
  } catch (err) {
    return fail(res, 503, err.message);
  }
});

/**
 * GET /api/twamm/pool/price
 * Returns current spot price of A in B.
 */
router.get('/pool/price', (_req, res) => {
  try {
    const price = twammService.spotPrice();
    return ok(res, { spotPrice: price }, 'Spot price fetched');
  } catch (err) {
    return fail(res, 503, err.message);
  }
});

/**
 * POST /api/twamm/pool/swap
 * Body: { sellA, amountIn, minOut? }
 */
router.post('/pool/swap', (req, res) => {
  const actor = actorFrom(req);
  const errors = [];
  if (!actor) errors.push('actor is required');
  if (typeof req.body?.sellA !== 'boolean') errors.push('sellA must be a boolean');
  if (!isPositiveNumber(req.body?.amountIn)) errors.push('amountIn must be a positive number');
  if (errors.length) return fail(res, 400, 'Validation failed', errors);

  try {
    const result = twammService.swap(
      actor,
      req.body.sellA,
      req.body.amountIn,
      req.body.minOut ?? 0,
    );
    return ok(res, result, 'Swap executed');
  } catch (err) {
    return fail(res, 400, err.message);
  }
});

/**
 * POST /api/twamm/pool/liquidity
 * Body: { amountA, amountB }
 */
router.post('/pool/liquidity', (req, res) => {
  const actor = actorFrom(req);
  const errors = [];
  if (!actor) errors.push('actor is required');
  if (!isPositiveNumber(req.body?.amountA)) errors.push('amountA must be a positive number');
  if (!isPositiveNumber(req.body?.amountB)) errors.push('amountB must be a positive number');
  if (errors.length) return fail(res, 400, 'Validation failed', errors);

  try {
    const result = twammService.addLiquidity(actor, req.body.amountA, req.body.amountB);
    return ok(res, result, 'Liquidity added', 201);
  } catch (err) {
    return fail(res, 400, err.message);
  }
});

/**
 * GET /api/twamm/orders
 * Query: ?status=Active|Completed|Cancelled
 */
router.get('/orders', (req, res) => {
  try {
    const { status } = req.query;
    const orders = twammService.listOrders(status || null);
    return ok(res, { orders, count: orders.length }, 'Orders loaded');
  } catch (err) {
    return fail(res, 503, err.message);
  }
});

/**
 * GET /api/twamm/orders/:id
 */
router.get('/orders/:id', (req, res) => {
  try {
    const order = twammService.getOrder(Number(req.params.id));
    return ok(res, order, 'Order loaded');
  } catch (err) {
    return fail(res, 404, err.message);
  }
});

/**
 * POST /api/twamm/orders
 * Submit a new TWAMM virtual order.
 * Body: { sellA, amount, durationLedgers }
 */
router.post('/orders', (req, res) => {
  const actor = actorFrom(req);
  const errors = [];
  if (!actor) errors.push('actor is required');
  if (typeof req.body?.sellA !== 'boolean') errors.push('sellA must be a boolean');
  if (!isPositiveNumber(req.body?.amount)) errors.push('amount must be a positive number');
  if (
    !Number.isInteger(req.body?.durationLedgers) ||
    req.body.durationLedgers <= 0
  ) {
    errors.push('durationLedgers must be a positive integer');
  }
  if (errors.length) return fail(res, 400, 'Validation failed', errors);

  try {
    const order = twammService.submitOrder(
      actor,
      req.body.sellA,
      req.body.amount,
      req.body.durationLedgers,
    );
    return ok(res, order, 'TWAMM order submitted', 201);
  } catch (err) {
    return fail(res, 400, err.message);
  }
});

/**
 * DELETE /api/twamm/orders/:id
 * Cancel an active order and receive a proportional refund.
 */
router.delete('/orders/:id', (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return fail(res, 400, 'Validation failed', ['actor is required']);

  try {
    const result = twammService.cancelOrder(actor, Number(req.params.id));
    return ok(res, result, 'Order cancelled and refund computed');
  } catch (err) {
    const code =
      err.message === 'Unauthorized'
        ? 403
        : err.message === 'Order not found'
          ? 404
          : 400;
    return fail(res, code, err.message);
  }
});

/**
 * POST /api/twamm/orders/settle
 * Settle all expired orders and advance pool state.
 */
router.post('/orders/settle', (_req, res) => {
  try {
    const result = twammService.settleExpired();
    return ok(res, result, `Settled ${result.settled} expired orders`);
  } catch (err) {
    return fail(res, 503, err.message);
  }
});

/**
 * POST /api/twamm/admin/pause
 * Body: { paused: boolean }
 */
router.post('/admin/pause', (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return fail(res, 400, 'Validation failed', ['actor is required']);
  if (typeof req.body?.paused !== 'boolean')
    return fail(res, 400, 'Validation failed', ['paused must be a boolean']);

  try {
    const result = twammService.setPaused(actor, req.body.paused);
    const msg = result.paused ? 'Pool paused' : 'Pool unpaused';
    return ok(res, result, msg);
  } catch (err) {
    return fail(res, err.message === 'Unauthorized' ? 403 : 400, err.message);
  }
});

/**
 * POST /api/twamm/admin/fee
 * Body: { feeBps }
 */
router.post('/admin/fee', (req, res) => {
  const actor = actorFrom(req);
  const errors = [];
  if (!actor) errors.push('actor is required');
  if (!Number.isInteger(req.body?.feeBps) || req.body.feeBps < 0 || req.body.feeBps > 1000)
    errors.push('feeBps must be an integer 0-1000');
  if (errors.length) return fail(res, 400, 'Validation failed', errors);

  try {
    const result = twammService.setFee(actor, req.body.feeBps);
    return ok(res, result, 'Fee updated');
  } catch (err) {
    return fail(res, err.message === 'Unauthorized' ? 403 : 400, err.message);
  }
});

export default router;
