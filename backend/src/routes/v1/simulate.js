import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import sorobanRpcManager from '../../services/sorobanRpcManager.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import {
  buildMockAuthEnvelope,
  encodeMockAuthEnvelopeToXdr,
  validateMockAuthRequest,
} from '../../services/mockAuthEngine.js';

const router = express.Router();

// +15% safety buffer applied to resource bounds so submissions are not rejected
// for underestimating CPU / memory / storage requirements.
const SAFETY_BUFFER = 1.15;

function applySafetyBuffer(value) {
  return Math.ceil(value * SAFETY_BUFFER);
}

function parseSimulationDiagnostics(rpcResult) {
  const diagnostics = [];

  if (rpcResult.error) {
    const code = rpcResult.error.code;
    if (
      code === 'ERR_UNDERSIZED_RESOURCE_FEE' ||
      (code === '-32010' && /resource/.test(rpcResult.error.message || ''))
    ) {
      diagnostics.push(
        'Transaction was rejected because the declared resource fee is too low. Increase the fee before re-submitting.'
      );
    } else if (
      /host function|CPU|insufficient.*instruction|overflow/i.test(
        rpcResult.error.message || ''
      )
    ) {
      diagnostics.push(
        'The contract exceeded its CPU/resource budget during simulation. Reduce work per call or raise the resource bounds.'
      );
    }
  }

  const results = rpcResult.results || [];
  for (const result of results) {
    if (result.error) {
      const message = result.error.message || 'unknown error';
      if (/UnauthorizedError|Not authorized|auth/i.test(message)) {
        diagnostics.push(
          `Auth failed: the transaction requires authorization for: ${message}. Sign with the correct wallet before submitting.`
        );
      } else if (/VM|invalid|wasm|contract invoke/i.test(message)) {
        diagnostics.push(
          `Contract invocation error: ${message}. Verify the contract ID, arguments, and that the contract is deployed.`
        );
      } else {
        diagnostics.push(`Simulation error: ${message}`);
      }
    }
  }

  return diagnostics;
}

function estimateFallback(xdr) {
  const xdrLength = xdr.length;
  return {
    minResourceFee: String(1_000 + Math.ceil(xdrLength * 1.5)),
    cost: {
      cpuInsns: String(Math.min(10_000_000, 150_000 + xdrLength * 120)),
      memBytes: String(Math.min(5_000_000, 65_536 + xdrLength * 32)),
    },
    results: [{ auth: [], xdr }],
    events: [],
    latestLedger: 100000,
  };
}

async function callSimulateTransaction(xdr) {
  return await sorobanRpcManager.executeRpcCall(
    async (rpcUrl, options = {}) => {
      const { signal, ...extraHeaders } = options;

      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'simulateTransaction',
        params: { transaction: xdr },
      };

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        throw new Error(`RPC server returned status ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'Soroban RPC simulation error');
      }

      return data.result || {};
    }
  );
}

function applyMockAuthToResult(rpcResult, mockAuth) {
  if (!mockAuth) return rpcResult;
  const results = Array.isArray(rpcResult.results) ? rpcResult.results : [];
  if (results.length === 0) {
    return {
      ...rpcResult,
      results: [{ auth: mockAuth.entries, xdr: null }],
    };
  }
  return {
    ...rpcResult,
    results: results.map((result) => ({
      ...result,
      auth: mockAuth.entries,
    })),
  };
}

router.post(
  '/fee',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const {
      transactionXdr,
      transaction,
      network = 'testnet',
      mockAuth,
    } = req.body || {};
    const xdrToSimulate = transactionXdr || transaction;

    if (!xdrToSimulate || typeof xdrToSimulate !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'transactionXdr or transaction (base64 string) is required',
      });
    }

    let mockAuthEnvelope = null;
    if (mockAuth !== undefined) {
      const validationErrors = validateMockAuthRequest(mockAuth);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid mockAuth payload',
          details: validationErrors,
        });
      }
      try {
        mockAuthEnvelope = buildMockAuthEnvelope(mockAuth);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Failed to build mock authorization envelope',
          details: error.details || [error.message],
        });
      }
    }

    try {
      let rpcResult;
      try {
        rpcResult = await callSimulateTransaction(xdrToSimulate);
      } catch {
        rpcResult = estimateFallback(xdrToSimulate);
      }

      if (mockAuthEnvelope) {
        rpcResult = applyMockAuthToResult(rpcResult, mockAuthEnvelope);
      }

      const minResourceFee = String(
        rpcResult.minResourceFee || rpcResult.minFee || '1000'
      );
      const cpuInstructions = parseInt(
        rpcResult.cost?.cpuInsns || '150000',
        10
      );
      const memoryBytes = parseInt(rpcResult.cost?.memBytes || '65536', 10);
      const readCount = parseInt(rpcResult.readCount || '2', 10);
      const writeCount = parseInt(rpcResult.writeCount || '1', 10);
      const ledgerReadBytes = parseInt(rpcResult.ledgerReadBytes || '1024', 10);
      const ledgerWriteBytes = parseInt(
        rpcResult.ledgerWriteBytes || '512',
        10
      );

      const baseFee = 100;
      const estimatedTotalFee = String(parseInt(minResourceFee, 10) + baseFee);

      const bufferedResourceBounds = {
        cpuInstructions: applySafetyBuffer(cpuInstructions),
        memBytes: applySafetyBuffer(memoryBytes),
        ledgerReadBytes: applySafetyBuffer(ledgerReadBytes),
        ledgerWriteBytes: applySafetyBuffer(ledgerWriteBytes),
      };

      const diagnostics = parseSimulationDiagnostics(rpcResult);
      if (mockAuthEnvelope) {
        for (const diagnostic of mockAuthEnvelope.diagnostics) {
          diagnostics.push(diagnostic.message);
        }
      }

      return res.json({
        success: true,
        status: 'success',
        data: {
          network,
          minResourceFee,
          cpuInstructions,
          memoryBytes,
          ledgerReadBytes,
          ledgerWriteBytes,
          readCount,
          writeCount,
          estimatedTotalFee,
          resourceBounds: bufferedResourceBounds,
          diagnostics,
          transactionData: rpcResult.transactionData || null,
          eventsCount: Array.isArray(rpcResult.events)
            ? rpcResult.events.length
            : 0,
          latestLedger: rpcResult.latestLedger || null,
          mockAuth: mockAuthEnvelope
            ? {
                satisfied: mockAuthEnvelope.satisfied,
                mode: mockAuthEnvelope.mode,
                entries: mockAuthEnvelope.entries,
                authTree: mockAuthEnvelope.authTree,
                treeResult: mockAuthEnvelope.treeResult,
                generatedAt: mockAuthEnvelope.generatedAt,
                encoded: encodeMockAuthEnvelopeToXdr(mockAuthEnvelope),
              }
            : null,
        },
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Fee simulation failed', {
          details: error.message,
        })
      );
    }
  })
);

router.post(
  '/mock-auth',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const payload = req.body || {};
    const validationErrors = validateMockAuthRequest(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mock auth request',
        details: validationErrors,
      });
    }
    try {
      const envelope = buildMockAuthEnvelope(payload);
      return res.json({
        success: true,
        status: 'success',
        data: {
          ...envelope,
          encoded: encodeMockAuthEnvelopeToXdq(envelope),
        },
      });
    } catch (error) {
      return next(
        createHttpError(400, 'Mock auth generation failed', {
          details: error.details || [error.message],
        })
      );
    }
  })
);

export default router;
