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

/**
 * POST /api/rpc/simulate
 * Pre-flight simulation engine endpoint (#FE-EPIC-18).
 *
 * Runs a contract simulation against the active RPC endpoint and returns a
 * detailed breakdown of CPU instructions, RAM footprint, ledger entry
 * read/write counts, and fee estimates.
 *
 * Body:
 *   { contractId: string,
 *     method: string,
 *     args?: Array<unknown>,
 *     sourceAccount?: string,
 *     fee?: string,
 *     netword?: string }
 */
router.post(
  '/simulate',
  asyncHandler(async (req, res) => {
    const { contractId, method, args = [], sourceAccount, fee, network } = req.body || {};

    if (!contractId || typeof contractId !== 'string') {
      return res.status(400).json({ success: false, error: 'contractId is required' });
    }
    if (!method || typeof method !== 'string') {
      return res.status(400).json({ success: false, error: 'method is required' });
    }
    if (!Array.isArray(args)) {
      return res.status(400).json({ success: false, error: 'args must be an array' });
    }

    const result = await sorobanRpcManager.simulateContractCall({
      contractId,
      method,
      args,
      sourceAccount,
      fee,
      network,
    });

    return res.json({ success: true, ...result });
  })
);

export default router;
