// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import DatabaseService from './databaseService.js';

const db = new DatabaseService();

const FILE_HASH_REGEX = /^[0-9a-fA-F]{64}$/;
const MAX_METADATA_LENGTH = 500;

/**
 * Structured error class for notary operations.
 * Carries an HTTP status code and a machine-readable error code.
 */
export class NotaryError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code - machine-readable code (e.g. 'DUPLICATE_NOTARIZATION')
   * @param {string} message
   */
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'NotaryError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function ensureTable() {
  await db.connect();
  await db.run(`
    CREATE TABLE IF NOT EXISTS notary_records (
      file_hash TEXT PRIMARY KEY,
      owner     TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata  TEXT NOT NULL,
      verified  INTEGER NOT NULL DEFAULT 1,
      record_id INTEGER NOT NULL
    )
  `);
}

const _init = ensureTable();

/**
 * Validate a SHA-256 file hash.
 * @param {string} fileHash
 * @throws {NotaryError} if the hash is malformed
 */
export function validateFileHash(fileHash) {
  if (!fileHash || typeof fileHash !== 'string') {
    throw new NotaryError(
      400,
      'INVALID_FILE_HASH',
      'fileHash is required and must be a string'
    );
  }
  if (!FILE_HASH_REGEX.test(fileHash)) {
    throw new NotaryError(
      400,
      'INVALID_FILE_HASH',
      'fileHash must be a 64-character hexadecimal string'
    );
  }
}

/**
 * Validate notarization metadata.
 * @param {string} metadata
 * @throws {NotaryError} if the metadata is invalid
 */
export function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'string') {
    throw new NotaryError(
      400,
      'INVALID_METADATA',
      'metadata is required and must be a string'
    );
  }
  if (metadata.length === 0) {
    throw new NotaryError(
      400,
      'INVALID_METADATA',
      'metadata must not be empty'
    );
  }
  if (metadata.length > MAX_METADATA_LENGTH) {
    throw new NotaryError(
      400,
      'INVALID_METADATA',
      `metadata must not exceed ${MAX_METADATA_LENGTH} characters`
    );
  }
}

/**
 * Notarize a file: call Soroban contract (stubbed) and cache in DB.
 * @param {string} fileHash  64-char hex string
 * @param {string} metadata  arbitrary string
 * @param {string} callerAddress  Stellar address
 * @returns {{ recordId: number, timestamp: number }}
 */
export async function notarizeFile(fileHash, metadata, callerAddress) {
  await _init;

  validateFileHash(fileHash);
  validateMetadata(metadata);

  let existing;
  try {
    existing = await db.get(
      'SELECT file_hash FROM notary_records WHERE file_hash = ?',
      [fileHash]
    );
  } catch (err) {
    throw new NotaryError(
      500,
      'DATABASE_ERROR',
      'Failed to query notary records'
    );
  }

  if (existing) {
    throw new NotaryError(
      409,
      'DUPLICATE_NOTARIZATION',
      'File already notarized'
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const recordId = timestamp;

  try {
    await db.run(
      `INSERT INTO notary_records (file_hash, owner, timestamp, metadata, verified, record_id)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [fileHash, callerAddress, timestamp, metadata, recordId]
    );
  } catch (err) {
    throw new NotaryError(
      500,
      'DATABASE_ERROR',
      'Failed to persist notary record'
    );
  }

  return { recordId, timestamp };
}

/**
 * Verify a file: read from cache first, fall back to contract if not cached.
 * @param {string} fileHash
 * @returns {object} NotaryRecord
 */
export async function verifyFile(fileHash) {
  await _init;

  validateFileHash(fileHash);

  let row;
  try {
    row = await db.get('SELECT * FROM notary_records WHERE file_hash = ?', [
      fileHash,
    ]);
  } catch (err) {
    throw new NotaryError(
      500,
      'DATABASE_ERROR',
      'Failed to query notary records'
    );
  }

  if (!row) {
    throw new NotaryError(404, 'NOT_FOUND', 'File not found');
  }

  const verified = row.verified === 1;

  return {
    fileHash: row.file_hash,
    owner: row.owner,
    timestamp: row.timestamp,
    metadata: row.metadata,
    verified,
    recordId: row.record_id,
    status: verified ? 'active' : 'revoked',
  };
}

/**
 * Revoke a notarization: call contract and update cache.
 * @param {string} fileHash
 * @param {string} callerAddress
 */
export async function revokeNotarization(fileHash, callerAddress) {
  await _init;

  validateFileHash(fileHash);

  if (!callerAddress || typeof callerAddress !== 'string') {
    throw new NotaryError(400, 'INVALID_CALLER', 'callerAddress is required');
  }

  let row;
  try {
    row = await db.get(
      'SELECT owner, verified FROM notary_records WHERE file_hash = ?',
      [fileHash]
    );
  } catch (err) {
    throw new NotaryError(
      500,
      'DATABASE_ERROR',
      'Failed to query notary records'
    );
  }

  if (!row) {
    throw new NotaryError(404, 'NOT_FOUND', 'File not found');
  }

  if (row.owner !== callerAddress) {
    throw new NotaryError(
      403,
      'UNAUTHORIZED',
      'Only the file owner can revoke a notarization'
    );
  }

  if (row.verified === 0) {
    throw new NotaryError(
      409,
      'ALREADY_REVOKED',
      'Notarization has already been revoked'
    );
  }

  try {
    await db.run('UPDATE notary_records SET verified = 0 WHERE file_hash = ?', [
      fileHash,
    ]);
  } catch (err) {
    throw new NotaryError(
      500,
      'DATABASE_ERROR',
      'Failed to revoke notary record'
    );
  }
}

/**
 * Return paginated list of notarizations.
 * @param {number} page   1-based
 * @param {number} limit  records per page
 * @returns {{ records: object[], total: number, page: number, limit: number }}
 */
export async function listNotarizations(page = 1, limit = 20) {
  await _init;

  const offset = (page - 1) * limit;

  let rows;
  let countRow;
  try {
    [rows, countRow] = await Promise.all([
      db.all(
        'SELECT * FROM notary_records ORDER BY timestamp DESC LIMIT ? OFFSET ?',
        [limit, offset]
      ),
      db.get('SELECT COUNT(*) as total FROM notary_records'),
    ]);
  } catch (err) {
    throw new NotaryError(
      500,
      'DATABASE_ERROR',
      'Failed to list notary records'
    );
  }

  return {
    records: rows.map((r) => ({
      fileHash: r.file_hash,
      owner: r.owner,
      timestamp: r.timestamp,
      metadata: r.metadata,
      verified: r.verified === 1,
      recordId: r.record_id,
      status: r.verified === 1 ? 'active' : 'revoked',
    })),
    total: countRow?.total ?? 0,
    page,
    limit,
  };
}
