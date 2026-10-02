// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * RPC Router status endpoints (#1575)
 *
 * Exposes the current state of the round-robin / circuit-breaker RPC manager,
 * including per-endpoint latency tracking.
 */

import express from 'express';
import sorobanRpcManager from '../services/sorobanRpcManager.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/rpc/status
 * Returns active endpoint, circuit-breaker states, latency EMA and aggregate metrics.
 */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = sorobanRpcManager.getStatus();
    return res.json({ success: true, ...status });
  })
);

/**
 * POST /api/rpc/reset
 * (Admin only) Reset all circuit breakers and latency statistics.
 */
router.post(
  '/reset',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    sorobanRpcManager.reset();
    return res.json({ success: true, message: 'RPC manager state reset' });
  })
);

export default router;
