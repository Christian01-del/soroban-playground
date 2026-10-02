import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { Keypair, Networks, Transaction } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

const mockStore = new Map();
jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (key) => mockStore.get(key) ?? null),
    set: jest.fn(async (key, value) => {
      mockStore.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key) => mockStore.delete(key)),
    setNX: jest.fn(async (key, value) => {
      if (mockStore.has(key)) return null;
      mockStore.set(key, value);
      return 'OK';
    }),
    consumeChallengeNonce: jest.fn(async (nonce) => {
      const key = `challenge:${nonce}`;
      if (!mockStore.has(key)) return false;
      mockStore.delete(key);
      return true;
    }),
  },
}));
jest.mock('../src/database/connection.js', () => ({ getDatabase: jest.fn() }));
jest.mock('../src/services/apiKeyService.js', () => ({
  __esModule: true,
  default: {},
}));
import authService from '../src/services/authService.js';
import authRouter from '../src/routes/auth.js';
import { authenticate } from '../src/middleware/auth.js';

const app = express();
app.use(express.json(), cookieParser());
app.use('/api/auth', authRouter);
app.get('/protected', authenticate, (req, res) =>
  res.json({ address: req.user.publicKey })
);
app.use((error, req, res, next) =>
  res.status(error.status || 401).json({ error: error.message })
);

async function signedChallenge(client) {
  const response = await request(app)
    .get('/api/auth/challenge')
    .query({ address: client.publicKey() });
  expect(response.status).toBe(200);
  const tx = new Transaction(response.body.transaction, Networks.TESTNET);
  expect(tx.sequence).toBe('0');
  expect(tx.operations[0].name).toBe('localhost auth');
  expect(tx.operations[1].name).toBe('web_auth_domain');
  tx.sign(client);
  return tx.toXDR();
}

describe('SEP-10 signed sessions', () => {
  beforeEach(() => mockStore.clear());

  it('fails closed when production signing or JWT credentials are absent', () => {
    const previousMode = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      for (const key of ['STELLAR_SERVER_SECRET', 'JWT_SECRET']) {
        const previous = process.env[key];
        delete process.env[key];
        try {
          jest.isolateModules(() => {
            expect(() => require('../src/services/authService.js')).toThrow(
              'Production wallet authentication requires'
            );
          });
        } finally {
          process.env[key] = previous;
        }
      }
    } finally {
      process.env.NODE_ENV = previousMode;
    }
  });

  it('exchanges a real wallet signature, rotates cookies and revokes logout sessions', async () => {
    const client = Keypair.random();
    const signed = await signedChallenge(client);
    const agent = request.agent(app);
    const verified = await agent
      .post('/api/auth/verify')
      .send({ address: client.publicKey(), transactionXDR: signed });
    expect(verified.status).toBe(200);
    expect(verified.body.refreshToken).toBeUndefined();
    expect(verified.headers['cache-control']).toBe('no-store');
    expect(jwt.decode(verified.body.accessToken).sub).toBe(client.publicKey());
    const cookies = verified.headers['set-cookie'];
    expect(
      cookies.every(
        (cookie) =>
          cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict')
      )
    ).toBe(true);
    const refresh = await agent.post('/api/auth/refresh').send({});
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();
    expect(refresh.body.refreshToken).toBeUndefined();
    const activeAccess = refresh.body.accessToken;
    const replacement = refresh.headers['set-cookie']
      .find((cookie) => cookie.startsWith('refreshToken='))
      .split(';')[0];
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(200);
    await expect(authService.verifyAccessToken(activeAccess)).rejects.toThrow();
    expect(
      (
        await request(app)
          .post('/api/auth/refresh')
          .set('Cookie', replacement)
          .send({})
      ).status
    ).toBe(401);
  });

  it('uses secure cookies and disables the password demo in production', async () => {
    const client = Keypair.random();
    const signed = await signedChallenge(client);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await request(app)
        .post('/api/auth/verify')
        .send({ address: client.publicKey(), transactionXDR: signed });
      expect(result.status).toBe(200);
      expect(
        result.headers['set-cookie'].every((cookie) =>
          cookie.includes('Secure')
        )
      ).toBe(true);
      expect(
        (
          await request(app)
            .post('/api/auth/login')
            .send({ username: 'any', password: 'any' })
        ).status
      ).toBe(501);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('accepts access tokens on protected APIs, rejects refresh tokens and revokes the family', async () => {
    const client = Keypair.random();
    const tokens = await authService.generateTokens({ id: client.publicKey() });
    const valid = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(valid.status).toBe(200);
    expect(valid.body.address).toBe(client.publicKey());
    expect(
      (
        await request(app)
          .get('/protected')
          .set('Authorization', `Bearer ${tokens.refreshToken}`)
      ).status
    ).toBe(401);
    await authService.revokeRefreshToken(tokens.refreshToken);
    expect(
      (
        await request(app)
          .get('/protected')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
      ).status
    ).toBe(401);
  });

  it('rejects sequential and concurrent challenge replay', async () => {
    const client = Keypair.random();
    const signed = await signedChallenge(client);
    const results = await Promise.allSettled([
      authService.verifyStellarChallengeAndIssueTokens(
        client.publicKey(),
        signed
      ),
      authService.verifyStellarChallengeAndIssueTokens(
        client.publicKey(),
        signed
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    await expect(
      authService.verifyStellarChallengeAndIssueTokens(
        client.publicKey(),
        signed
      )
    ).rejects.toThrow();
  });

  it('rejects unsigned, wrong-account, altered and expired challenges', async () => {
    const client = Keypair.random();
    const challenge = await authService.generateStellarChallenge(
      client.publicKey()
    );
    await expect(
      authService.verifyStellarChallengeAndIssueTokens(
        client.publicKey(),
        challenge.transaction
      )
    ).rejects.toThrow();
    const tx = new Transaction(challenge.transaction, Networks.TESTNET);
    tx.sign(client);
    await expect(
      authService.verifyStellarChallengeAndIssueTokens(
        Keypair.random().publicKey(),
        tx.toXDR()
      )
    ).rejects.toThrow();
    const envelope = tx.toEnvelope();
    const wire = envelope.toXdrObject();
    wire.v1.tx.fee = 999;
    const altered = envelope.constructor.fromXdrObject(wire);
    await expect(
      authService.verifyStellarChallengeAndIssueTokens(
        client.publicKey(),
        altered.toXdr('base64')
      )
    ).rejects.toThrow();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000);
    try {
      await expect(
        authService.verifyStellarChallengeAndIssueTokens(
          client.publicKey(),
          tx.toXDR()
        )
      ).rejects.toThrow();
    } finally {
      clock.mockRestore();
    }
  });

  it('allows only one concurrent refresh and rejects its replayed family', async () => {
    const tokens = await authService.generateTokens({
      id: Keypair.random().publicKey(),
    });
    const results = await Promise.allSettled([
      authService.rotateRefreshToken(tokens.refreshToken),
      authService.rotateRefreshToken(tokens.refreshToken),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    const successful = results.find((result) => result.status === 'fulfilled');
    await expect(
      authService.verifyAccessToken(successful.value.accessToken)
    ).rejects.toThrow('blacklisted');
    await expect(
      authService.rotateRefreshToken(successful.value.refreshToken)
    ).rejects.toThrow('blacklisted');
  });

  it('logs out even with an expired access cookie', async () => {
    const tokens = await authService.generateTokens({
      id: Keypair.random().publicKey(),
    });
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [
        `accessToken=expired`,
        `refreshToken=${tokens.refreshToken}`,
      ])
      .send({});
    expect(response.status).toBe(200);
    await expect(
      authService.rotateRefreshToken(tokens.refreshToken)
    ).rejects.toThrow();
  });
});
