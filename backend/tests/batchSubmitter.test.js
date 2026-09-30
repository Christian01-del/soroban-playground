// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import { BatchSubmitter } from '../src/services/batchSubmitter.js';
import { NoncePool, NoncePoolRegistry } from '../src/services/noncePool.js';
import batchRouter from '../src/routes/batchSubmitter.js';

// ── NoncePool unit tests ──────────────────────────────────────────────────────

describe('NoncePool', () => {
  it('initializes sequence from fetchFn on first acquire', async () => {
    const fetch = jest.fn().mockResolvedValue('1000');
    const pool = new NoncePool('GABC', fetch);
    const seq = await pool.acquire();
    expect(fetch).toHaveBeenCalledWith('GABC');
    expect(seq).toBe(1001n);
  });

  it('increments sequence atomically on each acquire', async () => {
    const fetch = jest.fn().mockResolvedValue('500');
    const pool = new NoncePool('GABC', fetch);
    const [s1, s2, s3] = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ]);
    const seqs = [s1, s2, s3].map(Number).sort((a, b) => a - b);
    expect(seqs).toEqual([501, 502, 503]);
  });

  it('only calls fetchFn once on repeated acquires', async () => {
    const fetch = jest.fn().mockResolvedValue('100');
    const pool = new NoncePool('GABC', fetch);
    await pool.acquire();
    await pool.acquire();
    await pool.acquire();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resyncs sequence from ledger on resync()', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('200');
    const pool = new NoncePool('GABC', fetch);
    await pool.acquire(); // init to 100, seq = 101
    await pool.resync(); // fetch again → 200
    const seq = await pool.acquire();
    expect(seq).toBe(201n);
  });

  it('exposes currentSequence getter', async () => {
    const fetch = jest.fn().mockResolvedValue('42');
    const pool = new NoncePool('GABC', fetch);
    expect(pool.currentSequence).toBeUndefined();
    await pool.acquire();
    expect(pool.currentSequence).toBe(43n);
  });
});

describe('NoncePoolRegistry', () => {
  it('returns the same pool for the same account', () => {
    const fetch = jest.fn();
    const registry = new NoncePoolRegistry(fetch);
    const p1 = registry.getPool('GABC');
    const p2 = registry.getPool('GABC');
    expect(p1).toBe(p2);
  });

  it('returns different pools for different accounts', () => {
    const fetch = jest.fn();
    const registry = new NoncePoolRegistry(fetch);
    const p1 = registry.getPool('GABC');
    const p2 = registry.getPool('GXYZ');
    expect(p1).not.toBe(p2);
  });

  it('clearPool removes the pool for an account', () => {
    const fetch = jest.fn();
    const registry = new NoncePoolRegistry(fetch);
    const p1 = registry.getPool('GABC');
    registry.clearPool('GABC');
    const p2 = registry.getPool('GABC');
    expect(p1).not.toBe(p2);
  });
});

// ── BatchSubmitter unit tests ─────────────────────────────────────────────────

describe('BatchSubmitter', () => {
  function makeSubmitter(submitFn, opts = {}) {
    return new BatchSubmitter({
      fetchSequenceFn: jest.fn().mockResolvedValue('1000'),
      submitFn,
      maxWaitMs: 50,
      retryDelayMs: 10,
      ...opts,
    });
  }

  it('submits a single transaction and returns hash', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'txhash1' });
    const s = makeSubmitter(submit);
    const result = await s.submit({
      id: 'tx1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(result).toEqual({ txId: 'tx1', hash: 'txhash1' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].seq).toBe(1001n);
  });

  it('assigns unique sequence numbers to concurrent transactions', async () => {
    const seqsSeen = [];
    const submit = jest.fn().mockImplementation(async (envelope) => {
      seqsSeen.push(Number(envelope.seq));
      return { hash: `hash-${envelope.seq}` };
    });
    const s = makeSubmitter(submit, { maxBatchSize: 5 });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        s.submit({
          id: `tx${i}`,
          sourceAccount: 'GABC',
          buildEnvelope: (seq) => ({ seq }),
        })
      )
    );

    expect(results).toHaveLength(5);
    const unique = new Set(seqsSeen);
    expect(unique.size).toBe(5);
    results.forEach((r) => expect(r).toHaveProperty('hash'));
  });

  it('retries on failure and resolves after retry succeeds', async () => {
    let calls = 0;
    const submit = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('network error');
      return { hash: 'recovered' };
    });
    const s = makeSubmitter(submit, { retryAttempts: 3, retryDelayMs: 5 });
    const result = await s.submit({
      id: 'tx1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(result.hash).toBe('recovered');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('rejects after exhausting retry attempts', async () => {
    const submit = jest.fn().mockRejectedValue(new Error('permanent'));
    const s = makeSubmitter(submit, { retryAttempts: 2, retryDelayMs: 5 });
    await expect(
      s.submit({
        id: 'tx1',
        sourceAccount: 'GABC',
        buildEnvelope: (seq) => ({ seq }),
      })
    ).rejects.toThrow('permanent');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('flush() drains all queued transactions immediately', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const s = makeSubmitter(submit, { maxWaitMs: 60000 }); // very long timer
    const promises = Array.from({ length: 3 }, (_, i) =>
      s.submit({
        id: `tx${i}`,
        sourceAccount: 'GABC',
        buildEnvelope: (seq) => ({ seq }),
      })
    );
    expect(s.queueLength).toBe(3);
    await s.flush();
    expect(s.queueLength).toBe(0);
    await Promise.all(promises);
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it('emits batch:submitted event after flushing', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const s = makeSubmitter(submit, { maxBatchSize: 2 });
    const events = [];
    s.on('batch:submitted', (e) => events.push(e));
    const p1 = s.submit({
      id: 't1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    const p2 = s.submit({
      id: 't2',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    await Promise.all([p1, p2]);
    // Yield to let the rest of #flush() run and emit the event
    await new Promise((r) => setImmediate(r));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty('batchId');
    expect(events[0].count).toBe(2);
  });

  it('auto-flushes via timer when batch size is not reached', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const s = makeSubmitter(submit, { maxBatchSize: 10, maxWaitMs: 30 });
    const p = s.submit({
      id: 'tx-timer',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(s.queueLength).toBe(1);
    const result = await p;
    expect(result.hash).toBe('h');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('handles multiple sequential batch flushes', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const s = makeSubmitter(submit, { maxBatchSize: 2 });

    const p1 = s.submit({
      id: 'batch1-tx1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    const p2 = s.submit({
      id: 'batch1-tx2',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    await Promise.all([p1, p2]);

    const p3 = s.submit({
      id: 'batch2-tx1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    const p4 = s.submit({
      id: 'batch2-tx2',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    await Promise.all([p3, p4]);

    expect(submit).toHaveBeenCalledTimes(4);
  });

  it('tracks queueLength accurately across operations', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const s = makeSubmitter(submit, { maxWaitMs: 60000 });
    expect(s.queueLength).toBe(0);

    const p1 = s.submit({
      id: 'q1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(s.queueLength).toBe(1);

    const p2 = s.submit({
      id: 'q2',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(s.queueLength).toBe(2);

    await s.flush();
    expect(s.queueLength).toBe(0);
    await Promise.all([p1, p2]);
  });

  it('emits tx:success for each successful transaction', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'ok' });
    const s = makeSubmitter(submit, { maxBatchSize: 2 });
    const successes = [];
    s.on('tx:success', (e) => successes.push(e));

    const p1 = s.submit({
      id: 's1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    const p2 = s.submit({
      id: 's2',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    await Promise.all([p1, p2]);
    await new Promise((r) => setImmediate(r));

    expect(successes).toHaveLength(2);
    expect(successes.map((e) => e.txId).sort()).toEqual(['s1', 's2']);
  });

  it('emits tx:failed for failed transactions', async () => {
    const submit = jest.fn().mockRejectedValue(new Error('boom'));
    const s = makeSubmitter(submit, {
      retryAttempts: 1,
      retryDelayMs: 1,
      maxBatchSize: 2,
    });
    const failures = [];
    s.on('tx:failed', (e) => failures.push(e));

    await expect(
      s.submit({
        id: 'f1',
        sourceAccount: 'GABC',
        buildEnvelope: (seq) => ({ seq }),
      })
    ).rejects.toThrow('boom');
    await new Promise((r) => setImmediate(r));

    expect(failures).toHaveLength(1);
    expect(failures[0].txId).toBe('f1');
    expect(failures[0].error).toBe('boom');
  });

  it('handles transactions from multiple source accounts', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const fetchSeq = jest.fn().mockImplementation(async (acct) => {
      return acct === 'G_ACCT_A' ? '500' : '800';
    });
    const s = new BatchSubmitter({
      fetchSequenceFn: fetchSeq,
      submitFn: submit,
      maxBatchSize: 4,
      maxWaitMs: 50,
      retryDelayMs: 10,
    });

    const results = await Promise.all([
      s.submit({
        id: 'a1',
        sourceAccount: 'G_ACCT_A',
        buildEnvelope: (seq) => ({ seq, acct: 'A' }),
      }),
      s.submit({
        id: 'b1',
        sourceAccount: 'G_ACCT_B',
        buildEnvelope: (seq) => ({ seq, acct: 'B' }),
      }),
      s.submit({
        id: 'a2',
        sourceAccount: 'G_ACCT_A',
        buildEnvelope: (seq) => ({ seq, acct: 'A' }),
      }),
      s.submit({
        id: 'b2',
        sourceAccount: 'G_ACCT_B',
        buildEnvelope: (seq) => ({ seq, acct: 'B' }),
      }),
    ]);

    expect(results).toHaveLength(4);
    expect(submit).toHaveBeenCalledTimes(4);
  });

  it('resyncs nonce pool after sequence-related failure', async () => {
    let calls = 0;
    const fetchSeq = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls <= 1) return '100';
      return '200';
    });
    const submit = jest
      .fn()
      .mockRejectedValueOnce(new Error('seq_no_too_low'))
      .mockResolvedValue({ hash: 'ok' });

    const s = new BatchSubmitter({
      fetchSequenceFn: fetchSeq,
      submitFn: submit,
      maxBatchSize: 1,
      maxWaitMs: 50,
      retryAttempts: 2,
      retryDelayMs: 5,
    });

    const result = await s.submit({
      id: 'resync-tx',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(result.hash).toBe('ok');
    // fetchSeq called twice: once for initial, once for resync
    expect(fetchSeq).toHaveBeenCalledTimes(2);
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('POST /api/batch/submit', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/batch', batchRouter);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/batch/submit').send({ id: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('returns 400 when sourceAccount is missing', async () => {
    const res = await request(app)
      .post('/api/batch/submit')
      .send({ id: 'x', payload: { type: 'invoke' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('returns 400 when payload is missing', async () => {
    const res = await request(app)
      .post('/api/batch/submit')
      .send({ id: 'x', sourceAccount: 'GABC' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('returns 200 and hash for a valid submission', async () => {
    const res = await request(app)
      .post('/api/batch/submit')
      .send({
        id: 'route-tx1',
        sourceAccount: 'GABC',
        payload: { type: 'invoke', contractId: 'C123' },
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('txId', 'route-tx1');
    expect(res.body.data).toHaveProperty('hash');
  });

  it('GET /api/batch/status returns queue length', async () => {
    const res = await request(app).get('/api/batch/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('queueLength');
    expect(typeof res.body.data.queueLength).toBe('number');
  });

  it('POST /api/batch/flush returns 200', async () => {
    const res = await request(app).post('/api/batch/flush').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
