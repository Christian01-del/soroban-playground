// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Tests for queueService priority tiers, DLQ management API, and queue
 * metrics (#1577).
 */

import { jest } from '@jest/globals';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQueueAdd = jest.fn();
const mockQueueGetJob = jest.fn();
const mockQueueGetJobs = jest.fn();
const mockQueueGetJobCounts = jest.fn();
const mockQueueClose = jest.fn();
const mockJobRemove = jest.fn();
const mockWorkerClose = jest.fn();
const mockFlowProducerAdd = jest.fn();
const mockFlowProducerClose = jest.fn();

class MockQueue {
  constructor(name, opts) {
    this.name = name;
    this.opts = opts;
    this.add = mockQueueAdd;
    this.getJob = mockQueueGetJob;
    this.getJobs = mockQueueGetJobs;
    this.getJobCounts = mockQueueGetJobCounts;
    this.close = mockQueueClose;
    this.on = jest.fn();
  }
}

class MockWorker {
  constructor(name, processor, opts) {
    this.name = name;
    this.opts = opts;
    this.close = mockWorkerClose;
    this.on = jest.fn();
  }
}

class MockFlowProducer {
  constructor() {
    this.add = mockFlowProducerAdd;
    this.close = mockFlowProducerClose;
    this.on = jest.fn();
  }
}

jest.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  FlowProducer: MockFlowProducer,
}));

jest.mock('ioredis', () => {
  const mockQuit = jest.fn();
  function MockRedis(url, opts) {
    this.url = url;
    this.opts = opts;
    this.quit = mockQuit;
    this.on = function () {};
  }
  return { __esModule: true, default: MockRedis, Redis: MockRedis, mockQuit };
});

jest.mock('@bull-board/api', () => ({
  createBullBoard: jest.fn(() => ({ setQueues: jest.fn() })),
}));

jest.mock('@bull-board/api/bullMQAdapter', () => ({
  BullMQAdapter: class {
    constructor(q) {
      this.q = q;
    }
  },
}));

jest.mock('@bull-board/express', () => ({
  ExpressAdapter: class {
    constructor() {
      this.basePath = '';
    }
    setBasePath(p) {
      this.basePath = p;
    }
    getRouter() {
      return { isBullBoardRouter: true };
    }
  },
}));

// Also mock bullmqDlqService so DLQ helpers work in unit tests
jest.mock('../src/services/bullmqDlqService.js', () => ({
  getDlqQueueName: (name) => `${name}-dlq`,
  routeFailedJobToDlq: jest.fn(),
  replayDlqJobs: jest.fn(async ({ sourceQueue, dlqQueue, limit }) => {
    const jobs = await dlqQueue.getJobs();
    const replayed = [];
    for (const job of jobs.slice(0, limit)) {
      const newJob = await sourceQueue.add(
        job.name,
        job.data?.data ?? job.data
      );
      await job.remove();
      replayed.push({ dlqJobId: job.id, replayedJobId: newJob.id });
    }
    return replayed;
  }),
}));

// ─── Import module under test ─────────────────────────────────────────────────

const queueService = await import('../src/services/queueService.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initQueues() {
  // Clear any previously-set queue/worker state
  for (const k of Object.keys(queueService.queues)) delete queueService.queues[k];
  for (const k of Object.keys(queueService.workers)) delete queueService.workers[k];
  process.env.NODE_ENV = 'test';
  queueService.initializeQueues();
}

// ─── Priority tiers (#1577) ───────────────────────────────────────────────────

describe('JOB_PRIORITY tiers', () => {
  it('exports CRITICAL < HIGH < NORMAL < LOW numeric priorities', () => {
    const { JOB_PRIORITY } = queueService;
    expect(JOB_PRIORITY.CRITICAL).toBeLessThan(JOB_PRIORITY.HIGH);
    expect(JOB_PRIORITY.HIGH).toBeLessThan(JOB_PRIORITY.NORMAL);
    expect(JOB_PRIORITY.NORMAL).toBeLessThan(JOB_PRIORITY.LOW);
  });
});

describe('addCompilationJob / addDeploymentJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initQueues();
  });

  it('addCompilationJob uses HIGH priority by default', async () => {
    mockQueueAdd.mockResolvedValue({ id: 'c1' });
    await queueService.addCompilationJob('compile-wasm', { source: 'code' });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'compile-wasm',
      { source: 'code' },
      expect.objectContaining({ priority: queueService.JOB_PRIORITY.HIGH })
    );
  });

  it('addCompilationJob respects CRITICAL tier', async () => {
    mockQueueAdd.mockResolvedValue({ id: 'c2' });
    await queueService.addCompilationJob('urgent', { source: '...' }, 'CRITICAL');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'urgent',
      { source: '...' },
      expect.objectContaining({ priority: queueService.JOB_PRIORITY.CRITICAL })
    );
  });

  it('addDeploymentJob uses NORMAL priority by default', async () => {
    mockQueueAdd.mockResolvedValue({ id: 'd1' });
    await queueService.addDeploymentJob('deploy-contract', { wasmPath: '/a' });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'deploy-contract',
      { wasmPath: '/a' },
      expect.objectContaining({ priority: queueService.JOB_PRIORITY.NORMAL })
    );
  });

  it('addDeploymentJob respects LOW tier', async () => {
    mockQueueAdd.mockResolvedValue({ id: 'd2' });
    await queueService.addDeploymentJob('batch-deploy', {}, 'LOW');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'batch-deploy',
      {},
      expect.objectContaining({ priority: queueService.JOB_PRIORITY.LOW })
    );
  });
});

// ─── DLQ inspection API (#1577) ───────────────────────────────────────────────

describe('getDlqJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initQueues();
  });

  it('returns formatted DLQ job descriptors', async () => {
    const fakeDlqJob = {
      id: 'dlq-1',
      name: 'compile-wasm',
      data: {
        originalQueue: 'compilation',
        originalJobId: 'orig-1',
        failure: {
          failedReason: 'timeout',
          attemptsMade: 3,
          failedAt: '2026-01-01T00:00:00.000Z',
          stacktrace: ['Error: timeout'],
        },
      },
      opts: { attempts: 1 },
      failedReason: 'timeout',
      attemptsMade: 3,
    };
    mockQueueGetJobs.mockResolvedValue([fakeDlqJob]);

    const jobs = await queueService.getDlqJobs('compilation');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'dlq-1',
      originalQueue: 'compilation',
      originalJobId: 'orig-1',
      failedReason: 'timeout',
      attemptsMade: 3,
    });
  });

  it('throws for an unsupported queue name', async () => {
    await expect(queueService.getDlqJobs('nonexistent')).rejects.toThrow(
      /not found/
    );
  });
});

describe('deleteDlqJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initQueues();
  });

  it('removes the job and returns { removed: true }', async () => {
    const fakeJob = { id: 'dlq-del-1', name: 'compile', data: {}, remove: mockJobRemove };
    mockQueueGetJob.mockResolvedValue(fakeJob);
    mockJobRemove.mockResolvedValue(undefined);

    const result = await queueService.deleteDlqJob('compilation', 'dlq-del-1');

    expect(mockJobRemove).toHaveBeenCalled();
    expect(result).toEqual({ removed: true, id: 'dlq-del-1' });
  });

  it('throws when the DLQ job is not found', async () => {
    mockQueueGetJob.mockResolvedValue(null);
    await expect(
      queueService.deleteDlqJob('compilation', 'ghost-id')
    ).rejects.toThrow(/not found/);
  });
});

// ─── getQueueMetrics (#1577) ──────────────────────────────────────────────────

describe('getQueueMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initQueues();
  });

  it('returns job counts for all queues', async () => {
    const fakeCounts = { waiting: 2, active: 1, completed: 10, failed: 0, delayed: 0 };
    mockQueueGetJobCounts.mockResolvedValue(fakeCounts);

    const metrics = await queueService.getQueueMetrics();

    // All defined queues should be present
    expect(metrics).toHaveProperty('compilation');
    expect(metrics).toHaveProperty('deployment');
    expect(metrics).toHaveProperty('compilationDlq');
    expect(metrics.compilation).toEqual(fakeCounts);
  });

  it('reports { error: "unavailable" } for queues that throw', async () => {
    mockQueueGetJobCounts.mockRejectedValue(new Error('Redis offline'));
    const metrics = await queueService.getQueueMetrics();
    for (const val of Object.values(metrics)) {
      expect(val).toEqual({ error: 'unavailable' });
    }
  });
});
