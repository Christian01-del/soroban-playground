// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { getDatabase } from '../database/connection.js';
import { normalizeOrigin } from '../config/cors.js';

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

// In-memory snapshot of the active whitelist consulted on every request by the
// CORS policy. Refreshed on an interval and immediately after admin changes,
// so updates apply without a restart (and propagate across instances within
// one refresh interval).
let cachedOrigins = [];
let refreshTimer = null;

export function getCachedOrigins() {
  return cachedOrigins;
}

export async function refreshOriginCache() {
  try {
    cachedOrigins = await loadActiveOrigins();
  } catch (err) {
    // Keep the last known list if the database is unavailable.
    console.warn('[CORS] Failed to refresh origin whitelist:', err.message);
  }
  return cachedOrigins;
}

export function startOriginCacheRefresh(
  intervalMs = Number(process.env.CORS_WHITELIST_REFRESH_MS) ||
    DEFAULT_REFRESH_INTERVAL_MS
) {
  stopOriginCacheRefresh();
  refreshTimer = setInterval(refreshOriginCache, intervalMs);
  if (refreshTimer.unref) refreshTimer.unref();
  return refreshOriginCache();
}

export function stopOriginCacheRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

export async function listOrigins() {
  const db = getDatabase();
  return db.all(
    'SELECT id, origin, added_by, created_at FROM cors_whitelist WHERE active = 1 ORDER BY created_at DESC'
  );
}

export async function addOrigin(rawOrigin, addedBy = null) {
  const origin = normalizeOrigin(rawOrigin);
  const db = getDatabase();
  await db.run(
    `INSERT INTO cors_whitelist (origin, added_by)
     VALUES (?, ?)
     ON CONFLICT(origin) DO UPDATE SET active = 1, added_by = excluded.added_by`,
    [origin, addedBy]
  );
  const entry = await db.get('SELECT * FROM cors_whitelist WHERE origin = ?', [
    origin,
  ]);
  await refreshOriginCache();
  return entry;
}

export async function removeOrigin(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const db = getDatabase();
  const { changes } = await db.run(
    'UPDATE cors_whitelist SET active = 0 WHERE origin = ? AND active = 1',
    [origin]
  );
  if (changes > 0) await refreshOriginCache();
  return changes > 0;
}

// Loads the active origin list for use in dynamic CORS validation
export async function loadActiveOrigins() {
  const db = getDatabase();
  const rows = await db.all(
    'SELECT origin FROM cors_whitelist WHERE active = 1'
  );
  return rows.map((r) => r.origin);
}
