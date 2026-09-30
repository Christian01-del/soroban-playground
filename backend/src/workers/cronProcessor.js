// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Sandboxed processor for cron / recurring maintenance tasks.
 * Runs in a separate process.
 */
export default async function cronProcessor(job) {
  const startTime = Date.now();
  console.log(
    `[Cron Worker] Processing job ${job.id} - task name: ${job.name}`
  );

  try {
    await job.updateProgress(10);

    console.log(`[Cron Worker] Executing cleanup/maintenance tasks`);

    await job.updateProgress(50);
    await new Promise((resolve) => setTimeout(resolve, 500));

    await job.updateProgress(100);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Cron Worker] Cleanup/maintenance completed successfully in ${durationMs}ms`
    );
    return { success: true, timestamp: new Date().toISOString(), durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(
      `[Cron Worker] Job ${job.id} failed after ${durationMs}ms:`,
      err.message
    );
    throw err;
  }
}
