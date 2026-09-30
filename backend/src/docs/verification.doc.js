// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @openapi
 * /api/verify/contracts:
 *   post:
 *     summary: Verify Soroban contract source
 *     description: Compiles the submitted Rust source (or accepts a bounded WASM artifact), hashes the exact bytes with SHA-256, and compares them with the deployed Soroban contract WASM.
 *     tags: [Contract Verification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerificationRequest'
 *     responses:
 *       200:
 *         description: Source compiled to the exact deployed WASM bytes
 *       202:
 *         description: Verification completed with a mismatch
 *       400:
 *         description: Invalid request
 *       422:
 *         description: Source compilation failed
 *       502:
 *         description: Soroban RPC lookup failed
 *
 * /api/verify/contracts/{id}:
 *   get:
 *     summary: Get verification status
 *     tags: [Contract Verification]
 *     parameters:
 *       - $ref: '#/components/parameters/VerificationId'
 *     responses:
 *       200:
 *         description: Verification status without source code
 *       404:
 *         description: Verification record not found
 *
 * /api/verify/contracts/{id}/source:
 *   get:
 *     summary: Get verified source record
 *     tags: [Contract Verification]
 *     parameters:
 *       - $ref: '#/components/parameters/VerificationId'
 *     responses:
 *       200:
 *         description: Stored source code and its source hash
 *
 * /api/verify/contracts/{id}/reverify:
 *   post:
 *     summary: Re-verify an existing source record
 *     tags: [Contract Verification]
 *     parameters:
 *       - $ref: '#/components/parameters/VerificationId'
 *     responses:
 *       200:
 *         description: Source matches the deployed WASM
 *       202:
 *         description: Verification completed with a mismatch
 *
 * /api/verify/contracts/search:
 *   get:
 *     summary: Search verification records
 *     tags: [Contract Verification]
 *     parameters:
 *       - in: query
 *         name: contractId
 *         schema: { type: string }
 *       - in: query
 *         name: network
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, verified, mismatch, failed] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200:
 *         description: Matching verification records without source code
 */
const verificationDocs = {};
export default verificationDocs;
