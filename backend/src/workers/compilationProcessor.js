// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { compileContract } from '../services/compileService.js';
import { getWss } from '../websocket.js';

class JobError extends Error {
  constructor(
    message,
    { retryable = true, code = 'UNKNOWN', details = null } = {}
  ) {
    super(message);
    this.name = 'JobError';
    this.retryable = retryable;
    this.code = code;
    this.details = details;
  }
}

function trySendWsMessage(payload) {
  try {
    const wss = getWss();
    if (wss && wss.clients) {
      const message = JSON.stringify(payload);
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    }
  } catch {
    // WS notification is best-effort
  }
}

/**
 * Sandboxed processor for asynchronous WASM compilation.
 * Runs in background worker pool.
 */
export default async function compilationProcessor(job) {
  const startTime = Date.now();
  console.log(
    `[Compilation Worker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1})`
  );

  const { source, contractName = 'soroban_contract' } = job.data;

  if (!source || typeof source !== 'string' || !source.trim()) {
    throw new JobError('Compilation job missing required "source" payload.', {
      retryable: false,
      code: 'MISSING_SOURCE',
    });
  }

  try {
    await job.updateProgress(10);

    const result = await compileContract({ source, contractName });

    await job.updateProgress(80);

    trySendWsMessage({
      type: 'compilation:completed',
      jobId: job.id,
      status: 'completed',
      wasmUrl: result.wasmUrl,
      hash: result.hash,
    });

    await job.updateProgress(100);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Compilation Worker] Job ${job.id} compiled successfully in ${durationMs}ms.`
    );
    return {
      success: true,
      jobId: job.id,
      hash: result.hash,
      wasmUrl: result.wasmUrl,
      sizeBytes: result.sizeBytes,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(
      `[Compilation Worker] Job ${job.id} failed after ${durationMs}ms:`,
      err.message
    );

    trySendWsMessage({
      type: 'compilation:failed',
      jobId: job.id,
      status: 'failed',
      error: err.message,
    });

    throw err;
  }
}

export { JobError };
