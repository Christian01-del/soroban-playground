// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Batch-friendly data access for the `files` table.
// `getFilesByProjectIds` and `getFilesByTemplateIds` issue a single SQL query
// for N parent ids and group rows in JS — the core pattern that lets DataLoader
// collapse an N+1 fan-out into 2 total queries (issue #724).
//
// FE-EPIC-05: also exposes the virtual in-memory multi-file workspace helpers
// used by the dynamic tree explorer. Workspace files are addressed by a stable
// `path` (e.g. `src/lib.rs`) so tabs, drag-and-drop imports and the tree can
// stay in sync without re-querying the database on every keystroke.

import { getDatabase } from '../database/connection.js';

const WORKSPACE_ROOT = 'src';
const DEFAULT_WORKSPACE_FILES = [
  { path: 'src/lib.rs', language: 'rust', content: '// lib.rs\n' },
  { path: 'src/types.rs', language: 'rust', content: '// types.rs\n' },
  { path: 'src/storage.rs', language: 'rust', content: '// storage.rs\n' },
];

function normalizePath(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/\\/g, '/');
  if (!trimmed) return null;
  const segments = trimmed.split('/').filter((s) => s && s !== '.');
  if (!segments.length) return null;
  if (segments.some((s) => s === '..')) return null;
  return segments.join('/');
}

function shapeWorkspaceFile(row) {
  if (!row) return null;
  return {
    path: row.path,
    language: row.language ?? 'rust',
    content: row.content ?? '',
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * Builds the default in-memory workspace for a project. Pure function so it
 * can be unit-tested without a database and reused by the tree explorer.
 */
export function createDefaultWorkspace() {
  return DEFAULT_WORKSPACE_FILES.map((file) => ({ ...file }));
}

/**
 * Validates a workspace file descriptor before it is persisted or imported.
 * Returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
export function validateWorkspaceFile(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: 'file must be an object' };
  }
  const path = normalizePath(file.path);
  if (!path) {
    return { ok: false, error: 'file.path must be a non-empty relative path' };
  }
  if (typeof file.content !== 'string') {
    return { ok: false, error: 'file.content must be a string' };
  }
  return {
    ok: true,
    value: {
      path,
      language: typeof file.language === 'string' ? file.language : 'rust',
      content: file.content,
    },
  };
}

/**
 * Returns the workspace files for a project, falling back to the default
 * multi-file contract when no rows have been persisted yet.
 */
export async function getWorkspaceFiles(projectId) {
  const db = getDatabase();
  const rows = await db.all(
    'SELECT * FROM workspace_files WHERE project_id = ? ORDER BY path ASC',
    [projectId]
  );
  if (!rows.length) return createDefaultWorkspace();
  return rows.map(shapeWorkspaceFile);
}

/**
 * Upserts a single workspace file. Returns the shaped file.
 */
export async function upsertWorkspaceFile(projectId, file) {
  const result = validateWorkspaceFile(file);
  if (!result.ok) throw new Error(result.error);
  const { path, language, content } = result.value;
  const db = getDatabase();
  await db.run(
    `INSERT INTO workspace_files (project_id, path, language, content, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(project_id, path) DO UPDATE SET
       language = excluded.language,
       content = excluded.content,
       updated_at = CURRENT_TIMESTAMP`,
    [projectId, path, language, content]
  );
  return { path, language, content, updatedAt: new Date().toISOString() };
}

/**
 * Deletes a workspace file by path. Returns true when a row was removed.
 */
export async function deleteWorkspaceFile(projectId, filePath) {
  const path = normalizePath(filePath);
  if (!path) return false;
  const db = getDatabase();
  const result = await db.run(
    'DELETE FROM workspace_files WHERE project_id = ? AND path = ?',
    [projectId, path]
  );
  return (result?.changes ?? 0) > 0;
}

/**
 * Builds a nested tree structure from a flat list of workspace files.
 * Used by the dynamic tree explorer to render folders and leaves.
 */
export function buildWorkspaceTree(files) {
  const root = { name: WORKSPACE_ROOT, path: '', type: 'directory', children: [] };
  const dirs = new Map([['', root]]);
  for (const file of files ?? []) {
    const path = normalizePath(file.path);
    if (!path) continue;
    const segments = path.split('/');
    let parentPath = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      const currentPath = parentPath ? `${parentPath}/${segment}` : segment;
      if (!dirs.has(currentPath)) {
        const dir = { name: segment, path: currentPath, type: 'directory', children: [] };
        dirs.set(currentPath, dir);
        dirs.get(parentPath).children.push(dir);
      }
      parentPath = currentPath;
    }
    dirs.get(parentPath).children.push({
      name: segments[segments.length - 1],
      path,
      type: 'file',
      language: file.language ?? 'rust',
    });
  }
  return root;
}

function shapeFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    templateId: row.template_id ?? null,
    uploaderId: row.uploader_id,
    filename: row.filename,
    filepath: row.filepath,
    mimetype: row.mimetype,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

/**
 * Returns all files ordered by id. Single SQL query.
 */
export async function listFiles() {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM files ORDER BY id ASC');
  return rows.map(shapeFile);
}

/**
 * Batch-loads workspace files for many projects in a single SQL query.
 * Returns a Map<projectId, WorkspaceFile[]>; projects without persisted rows
 * receive the default multi-file contract so the tree explorer always renders.
 */
export async function getWorkspaceFilesByProjectIds(projectIds) {
  if (!projectIds.length) return new Map();
  const placeholders = projectIds.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM workspace_files WHERE project_id IN (${placeholders}) ORDER BY path ASC`,
    projectIds
  );
  const byProject = new Map();
  for (const id of projectIds) byProject.set(String(id), []);
  for (const row of rows) {
    const list = byProject.get(String(row.project_id));
    if (list) list.push(shapeWorkspaceFile(row));
  }
  for (const [id, list] of byProject) {
    if (!list.length) byProject.set(id, createDefaultWorkspace());
  }
  return byProject;
}

/**
 * Batch-loads files by id. One SQL query regardless of how many ids are passed.
 * Returns a Map<number, file> keyed by file id.
 */
export async function getFilesByIds(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM files WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map();
  for (const row of rows) {
    byId.set(String(row.id), shapeFile(row));
  }
  return byId;
}

/**
 * Returns a Map<projectId, File[]> from a single SQL query.
 * Parents with no files get an empty array entry, so DataLoader returns `[]`
 * (not null) to GraphQL -- matching the `files: [File!]!` schema contract.
 */
export async function getFilesByProjectIds(projectIds) {
  if (!projectIds.length) return new Map();
  const placeholders = projectIds.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM files WHERE project_id IN (${placeholders}) ORDER BY id ASC`,
    projectIds
  );
  const byProject = new Map();
  for (const id of projectIds) byProject.set(String(id), []);
  for (const row of rows) {
    const shaped = shapeFile(row);
    const list = byProject.get(String(row.project_id));
    if (list) list.push(shaped);
  }
  return byProject;
}

/**
 * Returns a Map<templateId, File[]> from a single SQL query.
 */
export async function getFilesByTemplateIds(templateIds) {
  if (!templateIds.length) return new Map();
  const placeholders = templateIds.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM files WHERE template_id IN (${placeholders}) ORDER BY id ASC`,
    templateIds
  );
  const byTemplate = new Map();
  for (const id of templateIds) byTemplate.set(String(id), []);
  for (const row of rows) {
    const shaped = shapeFile(row);
    const list = byTemplate.get(String(row.template_id));
    if (list) list.push(shaped);
  }
  return byTemplate;
}
