// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { v } from '../utils/schemaValidator.js';

export const authLoginSchema = v.object({
  email: v.string().required().email(),
  password: v.string().required().min(8).max(128),
});

export const authRegisterSchema = v.object({
  username: v
    .string()
    .required()
    .min(3)
    .max(50)
    .pattern(
      /^[a-zA-Z0-9_-]+$/,
      'username may only contain letters, numbers, underscores, and hyphens'
    ),
  email: v.string().required().email(),
  password: v.string().required().min(8).max(128),
  role: v.string().optional().oneOf(['user', 'admin']).default('user'),
});

export const templateCreateSchema = v.object({
  name: v.string().required().min(1).max(100),
  description: v.string().optional().max(500).default(''),
  content: v.string().required().min(1),
  category: v.string().optional().max(50).default('general'),
});

export const templateUpdateSchema = v.object({
  name: v.string().optional().min(1).max(100),
  description: v.string().optional().max(500),
  content: v.string().optional().min(1),
  category: v.string().optional().max(50),
});

export const projectCreateSchema = v.object({
  name: v.string().required().min(1).max(100),
  description: v.string().optional().max(1000).default(''),
  contract_address: v.string().optional().max(80),
  network: v
    .string()
    .optional()
    .oneOf(['mainnet', 'testnet', 'futurenet'])
    .default('testnet'),
});

export const projectUpdateSchema = v.object({
  name: v.string().optional().min(1).max(100),
  description: v.string().optional().max(1000),
  contract_address: v.string().optional().max(80),
  network: v.string().optional().oneOf(['mainnet', 'testnet', 'futurenet']),
});

export const querySchema = v.object({
  limit: v.number().optional().coerce().integer().min(1).max(200).default(20),
  offset: v.number().optional().coerce().integer().min(0).default(0),
  sort: v.string().optional().oneOf(['asc', 'desc']).default('desc'),
  search: v.string().optional().max(200),
});

export const syncBatchSchema = v.object(
  {
    entries: v.string().optional(),
  },
  { strict: false }
);


/**
 * Workspace cloud sync payload (multi-file contracts).
 * The `workspace` document is a free-form map of editor state keyed by
 * canonical keys (`openFiles`, `activeFile`, `files`, …). Validation of the
 * inner document happens in `workspaceService.js` so the schema keeps
 * the outer envelope loose and the service enforces the canonical shape.
 */
export const workspaceSyncSchema = v.object(
  {
    favorites: v.array().optional(),
    history: v.array().optional(),
    workspace: v.object().optional(),
    updatedAt: v.number().optional(),
    deviceId: v.string().optional().max(64),
    baseRevision: v.number().optional().integer().min(0),
  },
  { strict: false }
);
