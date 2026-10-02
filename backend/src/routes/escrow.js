// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { validateStellarAddress } from '../lib/stellar.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory state (mirrors on-chain contract state for the playground)
// ---------------------------------------------------------------------------

let initialized = false;
let adminAddress = null;
let arbiterFeeBps = 200; // 2%
let escrowCount = 0;
let paused = false;

const escrows = new Map(); // escrowId -> Escrow
const milestones = new Map(); // `${escrowId}-${milestoneId}` -> Milestone

const analytics = {
  totalEscrows: 0,
  activeEscrows: 0,
  completedEscrows: 0,
  disputedEscrows: 0,
  cancelledEscrows: 0,
  totalValueLocked: 0,
  totalPaidOut: 0,
  totalFeesCollected: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowSecs() {
  return Math.floor(Date.now() / 1000);
}

function validateAddress(addr) {
  return validateStellarAddress(addr);
}

function requireInitialized() {
  if (!initialized) throw createHttpError(400, 'Contract not initialized');
  if (paused) throw createHttpError(503, 'Contract is paused');
}

function getMilestoneKey(escrowId, milestoneId) {
  return `${escrowId}-${milestoneId}`;
}

function getEscrowMilestones(escrowId, count) {
  const result = [];
  for (let i = 1; i <= count; i++) {
    const m = milestones.get(getMilestoneKey(escrowId, i));
    if (m) result.push(m);
  }
  return result;
}

// ---------------------------------------------------------------------------
// POST /initialize
// ---------------------------------------------------------------------------

router.post(
  '/initialize',
  asyncHandler(async (req, res) => {
    if (initialized) throw createHttpError(409, 'Contract already initialized');
    const { admin, arbiterFeeBps: bps = 200 } = req.body || {};
    if (!validateAddress(admin))
      throw createHttpError(400, 'admin address is required');
    if (typeof bps !== 'number' || bps < 0 || bps > 10000)
      throw createHttpError(400, 'arbiterFeeBps must be 0–10000');
    initialized = true;
    adminAddress = admin;
    arbiterFeeBps = bps;
    paused = false;
    res.json({ success: true, data: { admin, arbiterFeeBps: bps } });
  })
);

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: { initialized, admin: adminAddress, arbiterFeeBps, escrowCount, paused },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /analytics
// ---------------------------------------------------------------------------

router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    requireInitialized();
    res.json({ success: true, data: analytics });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows  (create_escrow)
// ---------------------------------------------------------------------------

router.post(
  '/escrows',
  asyncHandler(async (req, res) => {
    requireInitialized();
    const { client, freelancer, arbiter, totalAmount, milestoneAmounts } =
      req.body || {};

    if (!validateAddress(client))
      throw createHttpError(400, 'client is required');
    if (!validateAddress(freelancer))
      throw createHttpError(400, 'freelancer is required');
    if (!validateAddress(arbiter))
      throw createHttpError(400, 'arbiter is required');

    const total = Number(totalAmount);
    if (!total || total <= 0)
      throw createHttpError(400, 'totalAmount must be positive');

    if (!Array.isArray(milestoneAmounts) || milestoneAmounts.length === 0)
      throw createHttpError(400, 'milestoneAmounts must be a non-empty array');
    if (milestoneAmounts.length > 20)
      throw createHttpError(400, 'Maximum 20 milestones per escrow');

    const amounts = milestoneAmounts.map(Number);
    if (amounts.some((a) => a <= 0))
      throw createHttpError(400, 'All milestone amounts must be positive');
    if (amounts.some((a) => !Number.isFinite(a)))
      throw createHttpError(400, 'All milestone amounts must be finite numbers');

    const sum = amounts.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - total) > 0.0001)
      throw createHttpError(
        400,
        `Milestone amounts sum (${sum}) must equal totalAmount (${total})`
      );

    escrowCount += 1;
    const id = escrowCount;

    const escrow = {
      id,
      client,
      freelancer,
      arbiter,
      totalAmount: total,
      paidAmount: 0,
      milestoneCount: amounts.length,
      milestonesPaid: 0,
      status: 'Pending',
      createdAt: nowSecs(),
      arbiterFeeBps,
    };
    escrows.set(id, escrow);

    // Create milestones
    amounts.forEach((amount, idx) => {
      const milestoneId = idx + 1;
      milestones.set(getMilestoneKey(id, milestoneId), {
        id: milestoneId,
        escrowId: id,
        amount,
        status: 'Pending',
      });
    });

    analytics.totalEscrows += 1;

    res.status(201).json({
      success: true,
      data: { ...escrow, milestones: getEscrowMilestones(id, amounts.length) },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /escrows
// ---------------------------------------------------------------------------

router.get(
  '/escrows',
  asyncHandler(async (req, res) => {
    const {
      status,
      client,
      freelancer,
      limit = '20',
      offset = '0',
    } = req.query;
    let list = Array.from(escrows.values());

    if (status)
      list = list.filter(
        (e) => e.status.toLowerCase() === status.toLowerCase()
      );
    if (client) list = list.filter((e) => e.client === client);
    if (freelancer) list = list.filter((e) => e.freelancer === freelancer);

    list.sort((a, b) => b.id - a.id);

    const total = list.length;
    const lim = parseInt(limit, 10);
    const off = parseInt(offset, 10);
    const safeLim = Number.isFinite(lim) && lim > 0 ? Math.min(lim, 100) : 20;
    const safeOff = Number.isFinite(off) && off >= 0 ? off : 0;
    const paginated = list.slice(safeOff, safeOff + safeLim).map((e) => ({
      ...e,
      milestones: getEscrowMilestones(e.id, e.milestoneCount),
    }));

    res.json({
      success: true,
      data: paginated,
      meta: { total, limit: safeLim, offset: safeOff },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /escrows/:id
// ---------------------------------------------------------------------------

router.get(
  '/escrows/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);
    res.json({
      success: true,
      data: {
        ...escrow,
        milestones: getEscrowMilestones(id, escrow.milestoneCount),
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/deposit
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/deposit',
  asyncHandler(async (req, res) => {
    requireInitialized();
    const id = parseInt(req.params.id, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== escrow.client)
      throw createHttpError(403, 'Only the client can deposit');
    if (escrow.status !== 'Pending')
      throw createHttpError(400, 'Escrow is not in Pending state');

    escrow.status = 'Active';

    // Start first milestone
    const first = milestones.get(getMilestoneKey(id, 1));
    if (first) {
      first.status = 'InProgress';
    }

    analytics.activeEscrows += 1;
    analytics.totalValueLocked += escrow.totalAmount;

    res.json({ success: true, data: { escrowId: id, status: 'Active' } });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/milestones/:milestoneId/submit
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/milestones/:milestoneId/submit',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const milestoneId = parseInt(req.params.milestoneId, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== escrow.freelancer)
      throw createHttpError(403, 'Only the freelancer can submit milestones');
    if (escrow.status !== 'Active')
      throw createHttpError(400, 'Escrow is not active');

    const milestone = milestones.get(getMilestoneKey(id, milestoneId));
    if (!milestone)
      throw createHttpError(404, `Milestone ${milestoneId} not found`);
    if (milestone.status !== 'InProgress')
      throw createHttpError(400, 'Milestone must be InProgress to submit');

    milestone.status = 'UnderReview';
    milestone.submittedAt = nowSecs();

    res.json({
      success: true,
      data: { escrowId: id, milestoneId, status: 'UnderReview' },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/milestones/:milestoneId/approve
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/milestones/:milestoneId/approve',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const milestoneId = parseInt(req.params.milestoneId, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== escrow.client)
      throw createHttpError(403, 'Only the client can approve milestones');
    if (escrow.status !== 'Active')
      throw createHttpError(400, 'Escrow is not active');

    const milestone = milestones.get(getMilestoneKey(id, milestoneId));
    if (!milestone)
      throw createHttpError(404, `Milestone ${milestoneId} not found`);
    if (milestone.status !== 'UnderReview')
      throw createHttpError(400, 'Milestone must be UnderReview to approve');

    milestone.status = 'Approved';
    milestone.approvedAt = nowSecs();

    res.json({
      success: true,
      data: { escrowId: id, milestoneId, status: 'Approved' },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/milestones/:milestoneId/reject
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/milestones/:milestoneId/reject',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const milestoneId = parseInt(req.params.milestoneId, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== escrow.client)
      throw createHttpError(403, 'Only the client can reject milestones');
    if (escrow.status !== 'Active')
      throw createHttpError(400, 'Escrow is not active');

    const milestone = milestones.get(getMilestoneKey(id, milestoneId));
    if (!milestone)
      throw createHttpError(404, `Milestone ${milestoneId} not found`);
    if (milestone.status !== 'UnderReview')
      throw createHttpError(400, 'Milestone must be UnderReview to reject');

    milestone.status = 'InProgress';
    milestone.rejectedAt = nowSecs();

    res.json({
      success: true,
      data: { escrowId: id, milestoneId, status: 'InProgress' },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/milestones/:milestoneId/release
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/milestones/:milestoneId/release',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const milestoneId = parseInt(req.params.milestoneId, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== escrow.client)
      throw createHttpError(403, 'Only the client can release payment');
    if (escrow.status !== 'Active')
      throw createHttpError(400, 'Escrow is not active');

    const milestone = milestones.get(getMilestoneKey(id, milestoneId));
    if (!milestone)
      throw createHttpError(404, `Milestone ${milestoneId} not found`);
    if (milestone.status !== 'Approved')
      throw createHttpError(
        400,
        'Milestone must be Approved to release payment'
      );

    const fee = Math.floor((milestone.amount * escrow.arbiterFeeBps) / 10000);
    const net = milestone.amount - fee;

    milestone.status = 'Paid';
    milestone.paidAt = nowSecs();
    escrow.paidAmount += milestone.amount;
    escrow.milestonesPaid += 1;

    // Advance next milestone to InProgress
    const nextMilestone = milestones.get(getMilestoneKey(id, milestoneId + 1));
    if (nextMilestone && nextMilestone.status === 'Pending') {
      nextMilestone.status = 'InProgress';
    }

    // Complete escrow if fully paid
    if (escrow.paidAmount >= escrow.totalAmount) {
      escrow.status = 'Completed';
      analytics.activeEscrows = Math.max(0, analytics.activeEscrows - 1);
      analytics.completedEscrows += 1;
      analytics.totalValueLocked = Math.max(
        0,
        analytics.totalValueLocked - escrow.totalAmount
      );
      analytics.totalPaidOut += escrow.totalAmount;
      analytics.totalFeesCollected += fee;
    }

    res.json({
      success: true,
      data: {
        escrowId: id,
        milestoneId,
        netPayout: net,
        fee,
        escrowStatus: escrow.status,
        paidAmount: escrow.paidAmount,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/dispute
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/dispute',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== escrow.client && caller !== escrow.freelancer)
      throw createHttpError(
        403,
        'Only client or freelancer can raise a dispute'
      );
    if (escrow.status !== 'Active')
      throw createHttpError(400, 'Escrow must be Active to dispute');

    escrow.status = 'Disputed';
    escrow.disputedAt = nowSecs();
    analytics.disputedEscrows += 1;
    analytics.activeEscrows = Math.max(0, analytics.activeEscrows - 1);

    res.json({ success: true, data: { escrowId: id, status: 'Disputed' } });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/resolve
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/resolve',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller, ruling } = req.body || {};
    if (caller !== escrow.arbiter)
      throw createHttpError(403, 'Only the arbiter can resolve disputes');
    if (escrow.status !== 'Disputed')
      throw createHttpError(400, 'Escrow must be Disputed to resolve');
    if (![0, 1, 2].includes(ruling))
      throw createHttpError(
        400,
        'ruling must be 0 (FreelancerFavored), 1 (ClientFavored), or 2 (Split)'
      );

    const remaining = escrow.totalAmount - escrow.paidAmount;
    const fee = Math.floor((remaining * escrow.arbiterFeeBps) / 10000);
    const net = remaining - fee;

    let freelancerPayout, clientRefund;
    if (ruling === 0) {
      freelancerPayout = net;
      clientRefund = 0;
    } else if (ruling === 1) {
      freelancerPayout = 0;
      clientRefund = remaining;
    } else {
      freelancerPayout = Math.floor(net / 2);
      clientRefund = remaining - fee - freelancerPayout;
    }

    const rulingLabel = ['FreelancerFavored', 'ClientFavored', 'Split'][ruling];

    escrow.paidAmount = escrow.totalAmount;
    escrow.status = 'Completed';
    escrow.resolvedAt = nowSecs();
    analytics.completedEscrows += 1;
    analytics.totalValueLocked = Math.max(
      0,
      analytics.totalValueLocked - remaining
    );
    analytics.totalPaidOut += remaining;
    analytics.totalFeesCollected += fee;

    res.json({
      success: true,
      data: {
        escrowId: id,
        ruling: rulingLabel,
        freelancerPayout,
        clientRefund,
        fee,
        status: 'Completed',
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /escrows/:id/cancel
// ---------------------------------------------------------------------------

router.post(
  '/escrows/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const escrow = escrows.get(id);
    if (!escrow) throw createHttpError(404, `Escrow ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== escrow.client)
      throw createHttpError(403, 'Only the client can cancel');
    if (escrow.status !== 'Pending')
      throw createHttpError(400, 'Only Pending escrows can be cancelled');

    escrow.status = 'Cancelled';
    escrow.cancelledAt = nowSecs();
    analytics.cancelledEscrows += 1;

    res.json({ success: true, data: { escrowId: id, status: 'Cancelled' } });
  })
);

// ---------------------------------------------------------------------------
// POST /pause  (admin emergency stop)
// ---------------------------------------------------------------------------

router.post(
  '/pause',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    const { caller } = req.body || {};
    if (caller !== adminAddress)
      throw createHttpError(403, 'Only admin can pause');
    paused = true;
    res.json({ success: true, data: { paused } });
  })
);

// ---------------------------------------------------------------------------
// POST /unpause
// ---------------------------------------------------------------------------

router.post(
  '/unpause',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    const { caller } = req.body || {};
    if (caller !== adminAddress)
      throw createHttpError(403, 'Only admin can unpause');
    paused = false;
    res.json({ success: true, data: { paused } });
  })
);

export default router;
