// Gateway router exposing pure readiness decision rules (#1289, #1491).
import express from 'express';
import { computeReadinessStatus } from './readinessRules.js';

const router = express.Router();

/**
 * POST /api/readiness
 * Body: { postgres, redis, sorobanRpc?, workerQueue? } each with { status }
 * Returns the pure decision result used by the live readiness probe.
 */
router.post('/', (req, res) => {
  const deps = req.body || {};
  const result = computeReadinessStatus(deps);
  res.status(result.httpStatus).json({
    success: true,
    data: result,
  });
});

/** GET /api/readiness/rules — schema documentation for operators. */
router.get('/rules', (_req, res) => {
  res.json({
    success: true,
    data: {
      critical: ['postgres', 'redis'],
      optional: ['sorobanRpc', 'workerQueue'],
      unhealthyWhen: 'any critical dependency status !== healthy',
      degradedWhen: 'optional dependency is unhealthy or degraded',
    },
  });
});

export default router;
