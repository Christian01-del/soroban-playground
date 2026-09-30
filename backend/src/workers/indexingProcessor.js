// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import contractEventIndexer from '../services/contractEventIndexer.js';

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

/**
 * Sandboxed processor for contract event indexing.
 * Runs in a separate process.
 */
export default async function indexingProcessor(job) {
  const startTime = Date.now();
  console.log(
    `[Indexing Worker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1})`
  );

  try {
    await job.updateProgress(10);

    if (!contractEventIndexer._db.db) {
      await contractEventIndexer._db.connect();
    }

    await job.updateProgress(30);

    await contractEventIndexer._poll();

    await job.updateProgress(100);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Indexing Worker] Job ${job.id} completed successfully in ${durationMs}ms`
    );
    return { success: true, polled: true, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(
      `[Indexing Worker] Job ${job.id} failed after ${durationMs}ms:`,
      err.message
    );

    if (err instanceof JobError && !err.retryable) {
      console.error(
        `[Indexing Worker] Job ${job.id} has non-retryable error (${err.code}), will not retry`
      );
    }

    throw err;
  }
}

export { JobError };
