// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: { isConnected: false, get: jest.fn().mockResolvedValue(null) },
}));

jest.mock('../src/services/authService.js', () => ({
  __esModule: true,
  default: { authenticate: jest.fn().mockResolvedValue(null) },
}));

jest.mock('../src/services/corsWhitelistService.js', () => ({
  __esModule: true,
  listOrigins: jest.fn(),
  addOrigin: jest.fn(),
  removeOrigin: jest.fn(),
}));

import corsAdminRoute from '../src/routes/corsAdmin.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  listOrigins,
  addOrigin,
  removeOrigin,
} from '../src/services/corsWhitelistService.js';

const ADMIN_KEY = 'GDYXUOXIV3EDTQKL4OGE54RIZERSQZBU3EGU5V66L2EF2OGJ7HO7IGO3';
const token = (role) =>
  jwt.sign({ sub: ADMIN_KEY, role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
  });

const app = express();
app.use(express.json());
app.use('/api/cors-whitelist', corsAdminRoute);
app.use(errorHandler);

beforeEach(() => jest.clearAllMocks());

describe('CORS whitelist admin API', () => {
  it('rejects anonymous callers', async () => {
    const res = await request(app).get('/api/cors-whitelist');
    expect(res.status).toBe(403);
    expect(listOrigins).not.toHaveBeenCalled();
  });

  it('rejects non-admin users', async () => {
    const res = await request(app)
      .post('/api/cors-whitelist')
      .set('Authorization', `Bearer ${token('user')}`)
      .send({ origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(addOrigin).not.toHaveBeenCalled();
  });

  it('lets admins list origins', async () => {
    listOrigins.mockResolvedValue([{ id: 1, origin: 'https://a.example' }]);
    const res = await request(app)
      .get('/api/cors-whitelist')
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('adds a valid origin, recording the admin by default', async () => {
    addOrigin.mockResolvedValue({ id: 2, origin: 'https://b.example' });
    const res = await request(app)
      .post('/api/cors-whitelist')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ origin: 'https://b.example' });
    expect(res.status).toBe(201);
    expect(addOrigin).toHaveBeenCalledWith('https://b.example', ADMIN_KEY);
  });

  it.each([
    ['*'],
    ['https://*'],
    ['ftp://files.example'],
    ['https://a.example/path'],
    ['https://user:pass@a.example'],
    ['javascript:alert(1)'],
  ])('rejects invalid origin %s with 422', async (origin) => {
    const res = await request(app)
      .post('/api/cors-whitelist')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ origin });
    expect(res.status).toBe(422);
    expect(res.body.details[0]).toMatchObject({
      field: 'origin',
      location: 'body',
    });
    expect(addOrigin).not.toHaveBeenCalled();
  });

  it('removes a URL-encoded origin', async () => {
    removeOrigin.mockResolvedValue(true);
    const res = await request(app)
      .delete(`/api/cors-whitelist/${encodeURIComponent('https://b.example')}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(200);
    expect(removeOrigin).toHaveBeenCalledWith('https://b.example');
  });

  it('returns 404 for an origin that is not whitelisted', async () => {
    removeOrigin.mockResolvedValue(false);
    const res = await request(app)
      .delete(`/api/cors-whitelist/${encodeURIComponent('https://c.example')}`)
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(404);
  });
});
