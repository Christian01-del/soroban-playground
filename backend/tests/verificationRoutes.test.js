import { jest } from '@jest/globals';
import express from 'express';

jest.mock('../src/services/compileService.js', () => ({
  compileQueued: jest.fn(),
}));

jest.mock('../src/middleware/rateLimiter.js', () => ({
  rateLimitMiddleware: () => (_req, _res, next) => next(),
}));
import request from 'supertest';
import { StrKey } from '@stellar/stellar-sdk';
import verifyService from '../src/services/verifyService.js';
import verificationRouter from '../src/routes/verification.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api/verify', verificationRouter);
app.use(errorHandler);

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
const WASM = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

const originalMethods = {};

beforeEach(() => {
  for (const method of [
    'submitVerification',
    'getVerification',
    'getSource',
    'reverifyContract',
    'searchVerifications',
  ]) {
    originalMethods[method] = verifyService[method];
  }
});

afterEach(() => {
  for (const [method, implementation] of Object.entries(originalMethods)) {
    verifyService[method] = implementation;
  }
});

describe('contract verification routes', () => {
  it('returns 200 for an exact match', async () => {
    verifyService.submitVerification = async () => ({
      id: 'verified-1',
      status: 'verified',
      verified: true,
      contractId: CONTRACT_ID,
    });

    const response = await request(app)
      .post('/api/verify/contracts')
      .send({ contractId: CONTRACT_ID, sourceCode: 'pub fn contract() {}' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: 'verified-1', status: 'verified' },
    });
  });

  it('returns 202 for a completed mismatch', async () => {
    verifyService.submitVerification = async () => ({
      id: 'mismatch-1',
      status: 'mismatch',
      verified: false,
      contractId: CONTRACT_ID,
    });

    const response = await request(app)
      .post('/api/verify/contracts')
      .send({ contractId: CONTRACT_ID, sourceCode: 'pub fn contract() {}' });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      success: false,
      data: { status: 'mismatch' },
    });
  });

  it('routes /search before the dynamic id route', async () => {
    verifyService.searchVerifications = async () => ({
      records: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    const response = await request(app).get('/api/verify/contracts/search');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 0, records: [] });
  });

  it('maps service errors to the shared error response', async () => {
    verifyService.submitVerification = async () => {
      const error = new Error('bad source');
      error.statusCode = 422;
      error.code = 'COMPILATION_FAILED';
      throw error;
    };

    const response = await request(app)
      .post('/api/verify/contracts')
      .send({ contractId: CONTRACT_ID, sourceCode: 'invalid' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      statusCode: 422,
      message: 'bad source',
    });
  });

  it('supports status and source endpoints through the service adapter', async () => {
    verifyService.getVerification = async (id) => ({
      id,
      status: 'verified',
      verified: true,
    });
    verifyService.getSource = async (id) => ({
      id,
      sourceCode: 'pub fn contract() {}',
    });

    const statusResponse = await request(app).get(
      '/api/verify/contracts/verified-1'
    );
    const sourceResponse = await request(app).get(
      '/api/verify/contracts/verified-1/source'
    );

    expect(statusResponse.status).toBe(200);
    expect(sourceResponse.status).toBe(200);
    expect(sourceResponse.body.data.sourceCode).toBe('pub fn contract() {}');
  });

  it('supports re-verification through the service adapter', async () => {
    verifyService.reverifyContract = async (id) => ({
      id,
      status: 'verified',
      verified: true,
    });

    const response = await request(app)
      .post('/api/verify/contracts/verified-1/reverify')
      .send({ wasmBase64: WASM.toString('base64') });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: 'verified-1',
      status: 'verified',
    });
  });
});
