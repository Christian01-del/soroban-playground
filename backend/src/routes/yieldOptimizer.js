/**
 * Yield Optimizer API
 *
 * Routes:
 *   POST   /yield-optimizer/initialize
 *   POST   /yield-optimizer/pause
 *   POST   /yield-optimizer/unpause
 *   POST   /yield-optimizer/strategies
 *   PATCH  /yield-optimizer/strategies/:id/apy
 *   PATCH  /yield-optimizer/strategies/:id/active
 *   GET    /yield-optimizer/strategies/:id
 *   GET    /yield-optimizer/strategies
 *   GET    /yield-optimizer/best-strategy
 *   POST   /yield-optimizer/deposit
 *   POST   /yield-optimizer/withdraw
 *   POST   /yield-optimizer/compound
 *   POST   /yield-optimizer/allocate
 *   GET    /yield-optimizer/backtest
 *   GET    /yield-optimizer/position
 *   GET    /yield-optimizer/status
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { invokeSorobanContract } from '../services/invokeService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;
const ADDRESS_RE = /^G[A-Z0-9]{55}$/;

function validateContractId(id) {
  return typeof id === 'string' && CONTRACT_ID_RE.test(id);
}
function validateAddress(addr) {
  return typeof addr === 'string' && ADDRESS_RE.test(addr);
}
function requireFields(body, fields) {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ''
  );
  return missing.length ? missing.map((f) => `${f} is required`) : null;
}
function getContractId(req) {
  const id = req.body?.contractId || req.query?.contractId;
  if (!validateContractId(id))
    throw createHttpError(400, 'Valid contractId required');
  return id;
}
async function invoke(contractId, fn, args, network) {
  return invokeSorobanContract({
    requestId: `yopt-${fn}-${Date.now()}`,
    contractId,
    functionName: fn,
    args: args || {},
    network: network || 'testnet',
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

router.post(
  '/initialize',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    const result = await invoke(contractId, 'initialize', { admin }, network);
    return res.json({ success: true, output: result.parsed });
  })
);

router.post(
  '/pause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    const result = await invoke(contractId, 'pause', { admin }, network);
    return res.json({
      success: true,
      message: 'Contract paused successfully',
      output: result.parsed,
    });
  })
);

router.post(
  '/unpause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    const result = await invoke(contractId, 'unpause', { admin }, network);
    return res.json({
      success: true,
      message: 'Contract unpaused successfully',
      output: result.parsed,
    });
  })
);

// ── Strategies ────────────────────────────────────────────────────────────────

router.post(
  '/strategies',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, name, apyBps, network } = req.body || {};
    const errs = requireFields(req.body, [
      'contractId',
      'admin',
      'name',
      'apyBps',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    if (typeof apyBps !== 'number' || apyBps < 0 || apyBps > 50000)
      return next(createHttpError(400, 'apyBps must be 0–50000'));
    const result = await invoke(
      contractId,
      'add_strategy',
      { admin, name, apy_bps: apyBps },
      network
    );
    return res.status(201).json({ success: true, strategyId: result.parsed });
  })
);

router.patch(
  '/strategies/:id/apy',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, apyBps, network } = req.body || {};
    const strategyId = Number(req.params.id);
    if (!Number.isInteger(strategyId) || strategyId < 1)
      return next(createHttpError(400, 'Invalid strategy id'));
    const errs = requireFields(req.body, ['contractId', 'admin', 'apyBps']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    if (typeof apyBps !== 'number' || apyBps < 0 || apyBps > 50000)
      return next(createHttpError(400, 'apyBps must be 0–50000'));
    const result = await invoke(
      contractId,
      'update_apy',
      { admin, strategy_id: strategyId, new_apy_bps: apyBps },
      network
    );
    return res.json({ success: true, output: result.parsed });
  })
);

router.patch(
  '/strategies/:id/active',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, active, network } = req.body || {};
    const strategyId = Number(req.params.id);
    if (!Number.isInteger(strategyId) || strategyId < 1)
      return next(createHttpError(400, 'Invalid strategy id'));
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    if (typeof active !== 'boolean')
      return next(createHttpError(400, 'active must be boolean'));
    const result = await invoke(
      contractId,
      'set_strategy_active',
      { admin, strategy_id: strategyId, active },
      network
    );
    return res.json({ success: true, output: result.parsed });
  })
);

router.get(
  '/strategies',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const result = await invoke(contractId, 'list_strategies', {}, network);
    return res.json({ success: true, strategyIds: result.parsed });
  })
);

router.get(
  '/strategies/:id',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const strategyId = Number(req.params.id);
    if (!Number.isInteger(strategyId) || strategyId < 1)
      return next(createHttpError(400, 'Invalid strategy id'));
    const { network } = req.query;
    const result = await invoke(
      contractId,
      'get_strategy',
      { strategy_id: strategyId },
      network
    );
    return res.json({ success: true, strategy: result.parsed });
  })
);

router.get(
  '/best-strategy',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const result = await invoke(contractId, 'best_strategy', {}, network);
    return res.json({ success: true, strategyId: result.parsed });
  })
);

// ── User actions ──────────────────────────────────────────────────────────────

router.post(
  '/deposit',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, user, strategyId, amount, network } = req.body || {};
    const errs = requireFields(req.body, [
      'contractId',
      'user',
      'strategyId',
      'amount',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(user))
      return next(createHttpError(400, 'Invalid user address'));
    if (typeof strategyId !== 'number' || strategyId < 1)
      return next(createHttpError(400, 'strategyId must be >= 1'));
    if (typeof amount !== 'number' || amount <= 0)
      return next(createHttpError(400, 'amount must be > 0'));
    const result = await invoke(
      contractId,
      'deposit',
      { user, strategy_id: strategyId, amount },
      network
    );
    return res.json({ success: true, output: result.parsed });
  })
);

router.post(
  '/withdraw',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, user, strategyId, amount, network } = req.body || {};
    const errs = requireFields(req.body, [
      'contractId',
      'user',
      'strategyId',
      'amount',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(user))
      return next(createHttpError(400, 'Invalid user address'));
    if (typeof strategyId !== 'number' || strategyId < 1)
      return next(createHttpError(400, 'strategyId must be >= 1'));
    if (typeof amount !== 'number' || amount <= 0)
      return next(createHttpError(400, 'amount must be > 0'));
    const result = await invoke(
      contractId,
      'withdraw',
      { user, strategy_id: strategyId, amount },
      network
    );
    return res.json({ success: true, withdrawn: result.parsed });
  })
);

router.post(
  '/compound',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, user, strategyId, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'user', 'strategyId']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(user))
      return next(createHttpError(400, 'Invalid user address'));
    if (typeof strategyId !== 'number' || strategyId < 1)
      return next(createHttpError(400, 'strategyId must be >= 1'));
    const result = await invoke(
      contractId,
      'compound',
      { user, strategy_id: strategyId },
      network
    );
    return res.json({ success: true, newBalance: result.parsed });
  })
);

// ── Portfolio allocation ───────────────────────────────────────────────────────

router.post(
  '/allocate',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, allocations, totalAmount, network } = req.body || {};
    const errs = requireFields(req.body, [
      'contractId',
      'allocations',
      'totalAmount',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!Array.isArray(allocations) || allocations.length === 0)
      return next(
        createHttpError(400, 'allocations must be a non-empty array')
      );
    for (const a of allocations) {
      if (typeof a.strategyId !== 'number' || typeof a.weightBps !== 'number')
        return next(
          createHttpError(400, 'Each allocation needs strategyId and weightBps')
        );
    }
    if (typeof totalAmount !== 'number' || totalAmount <= 0)
      return next(createHttpError(400, 'totalAmount must be > 0'));
    const mapped = allocations.map((a) => ({
      strategy_id: a.strategyId,
      weight_bps: a.weightBps,
    }));
    const result = await invoke(
      contractId,
      'allocate',
      { allocations: mapped, total_amount: totalAmount },
      network
    );
    return res.json({ success: true, amounts: result.parsed });
  })
);

// ── Backtest ──────────────────────────────────────────────────────────────────

router.get(
  '/backtest',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { strategyId, initialAmount, durationSecs, network } = req.query;
    const sid = Number(strategyId);
    const amt = Number(initialAmount);
    const dur = Number(durationSecs);
    if (!Number.isInteger(sid) || sid < 1)
      return next(createHttpError(400, 'strategyId must be >= 1'));
    if (!amt || amt <= 0)
      return next(createHttpError(400, 'initialAmount must be > 0'));
    if (!dur || dur <= 0)
      return next(createHttpError(400, 'durationSecs must be > 0'));
    const result = await invoke(
      contractId,
      'backtest',
      { strategy_id: sid, initial_amount: amt, duration_secs: dur },
      network
    );
    return res.json({ success: true, result: result.parsed });
  })
);

// ── Position & status ─────────────────────────────────────────────────────────

router.get(
  '/position',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { user, strategyId, network } = req.query;
    if (!validateAddress(user))
      return next(createHttpError(400, 'Invalid user address'));
    const sid = Number(strategyId);
    if (!Number.isInteger(sid) || sid < 1)
      return next(createHttpError(400, 'strategyId must be >= 1'));
    const result = await invoke(
      contractId,
      'get_position',
      { user, strategy_id: sid },
      network
    );
    return res.json({ success: true, position: result.parsed });
  })
);

router.get(
  '/status',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const [paused, count] = await Promise.all([
      invoke(contractId, 'is_paused', {}, network),
      invoke(contractId, 'strategy_count', {}, network),
    ]);
    return res.json({
      success: true,
      paused: paused.parsed,
      strategyCount: count.parsed,
    });
  })
);

// ── Vault & Protocol Aliases (for Unit Tests compatibility) ──────────────────

router.post(
  '/protocols',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, name, baseApyBps, network } = req.body || {};
    const errs = requireFields(req.body, [
      'contractId',
      'admin',
      'name',
      'baseApyBps',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    if (
      typeof baseApyBps !== 'number' ||
      baseApyBps < 0 ||
      baseApyBps > 50000
    ) {
      return next(createHttpError(400, 'baseApyBps must be 0-50000'));
    }
    const result = await invoke(
      contractId,
      'add_protocol',
      { admin, name, base_apy_bps: baseApyBps },
      network
    );
    return res.status(201).json({ success: true, protocolId: result.parsed });
  })
);

router.patch(
  '/protocols/:id/apy',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, newApyBps, network } = req.body || {};
    const protocolId = Number(req.params.id);
    if (!Number.isInteger(protocolId) || protocolId < 1)
      return next(createHttpError(400, 'Invalid protocol id'));
    const errs = requireFields(req.body, ['contractId', 'admin', 'newApyBps']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    if (typeof newApyBps !== 'number' || newApyBps < 0 || newApyBps > 50000) {
      return next(createHttpError(400, 'newApyBps must be 0-50000'));
    }
    const result = await invoke(
      contractId,
      'update_protocol_apy',
      { admin, protocol_id: protocolId, new_apy_bps: newApyBps },
      network
    );
    return res.json({ success: true, output: result.parsed });
  })
);

router.post(
  '/vaults',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, name, protocolId, network } = req.body || {};
    const errs = requireFields(req.body, [
      'contractId',
      'admin',
      'name',
      'protocolId',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    const result = await invoke(
      contractId,
      'add_vault',
      { admin, name, protocol_id: protocolId },
      network
    );
    return res.status(201).json({ success: true, vaultId: result.parsed });
  })
);

router.get(
  '/vaults',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const result = await invoke(contractId, 'vault_count', {}, network);
    return res.json({ success: true, vaultCount: result.parsed });
  })
);

router.post(
  '/vaults/:id/deposit',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, user, amount, network } = req.body || {};
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1)
      return next(createHttpError(400, 'Invalid vault id'));
    const errs = requireFields(req.body, ['contractId', 'user', 'amount']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(user))
      return next(createHttpError(400, 'Invalid user address'));
    if (typeof amount !== 'number' || amount <= 0)
      return next(createHttpError(400, 'amount must be > 0'));
    const result = await invoke(
      contractId,
      'deposit',
      { user, vault_id: id, amount },
      network
    );
    return res.json({ success: true, compoundedBalance: result.parsed });
  })
);

router.post(
  '/vaults/:id/withdraw',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, user, amount, network } = req.body || {};
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1)
      return next(createHttpError(400, 'Invalid vault id'));
    const errs = requireFields(req.body, ['contractId', 'user', 'amount']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(user))
      return next(createHttpError(400, 'Invalid user address'));
    if (typeof amount !== 'number' || amount <= 0)
      return next(createHttpError(400, 'amount must be > 0'));
    const result = await invoke(
      contractId,
      'withdraw',
      { user, vault_id: id, amount },
      network
    );
    return res.json({ success: true, withdrawn: result.parsed });
  })
);

router.post(
  '/vaults/:id/compound',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, network } = req.body || {};
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1)
      return next(createHttpError(400, 'Invalid vault id'));
    const errs = requireFields(req.body, ['contractId']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    const result = await invoke(
      contractId,
      'compound',
      { vault_id: id },
      network
    );
    return res.json({ success: true, rewardsCompounded: result.parsed });
  })
);

router.get(
  '/vaults/:id/estimated/:user',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1)
      return next(createHttpError(400, 'Invalid vault id'));
    const { user } = req.params;
    if (!validateAddress(user))
      return next(createHttpError(400, 'Invalid user address'));
    const { network } = req.query;
    const result = await invoke(
      contractId,
      'estimated_balance',
      { user, vault_id: id },
      network
    );
    return res.json({ success: true, estimatedBalance: result.parsed });
  })
);

router.post(
  '/vaults/:id/backtest',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1)
      return next(createHttpError(400, 'Invalid vault id'));
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    const result = await invoke(
      contractId,
      'backtest',
      { admin, vault_id: id },
      network
    );
    return res.status(201).json({ success: true, backtestId: result.parsed });
  })
);

export default router;
