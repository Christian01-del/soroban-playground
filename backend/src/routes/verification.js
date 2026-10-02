// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import verifyService from '../services/verifyService.js';

const router = express.Router();

router.post(
  '/contracts',
  rateLimitMiddleware('global'),
  validate('submitVerification'),
  asyncHandler(async (req, res) => {
    const result = await verifyService.submitVerification(req.body || {});
    return res.status(result.status === 'verified' ? 200 : 202).json({
      success: result.verified,
      data: result,
    });
  })
);

router.get(
  '/contracts/search',
  asyncHandler(async (req, res) => {
    const result = await verifyService.searchVerifications(req.query || {});
    return res.json({ success: true, data: result });
  })
);

router.get(
  '/contracts/:id/source',
  validate('contractIdParam', 'params'),
  asyncHandler(async (req, res) => {
    const result = await verifyService.getSource(req.params.id);
    return res.json({ success: true, data: result });
  })
);

router.post(
  '/contracts/:id/reverify',
  rateLimitMiddleware('global'),
  validate('contractIdParam', 'params'),
  asyncHandler(async (req, res) => {
    const result = await verifyService.reverifyContract(
      req.params.id,
      req.body || {}
    );
    return res.status(result.status === 'verified' ? 200 : 202).json({
      success: result.verified,
      data: result,
    });
  })
);

router.get(
  '/contracts/:id',
  validate('contractIdParam', 'params'),
  asyncHandler(async (req, res) => {
    const result = await verifyService.getVerification(req.params.id);
    return res.json({ success: true, data: result });
  })
);

router.post(
  '/contracts/:id/verify-expert',
  rateLimitMiddleware('global'),
  validate('contractIdParam', 'params'),
  asyncHandler(async (req, res) => {
    const result = await verifyService.submitToStellarExpert(
      req.params.id,
      req.body || {}
    );
    return res.status(result.status === 'verified' ? 200 : 202).json({
      success: result.verified,
      data: result,
    });
  })
);

export default router;
