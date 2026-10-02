// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Patent Registry Service
 *
 * Wraps Soroban CLI invocations for the patent-registry contract.
 * All write operations go through `invokeSorobanContract`; reads use
 * the same path so the frontend always gets consistent data shapes.
 */

import { invokeSorobanContract } from './invokeService.js';

const CONTRACT_ID = process.env.PATENT_CONTRACT_ID || '';
const NETWORK = process.env.DEFAULT_NETWORK || 'testnet';
const SOURCE = process.env.SOROBAN_SOURCE_ACCOUNT || '';

// ── Validation helpers ────────────────────────────────────────────────────────

const STELLAR_ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;
const HEX_64_RE = /^[0-9a-fA-F]{64}$/;

function assertAddress(value, field) {
  if (typeof value !== 'string' || !STELLAR_ADDRESS_RE.test(value)) {
    throw new TypeError(`patentService: invalid Stellar address for "${field}"`);
  }
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`patentService: "${field}" must be a non-empty string`);
  }
}

function assertPositiveInt(value, field) {
  const n = typeof value === 'bigint' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`patentService: "${field}" must be a non-negative integer`);
  }
}

function assertFutureOrNull(value, field) {
  if (value === null || value === undefined) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new TypeError(`patentService: "${field}" must be a valid unix timestamp`);
  }
}

function assertContractConfigured() {
  if (!CONTRACT_ID) {
    throw new Error(
      'patentService: PATENT_CONTRACT_ID is not configured for the current environment',
    );
  }
}

function normalizeInvokeResult(result) {
  if (result && typeof result === 'object' && 'value' in result && result.value !== undefined) {
    return result.value;
  }
  return result;
}

async function invoke(functionName, args = {}) {
  assertContractConfigured();
  return invokeSorobanContract({
    requestId: `patent-${Date.now()}`,
    contractId: CONTRACT_ID,
    functionName,
    args,
    network: NETWORK,
    sourceAccount: SOURCE,
  });
}

// ── Write operations ──────────────────────────────────────────────────────────

export async function filePatent({ inventor, title, description, expiryDate }) {
  assertAddress(inventor, 'inventor');
  assertNonEmptyString(title, 'title');
  assertNonEmptyString(description, 'description');
  assertFutureOrNull(expiryDate, 'expiryDate');
  return invoke('file_patent', {
    inventor,
    title,
    description,
    expiry_date: expiryDate,
  });
}

export async function activatePatent({ admin, patentId }) {
  assertAddress(admin, 'admin');
  assertPositiveInt(patentId, 'patentId');
  return invoke('activate_patent', { admin, patent_id: patentId });
}

export async function revokePatent({ admin, patentId }) {
  assertAddress(admin, 'admin');
  assertPositiveInt(patentId, 'patentId');
  return invoke('revoke_patent', { admin, patent_id: patentId });
}

export async function transferPatent({ owner, patentId, newOwner }) {
  assertAddress(owner, 'owner');
  assertAddress(newOwner, 'newOwner');
  assertPositiveInt(patentId, 'patentId');
  return invoke('transfer_patent', {
    owner,
    patent_id: patentId,
    new_owner: newOwner,
  });
}

export async function grantLicense({
  owner,
  patentId,
  licensee,
  licenseType,
  fee,
  expiryDate,
}) {
  assertAddress(owner, 'owner');
  assertAddress(licensee, 'licensee');
  assertPositiveInt(patentId, 'patentId');
  assertNonEmptyString(licenseType, 'licenseType');
  assertPositiveInt(fee, 'fee');
  assertFutureOrNull(expiryDate, 'expiryDate');
  return invoke('grant_license', {
    owner,
    patent_id: patentId,
    licensee,
    license_type: licenseType,
    fee,
    expiry_date: expiryDate,
  });
}

export async function fileDispute({ claimant, patentId, reason }) {
  assertAddress(claimant, 'claimant');
  assertPositiveInt(patentId, 'patentId');
  assertNonEmptyString(reason, 'reason');
  return invoke('file_dispute', {
    claimant,
    patent_id: patentId,
    reason,
  });
}

export async function resolveDispute({ admin, disputeId, resolution }) {
  assertAddress(admin, 'admin');
  assertPositiveInt(disputeId, 'disputeId');
  assertNonEmptyString(resolution, 'resolution');
  return invoke('resolve_dispute', {
    admin,
    dispute_id: disputeId,
    resolution,
  });
}

export async function pauseContract({ admin }) {
  assertAddress(admin, 'admin');
  return invoke('pause', { admin });
}

export async function unpauseContract({ admin }) {
  assertAddress(admin, 'admin');
  return invoke('unpause', { admin });
}

// ── Read operations ───────────────────────────────────────────────────────────

export async function getPatent(patentId) {
  assertPositiveInt(patentId, 'patentId');
  return normalizeInvokeResult(await invoke('get_patent', { patent_id: patentId }));
}

export async function getLicense(licenseId) {
  assertPositiveInt(licenseId, 'licenseId');
  return normalizeInvokeResult(await invoke('get_license', { license_id: licenseId }));
}

export async function getDispute(disputeId) {
  assertPositiveInt(disputeId, 'disputeId');
  return normalizeInvokeResult(await invoke('get_dispute', { dispute_id: disputeId }));
}

export async function getPatentCount() {
  return normalizeInvokeResult(await invoke('get_patent_count', {}));
}

export async function getLicenseCount() {
  return normalizeInvokeResult(await invoke('get_license_count', {}));
}

export async function getDisputeCount() {
  return normalizeInvokeResult(await invoke('get_dispute_count', {}));
}

export async function getAdmin() {
  return normalizeInvokeResult(await invoke('get_admin', {}));
}

export async function getIsPaused() {
  return normalizeInvokeResult(await invoke('is_paused', {}));
}
