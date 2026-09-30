// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// OracleService — orchestrates N simulated oracle nodes in one process.
//
// Wire-up:
//   - One shared lock backend (memory or redis) so leader-election works.
//   - One shared VoteStore so all nodes see the same tally.
//   - One shared VoteSigner (per-node HMAC keys) for vote authenticity.
//   - One shared ConsensusCoordinator (per coordinator instance is fine
//     — they all read the same VoteStore and use the same lockManager
//     for leader election).
//
// Lifecycle of a proof:
//   submitProof(payload) → fan out validate-and-vote across all nodes
//   in parallel → first node to hit quorum elects itself leader and
//   "submits" → all others become followers → state recorded.
//
// "Submission" is pluggable. Default: log + emit event. Real deployments
// inject a Stellar transaction submitter.

import crypto from 'crypto';

import { ConsensusCoordinator } from './consensus.js';
import { LockManager } from './lockManager.js';
import { MemoryBackend } from './backends.js';
import { MemoryVoteStore } from './voteStore.js';
import { VoteSigner } from './voteSigner.js';
import { OracleNode } from './oracleNode.js';
import { OracleEvent, sharedOracleEventBus } from './oracleEvents.js';
import { sharedAuditLog } from './auditLog.js';

const DEFAULT_NODE_COUNT = 5;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_PROOF_TTL_MS = 5 * 60_000;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const WAIT_POLL_INTERVAL_MS = 5;

// Proof lifecycle states. Previously these were bare strings scattered across
// the module, which made typos silent and terminal-state checks easy to get
// wrong.
export const ProofStatus = Object.freeze({
  VOTING: 'voting',
  SUBMITTED: 'submitted',
  NO_QUORUM: 'no_quorum',
  FAILED: 'failed',
});

const TERMINAL_STATUSES = Object.freeze([
  ProofStatus.SUBMITTED,
  ProofStatus.FAILED,
  ProofStatus.NO_QUORUM,
]);

function newProofId() {
  return crypto.randomBytes(8).toString('hex');
}

function buildNodeIds(nodeCount, nodeIds) {
  if (nodeIds) {
    return nodeIds;
  }

  return Array.from({ length: nodeCount }, (_, i) => `oracle-${i + 1}`);
}

function createProofRecord({ proofId, payload, metadata }) {
  return {
    id: proofId,
    payload,
    metadata: metadata || null,
    status: ProofStatus.VOTING,
    submittedAt: Date.now(),
    votes: [],
    consensus: null,
    leader: null,
    result: null,
    error: null,
  };
}

function mapProofVotes(nodeResults, nodes) {
  return nodeResults.map((result, index) => ({
    nodeId: nodes[index].id,
    ok: result.status === 'fulfilled',
    phase: result.status === 'fulfilled' ? result.value.phase : 'rejected',
    error:
      result.status === 'rejected'
        ? result.reason?.message
        : result.value?.error,
  }));
}

function findLeaderResult(nodeResults) {
  return nodeResults.find(
    (r) => r.status === 'fulfilled' && r.value.phase === 'leader'
  );
}

function hasRejectedVote(nodeResults) {
  return nodeResults.some(
    (r) => r.status === 'fulfilled' && r.value.phase === 'rejected'
  );
}

function buildRandomSignerKeys(ids) {
  return Object.fromEntries(
    ids.map((id) => [id, crypto.randomBytes(32).toString('hex')])
  );
}

export class OracleService {
  constructor({
    nodeCount = DEFAULT_NODE_COUNT,
    threshold = DEFAULT_THRESHOLD,
    backend,
    voteStore,
    voteSigner,
    eventBus = sharedOracleEventBus,
    auditLog = sharedAuditLog,
    submitter,
    nodeIds, // optional explicit array of node ids (overrides nodeCount)
    requireSignedVotes = true,
    proofRetention = 100, // keep last N proofs in memory for status queries
  } = {}) {
    if (threshold > nodeCount && !nodeIds) {
      throw new Error(
        `threshold (${threshold}) cannot exceed nodeCount (${nodeCount})`
      );
    }
    this.backend = backend || new MemoryBackend();
    this.voteStore =
      voteStore || new MemoryVoteStore({ defaultTtlMs: DEFAULT_PROOF_TTL_MS });
    this.eventBus = eventBus;
    this.audit = auditLog;
    this.submitter = submitter;
    this.threshold = threshold;
    this.proofRetention = proofRetention;
    this.proofs = new Map(); // proofId -> proof state
    this.proofOrder = []; // FIFO of proofIds for retention pruning

    const ids = buildNodeIds(nodeCount, nodeIds);
    this.voteSigner =
      voteSigner ||
      new VoteSigner({
        keys: buildRandomSignerKeys(ids),
        required: requireSignedVotes,
      });

    // Shared coordinator — created with a lockManager backed by the
    // shared backend; nodeId here is purely for audit-log attribution.
    const coordinatorLockManager = new LockManager({
      backend: this.backend,
      nodeId: 'oracle-coordinator',
      auditLog,
    });
    this.consensus = new ConsensusCoordinator({
      lockManager: coordinatorLockManager,
      voteStore: this.voteStore,
      voteSigner: this.voteSigner,
      auditLog,
      voteTtlMs: DEFAULT_PROOF_TTL_MS,
    });

    this.nodes = ids.map(
      (id) =>
        new OracleNode({
          id,
          backend: this.backend,
          consensusCoordinator: this.consensus,
          voteSigner: this.voteSigner,
          threshold,
          eventBus,
          auditLog,
          submitter: this.submitter,
        })
    );
  }

  _trackProof(proof) {
    this.proofs.set(proof.id, proof);
    this.proofOrder.push(proof.id);
    while (this.proofOrder.length > this.proofRetention) {
      const evicted = this.proofOrder.shift();
      this.proofs.delete(evicted);
      this.consensus.forget(evicted).catch(() => {});
    }
  }

  // Submit a new proof. Returns immediately with the proofId; processing
  // happens asynchronously and progress is observable via getProof() or
  // events on the bus.
  async submitProof(payload, { metadata } = {}) {
    const proofId = newProofId();
    const proof = createProofRecord({ proofId, payload, metadata });
    this._trackProof(proof);
    this.eventBus.publish(OracleEvent.PROOF_RECEIVED, {
      proofId,
      payload,
      metadata,
    });

    // Fire-and-forget node fan-out. We collect results to populate proof
    // state, but the HTTP caller doesn't wait for it.
    this._runProof(proof).catch((err) => {
      proof.status = ProofStatus.FAILED;
      proof.error = err.message;
      this.eventBus.publish(OracleEvent.PROOF_FAILED, {
        proofId,
        error: err.message,
      });
    });
    return proof;
  }

  // Same as submitProof but awaits completion. Useful for tests and
  // for callers that want a synchronous response.
  async submitProofAndWait(payload, opts = {}) {
    const proof = await this.submitProof(payload, opts);
    await this._waitFor(proof.id, TERMINAL_STATUSES);
    return this.getProof(proof.id);
  }

  async _runProof(proof) {
    const nodeResults = await Promise.allSettled(
      this.nodes.map((n) => n.processProof(proof.id, proof.payload))
    );

    proof.votes = mapProofVotes(nodeResults, this.nodes);

    const leaderResult = findLeaderResult(nodeResults);
    if (leaderResult) {
      this._applyLeaderOutcome(proof, leaderResult.value);
      return;
    }

    await this._applyNoLeaderOutcome(proof, nodeResults);
  }

  _applyLeaderOutcome(proof, leader) {
    proof.status = ProofStatus.SUBMITTED;
    proof.leader = leader.handle?.owner ?? null;
    proof.consensus = leader.tally;
    proof.result = leader.submission ?? null;
  }

  // No leader was elected — either quorum was never reached, or every node
  // rejected the payload outright.
  async _applyNoLeaderOutcome(proof, nodeResults) {
    const tally = await this.consensus.tally(proof.id);
    proof.consensus = tally;
    proof.status =
      tally.totalVotes === 0 && hasRejectedVote(nodeResults)
        ? ProofStatus.FAILED
        : ProofStatus.NO_QUORUM;
  }

  // Internal helper for submitProofAndWait(). Resolves once the proof reaches
  // a terminal status, or once it has been evicted by the retention window.
  _waitFor(
    proofId,
    terminalStatuses = TERMINAL_STATUSES,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
  ) {
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve, reject) => {
      const check = () => {
        const proof = this.proofs.get(proofId);
        if (!proof || terminalStatuses.includes(proof.status)) {
          return resolve();
        }
        if (Date.now() >= deadline) {
          return reject(
            new Error(`Proof ${proofId} did not complete within ${timeoutMs}ms`)
          );
        }
        setTimeout(check, WAIT_POLL_INTERVAL_MS);
      };
      check();
    });
  }

  getProof(proofId) {
    return this.proofs.get(proofId) || null;
  }

  listProofs({ limit = 50 } = {}) {
    const ids = this.proofOrder.slice(-limit).reverse();
    return ids.map((id) => this.proofs.get(id)).filter(Boolean);
  }

  listNodes() {
    return this.nodes.map((n) => n.snapshot());
  }

  health() {
    const activeProofs = this.listProofs({ limit: this.proofRetention }).filter(
      (p) => p.status === ProofStatus.VOTING
    ).length;

    return {
      backend: this.backend.name,
      voteStore: this.voteStore.name,
      nodes: this.nodes.length,
      threshold: this.threshold,
      processedProofs: this.proofOrder.length,
      activeProofs,
    };
  }
}

let singleton = null;

export function getOracleService(opts) {
  if (!singleton) singleton = new OracleService(opts);
  return singleton;
}

export function resetOracleServiceForTests() {
  singleton = null;
}

export { OracleEvent };
