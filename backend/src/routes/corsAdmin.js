// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { z } from 'zod';
import {
  listOrigins,
  addOrigin,
  removeOrigin,
} from '../services/corsWhitelistService.js';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validation.js';

const router = express.Router();

// Scheme + host (+ optional single-label wildcard subdomain) + optional port.
// No path, query or credentials, and never a bare `*`.
const ORIGIN_RE =
  /^https?:\/\/(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:\d{1,5})?\/?$/;

const originSchema = z
  .string()
  .trim()
  .max(500)
  .regex(
    ORIGIN_RE,
    'origin must be a valid http(s) origin, optionally with a wildcard subdomain (https://*.example.com)'
  )
  .describe('Browser origin, e.g. https://app.example.com');

const TAGS = ['CORS Whitelist'];
const ADMIN_SECURITY = [{ bearerAuth: [] }];

// Every whitelist operation changes who may call the API from a browser, so
// the whole router is admin-only.
router.use(authenticate, requireRole('admin'));

router.get(
  '/',
  validateRequest(
    {},
    {
      summary: 'List active CORS origins',
      description:
        'Origins added at runtime. They are trusted in addition to CORS_ALLOWED_ORIGINS / FRONTEND_URL.',
      tags: TAGS,
      security: ADMIN_SECURITY,
    }
  ),
  asyncHandler(async (_req, res) => {
    const origins = await listOrigins();
    res.json({ success: true, data: origins });
  })
);

router.post(
  '/',
  validateRequest(
    {
      body: z.object({
        origin: originSchema,
        added_by: z
          .string()
          .trim()
          .max(255)
          .optional()
          .describe('Free-form note on who requested the origin'),
      }),
    },
    {
      summary: 'Whitelist a CORS origin',
      description: 'Takes effect immediately without a restart.',
      tags: TAGS,
      security: ADMIN_SECURITY,
      responses: { 201: { description: 'Origin added (or re-activated)' } },
    }
  ),
  asyncHandler(async (req, res) => {
    const { origin, added_by } = req.body;
    const entry = await addOrigin(origin, added_by ?? req.user?.publicKey);
    res.status(201).json({ success: true, data: entry });
  })
);

router.delete(
  '/:origin',
  validateRequest(
    {
      params: z.object({
        origin: originSchema.describe('URL-encoded origin to remove'),
      }),
    },
    {
      summary: 'Remove a CORS origin',
      tags: TAGS,
      security: ADMIN_SECURITY,
      responses: {
        200: { description: 'Origin removed' },
        404: { description: 'Origin not in whitelist' },
      },
    }
  ),
  asyncHandler(async (req, res) => {
    const { origin } = req.params;
    const removed = await removeOrigin(origin);
    if (!removed) {
      throw createHttpError(404, `Origin '${origin}' not found in whitelist`);
    }
    res.json({ success: true, message: `Origin '${origin}' removed` });
  })
);

export default router;
