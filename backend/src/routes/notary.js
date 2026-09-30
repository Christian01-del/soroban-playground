// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { notaryRateLimiter } from '../middleware/notaryRateLimiter.js';
import {
  notarizeFile,
  verifyFile,
  revokeNotarization,
  listNotarizations,
  validateFileHash,
  NotaryError,
} from '../services/notaryService.js';

const router = express.Router();

const FILE_HASH_PARAM_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * POST /api/notary/notarize
 * Body: { fileHash: string, metadata: string, callerAddress?: string }
 */
router.post(
  '/notarize',
  notaryRateLimiter,
  asyncHandler(async (req, res) => {
    const { fileHash, metadata, callerAddress = 'anonymous' } = req.body;

    if (!fileHash || typeof fileHash !== 'string') {
      throw createHttpError(400, 'fileHash is required and must be a string');
    }
    if (!metadata || typeof metadata !== 'string') {
      throw createHttpError(400, 'metadata is required and must be a string');
    }

    const result = await notarizeFile(fileHash, metadata, callerAddress);
    res.status(201).json({ success: true, data: result });
  })
);

/**
 * GET /api/notary/verify/:fileHash
 */
router.get(
  '/verify/:fileHash',
  asyncHandler(async (req, res) => {
    const { fileHash } = req.params;
    if (!FILE_HASH_PARAM_REGEX.test(fileHash)) {
      throw createHttpError(400, 'Invalid fileHash', [
        'fileHash must be a 64-char hex string',
      ]);
    }
    const record = await verifyFile(fileHash);
    res.json({ success: true, data: record });
  })
);

/**
 * DELETE /api/notary/revoke/:fileHash
 * Body: { callerAddress: string }
 */
router.delete(
  '/revoke/:fileHash',
  asyncHandler(async (req, res) => {
    const { fileHash } = req.params;
    if (!FILE_HASH_PARAM_REGEX.test(fileHash)) {
      throw createHttpError(400, 'Invalid fileHash', [
        'fileHash must be a 64-char hex string',
      ]);
    }
    const { callerAddress } = req.body ?? {};
    if (!callerAddress) {
      throw createHttpError(400, 'callerAddress is required');
    }
    await revokeNotarization(fileHash, callerAddress);
    res.json({ success: true });
  })
);

/**
 * GET /api/notary/history?page=1&limit=20
 */
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20)
    );
    const result = await listNotarizations(page, limit);
    res.json({ success: true, data: result });
  })
);

export default router;
