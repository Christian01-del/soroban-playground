// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Zod schemas for the core compile / deploy / invoke API (issue #1573).
// Extended for the Pre-Flight Simulation Engine (issue FE-EPIC-18):
// simulate / profile / gas-estimation request validation.
//
// Zod schemas for the core compile / deploy / invoke API (issue #1573).
//
// z.object() strips unknown keys by default, so anything a client sends that
// is not listed here never reaches a handler — this is the mass-assignment
// defence. Nested free-form maps (invoke args, compile dependencies) are
// checked for dangerous keys by rejectPrototypePollution() in validation.js.

import { z } from 'zod';

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Stellar StrKey contract IDs: 'C' + 55 base32 characters.
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
// Stellar StrKey account IDs: 'G' + 55 base32 characters.
const ACCOUNT_ID_RE = /^G[A-Z2-7]{55}$/;
const NETWORK_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
// Identity alias (stellar keys) or a G/S StrKey — never a CLI flag.
const SOURCE_ACCOUNT_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$/;
const MAX_BATCH_SIZE = 20;

function requiredString(field, message) {
  return z.string({
    required_error: `${field} is required`,
    invalid_type_error: message || `${field} must be a string`,
  });
}

function optionalString(field, message) {
  return z
    .string({ invalid_type_error: message || `${field} must be a string` })
    .nullish()
    .transform((v) => v ?? undefined);
}

const optional = (schema) => schema.nullish().transform((v) => v ?? undefined);

export const contractId = (field = 'contractId') =>
  requiredString(field, `${field} must be a valid Stellar contract ID`).regex(
    CONTRACT_ID_RE,
    `${field} must be a valid Stellar contract ID`
  );

export const functionName = (field = 'functionName') =>
  requiredString(field, `${field} must be a valid identifier`)
    .max(64, `${field} must be at most 64 characters`)
    .regex(IDENTIFIER_RE, `${field} must be a valid identifier`);

export const network = (field = 'network') =>
  z
    .string({ invalid_type_error: `${field} must be a string` })
    .regex(NETWORK_RE, `${field} must be a valid network name`);

export const sourceAccount = (field = 'sourceAccount') =>
  z
    .string({ invalid_type_error: `${field} must be a string` })
    .regex(
      SOURCE_ACCOUNT_RE,
      `${field} must be an identity name or public key`
    );

export const invokeArgs = z
  .record(
    z.string().regex(IDENTIFIER_RE, 'args keys must be valid identifiers'),
    z.unknown(),
    { invalid_type_error: 'args must be an object' }
  )
  .refine((value) => Object.keys(value).length <= 64, {
    message: 'args may contain at most 64 entries',
  });

// XDR-encoded ScVal arguments (base64) — used by the pre-flight simulator
// when the client already holds serialized invocation data.
export const xdrArgs = z
  .array(
    z
      .string({ invalid_type_error: 'xdrArgs must be an array of strings' })
      .min(1, 'xdrArgs entries must not be empty')
      .max(65536, 'xdrArgs entries must be at most 65536 characters'),
    { invalid_type_error: 'xdrArgs must be an array of strings' }
  )
  .max(64, 'xdrArgs may contain at most 64 entries');

const wasmPath = (field) =>
  requiredString(field)
    .min(1, `${field} is required`)
    .max(1024, `${field} must be at most 1024 characters`)
    .refine((value) => !value.includes('\0'), {
      message: `${field} must not contain NUL bytes`,
    });

const contractName = (field) =>
  requiredString(field)
    .min(1, `${field} is required`)
    .max(128, `${field} must be at most 128 characters`);

// ── Invoke ──────────────────────────────────────────────────────────────────

export const invokeBodyV1 = z.object({
  contractId: contractId('contractId'),
  functionName: functionName('functionName'),
  args: optional(invokeArgs),
  network: optional(network('network')),
  sourceAccount: optional(sourceAccount('sourceAccount')),
});

export const invokeBodyV2 = z.object({
  contract_id: contractId('contract_id'),
  function_name: functionName('function_name'),
  args: optional(invokeArgs),
  network: optional(network('network')),
  source_account: optional(sourceAccount('source_account')),
});

// ── Deploy ──────────────────────────────────────────────────────────────────

export const deployBodyV1 = z.object({
  wasmPath: wasmPath('wasmPath'),
  contractName: contractName('contractName'),
  network: optional(network('network')),
  sourceAccount: optional(sourceAccount('sourceAccount')),
});

export const deployBodyV2 = z.object({
  wasm_path: wasmPath('wasm_path'),
  contract_name: contractName('contract_name'),
  network: optional(network('network')),
});

const batchIdSchema = optional(
  z
    .string({ invalid_type_error: 'batchId must be a string' })
    .regex(/^[a-zA-Z0-9_-]{1,64}$/, 'batchId must be a valid identifier')
);

const nonEmptyBatch = (item) =>
  z
    .array(item, {
      required_error: 'contracts must be a non-empty array',
      invalid_type_error: 'contracts must be a non-empty array',
    })
    .min(1, 'contracts must be a non-empty array')
    .max(
      MAX_BATCH_SIZE,
      `contracts may contain at most ${MAX_BATCH_SIZE} items`
    );

export const deployBatchBodyV1 = z.object({
  batchId: batchIdSchema,
  contracts: nonEmptyBatch(
    z.object({
      id: optional(z.string().max(128)),
      contractName: optional(z.string().max(128)),
      wasmPath: optional(z.string().max(1024)),
      network: optional(network('network')),
      sourceAccount: optional(sourceAccount('sourceAccount')),
    })
  ),
});

export const deployBatchBodyV2 = z.object({
  batch_id: batchIdSchema,
  contracts: nonEmptyBatch(
    z.object({
      contract_name: optional(z.string().max(128)),
      wasm_path: optional(z.string().max(1024)),
    })
  ),
});

// ── Compile ─────────────────────────────────────────────────────────────────
// Source size and dependency contents are enforced by the handlers
// (config.compile.maxSourceBytes / sanitizeDependenciesInput); the schemas
// pin the accepted shape and drop everything else.

const sourceField = optional(
  z.string({ invalid_type_error: 'code must be a string' })
);
const dependenciesField = optional(
  z.record(z.string(), z.unknown(), {
    invalid_type_error: 'dependencies must be an object',
  })
);

export const compileBody = z.object({
  code: sourceField,
  source: sourceField,
  sourceCode: sourceField,
  contractName: optional(z.string().max(128)),
  dependencies: dependenciesField,
});

export const compileBatchBody = z.object({
  contracts: z
    .array(
      z.object({
        code: sourceField,
        dependencies: dependenciesField,
      }),
      {
        required_error: 'contracts must be a non-empty array',
        invalid_type_error: 'contracts must be a non-empty array',
      }
    )
    .min(1, 'contracts must be a non-empty array'),
});

export const jobIdParams = z.object({
  jobId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,128}$/, 'jobId must be a valid job identifier'),
});

// ── Pre-Flight Simulation (FE-EPIC-18) ──────────────────────────────────────
// Simulation runs a contract invocation against an RPC node without
// submitting it, returning CPU instruction counts, RAM footprint, ledger
// entry read/write counts and a fee estimate. The schemas below validate
// the request envelope; the resource breakdown itself is produced by the
// simulation handler and validated by simulationResultSchema.

const footprintMode = z
  .enum(['enforce', 'record', 'record_allow_non_root'], {
    invalid_type_error:
      'footprintMode must be one of enforce, record, record_allow_non_root',
  });

const resourceLeeway = z
  .number({ invalid_type_error: 'resourceLeeway must be a number' })
  .int('resourceLeeway must be an integer')
  .min(0, 'resourceLeeway must be >= 0')
  .max(1_000_000_000, 'resourceLeeway is too large');

const authMode = z.enum(['enforce', 'record', 'record_allow_non_root'], {
  invalid_type_error:
    'authMode must be one of enforce, record, record_allow_non_root',
});

export const simulateBodyV1 = z.object({
  contractId: contractId('contractId'),
  functionName: functionName('functionName'),
  args: optional(invokeArgs),
  xdrArgs: optional(xdrArgs),
  network: optional(network('network')),
  sourceAccount: optional(sourceAccount('sourceAccount')),
  footprintMode: optional(footprintMode),
  authMode: optional(authMode),
  resourceLeeway: optional(resourceLeeway),
  // When true the handler returns the raw diagnostic events alongside the
  // aggregated resource profile.
  includeDiagnostics: optional(z.boolean()),
});

export const simulateBodyV2 = z.object({
  contract_id: contractId('contract_id'),
  function_name: functionName('function_name'),
  args: optional(invokeArgs),
  xdr_args: optional(xdrArgs),
  network: optional(network('network')),
  source_account: optional(sourceAccount('source_account')),
  footprint_mode: optional(footprintMode),
  auth_mode: optional(authMode),
  resource_leeway: optional(resourceLeeway),
  include_diagnostics: optional(z.boolean()),
});

// ── Resource Profiler ───────────────────────────────────────────────────────
// Aggregated resource profile returned by the simulator. Used to validate
// handler output before it is persisted or streamed to the client.

export const resourceProfileSchema = z.object({
  cpuInsns: z.number().int().nonnegative(),
  memBytes: z.number().int().nonnegative(),
  ledgerEntriesRead: z.number().int().nonnegative(),
  ledgerEntriesWritten: z.number().int().nonnegative(),
  ledgerEntriesArchived: z.number().int().nonnegative().optional(),
  minResourceFee: z.string().regex(/^\d+$/, 'minResourceFee must be a uint64 string'),
  refundableFee: z.string().regex(/^\d+$/, 'refundableFee must be a uint64 string'),
  nonRefundableFee: z.string().regex(/^\d+$/, 'nonRefundableFee must be a uint64 string'),
  totalFee: z.string().regex(/^\d+$/, 'totalFee must be a uint64 string'),
});

export const simulationResultSchema = z.object({
  success: z.boolean(),
  latestLedger: z.number().int().nonnegative(),
  transactionData: z.string().optional(),
  events: z.array(z.string()).optional(),
  diagnostics: z.array(z.string()).optional(),
  error: z.string().optional(),
  profile: resourceProfileSchema.optional(),
});

// ── Gas Visualizer ──────────────────────────────────────────────────────────
// Historical gas / fee samples used to render the fee estimator chart.

export const gasHistoryQuery = z.object({
  contractId: contractId('contractId'),
  functionName: optional(functionName('functionName')),
  network: optional(network('network')),
  limit: optional(
    z
      .coerce
      .number({ invalid_type_error: 'limit must be a number' })
      .int('limit must be an integer')
      .min(1, 'limit must be >= 1')
      .max(500, 'limit must be <= 500')
  ),
  sinceLedger: optional(
    z
      .coerce
      .number({ invalid_type_error: 'sinceLedger must be a number' })
      .int('sinceLedger must be an integer')
      .nonnegative('sinceLedger must be >= 0')
  ),
});

export const gasEstimateBody = z.object({
  contractId: contractId('contractId'),
  functionName: functionName('functionName'),
  args: optional(invokeArgs),
  network: optional(network('network')),
  sourceAccount: optional(sourceAccount('sourceAccount')),
  // Optional override of the base fee (in stroops) used for the estimate.
  baseFee: optional(
    z
      .coerce
      .number({ invalid_type_error: 'baseFee must be a number' })
      .int('baseFee must be an integer')
      .min(0, 'baseFee must be >= 0')
  ),
  // Optional explicit account ID for fee-source simulation.
  feeSource: optional(
    z
      .string({ invalid_type_error: 'feeSource must be a string' })
      .regex(ACCOUNT_ID_RE, 'feeSource must be a valid Stellar account ID')
  ),
});
