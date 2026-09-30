// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execFileAsync = promisify(execFile);

/**
 * Parse stellar contract read output (XDR key=value lines) into an object.
 * Falls back gracefully if CLI is unavailable.
 */
function parseLedgerEntries(stdout) {
  const entries = {};
  if (!stdout) return entries;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Format: "<key>": <value>   OR  key=value
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim().replace(/^"|"$/g, '');
      const rawVal = trimmed.slice(eqIdx + 1).trim();
      try {
        entries[key] = JSON.parse(rawVal);
      } catch {
        entries[key] = rawVal;
      }
    }
  }
  return entries;
}

/**
 * GET /api/storage/:contractId
 * Returns contract storage entries for the given contract ID.
 * Uses stellar CLI when available; returns demo data otherwise.
 */
router.get('/:contractId', async (req, res) => {
  const { contractId } = req.params;
  const network = req.query.network || 'testnet';

  if (!contractId || !/^C[A-Z0-9]{55}$/.test(contractId)) {
    return res.status(400).json({
      success: false,
      error:
        'Invalid contract ID. Must be a 56-character Stellar contract address starting with C.',
    });
  }

  try {
    const { stdout } = await execFileAsync(
      'stellar',
      [
        'contract',
        'read',
        '--id',
        contractId,
        '--network',
        network,
        '--output',
        'json',
      ],
      { timeout: 15000 }
    );

    let storage = {};
    try {
      storage = JSON.parse(stdout);
    } catch {
      storage = parseLedgerEntries(stdout);
    }

    return res.json({ success: true, data: { contractId, network, storage } });
  } catch (err) {
    // CLI not available or contract not found — return structured error
    const notFound = err.stderr && err.stderr.includes('not found');
    if (notFound) {
      return res.status(404).json({
        success: false,
        error: `Contract ${contractId} not found on ${network}.`,
      });
    }

    // CLI unavailable: return empty storage with a warning
    if (err.code === 'ENOENT') {
      return res.json({
        success: true,
        data: {
          contractId,
          network,
          storage: {},
          warning: 'Stellar CLI not available.',
        },
      });
    }

    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
