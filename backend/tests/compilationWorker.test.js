// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import compileRouter from '../src/routes/v1/compile.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

jest.mock('../src/services/compileService.js', () => ({
  compileQueued: jest.fn(),
  compileBatch: jest.fn(),
  getCompileSnapshot: jest.fn(),
  compileContract: jest.fn().mockResolvedValue({
    hash: '0x123abc',
    wasmUrl: '/artifacts/contract.wasm',
    sizeBytes: 1024,
    durationMs: 120,
  }),
}));

describe('Async WASM Compilation Queue API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/compile', compileRouter);
    app.use(errorHandler);
  });

  it('POST /api/compile/async queues a compilation job', async () => {
    const res = await request(app).post('/api/compile/async').send({
      source: 'pub fn hello() {}',
      contractName: 'test_contract',
    });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBe('queued');
  });

  it('GET /api/compile/job/:jobId checks queued job status', async () => {
    const postRes = await request(app).post('/api/compile/async').send({
      source: 'pub fn test() {}',
    });

    const jobId = postRes.body.jobId;
    const getRes = await request(app).get(`/api/compile/job/${jobId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.jobId).toBe(jobId);
    expect(getRes.body.status).toBeDefined();
  });
});
