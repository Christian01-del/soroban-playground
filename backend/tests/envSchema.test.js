// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Tests for envSchema Zod-based startup validation (#1578)
 */

import { validateEnvSchema, ENV_SCHEMA } from '../src/config/envSchema.js';

describe('ENV_SCHEMA shape', () => {
  it('parses a minimal valid environment with defaults', () => {
    const result = ENV_SCHEMA.safeParse({
      NODE_ENV: 'development',
      JWT_SECRET: 'my-strong-dev-secret-16chars',
    });
    expect(result.success).toBe(true);
    expect(result.data.NODE_ENV).toBe('development');
    expect(result.data.DATABASE_URL).toBe('sqlite://data/soroban.db');
    expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
    expect(result.data.SOROBAN_RPC_URL).toBe(
      'https://soroban-testnet.stellar.org'
    );
  });

  it('coerces integer env vars from strings', () => {
    const result = ENV_SCHEMA.safeParse({
      PORT: '3001',
      COMPILE_TIMEOUT_MS: '60000',
      RPC_FAILURE_THRESHOLD: '5',
    });
    expect(result.success).toBe(true);
    expect(result.data.PORT).toBe(3001);
    expect(result.data.COMPILE_TIMEOUT_MS).toBe(60000);
    expect(result.data.RPC_FAILURE_THRESHOLD).toBe(5);
  });

  it('coerces boolean env vars', () => {
    const r1 = ENV_SCHEMA.safeParse({ REDIS_TLS: 'true' });
    const r2 = ENV_SCHEMA.safeParse({ REDIS_TLS: 'false' });
    const r3 = ENV_SCHEMA.safeParse({ TRACING_ENABLED: 'yes' });
    const r4 = ENV_SCHEMA.safeParse({ TRACING_ENABLED: 'off' });

    expect(r1.data.REDIS_TLS).toBe(true);
    expect(r2.data.REDIS_TLS).toBe(false);
    expect(r3.data.TRACING_ENABLED).toBe(true);
    expect(r4.data.TRACING_ENABLED).toBe(false);
  });

  it('rejects invalid NODE_ENV values', () => {
    const result = ENV_SCHEMA.safeParse({ NODE_ENV: 'invalid-env' });
    expect(result.success).toBe(false);
  });
});

describe('validateEnvSchema', () => {
  it('returns valid:true for a healthy development environment', () => {
    const result = validateEnvSchema({
      NODE_ENV: 'development',
      JWT_SECRET: 'a-sufficiently-long-dev-secret',
      DATABASE_URL: 'sqlite://data/soroban.db',
      REDIS_URL: 'redis://localhost:6379',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid:true with defaults when optional vars are absent', () => {
    const result = validateEnvSchema({});
    expect(result.valid).toBe(true);
    expect(result.env.REDIS_URL).toBe('redis://localhost:6379');
    expect(result.env.SOROBAN_RPC_URL).toBe(
      'https://soroban-testnet.stellar.org'
    );
  });

  // ─── Production-specific security checks ─────────────────────────────────

  it('adds a warning in production when JWT_SECRET uses a known-insecure default', () => {
    const result = validateEnvSchema({
      NODE_ENV: 'production',
      JWT_SECRET: 'soroban-playground-secret-key-2026',
    });
    // Should still be "valid" (warning-level, not error-level, unless strict)
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('JWT_SECRET'))).toBe(true);
  });

  it('adds an error in production (strict mode) for insecure JWT_SECRET', () => {
    const result = validateEnvSchema(
      {
        NODE_ENV: 'production',
        JWT_SECRET: 'dev-secret-change-me',
      },
      { strict: true }
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('JWT_SECRET'))).toBe(true);
  });

  it('adds an error in production when BACKUP_ENABLED without BACKUP_S3_BUCKET', () => {
    const result = validateEnvSchema({
      NODE_ENV: 'production',
      BACKUP_ENABLED: 'true',
    });
    expect(result.errors.some((e) => e.includes('BACKUP_S3_BUCKET'))).toBe(
      true
    );
    expect(result.valid).toBe(false);
  });

  it('adds an error in production when BACKUP_ENABLED without BACKUP_ENCRYPTION_KEY', () => {
    const result = validateEnvSchema({
      NODE_ENV: 'production',
      BACKUP_ENABLED: 'true',
      BACKUP_S3_BUCKET: 'my-bucket',
    });
    expect(
      result.errors.some((e) => e.includes('BACKUP_ENCRYPTION_KEY'))
    ).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('warns when Stellar server keypair not set in production', () => {
    const result = validateEnvSchema({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-sufficiently-long-production-secret-here',
    });
    expect(
      result.warnings.some(
        (w) => w.includes('STELLAR_SERVER_ACCOUNT') || w.includes('SEP-0010')
      )
    ).toBe(true);
  });

  it('returns a human-readable report', () => {
    const result = validateEnvSchema({ NODE_ENV: 'development' });
    expect(typeof result.report).toBe('string');
    expect(result.report).toMatch(/Environment validation/);
  });

  // ─── Report structure ─────────────────────────────────────────────────────

  it('exposes parsed env values in result.env', () => {
    const result = validateEnvSchema({
      NODE_ENV: 'test',
      PORT: '8080',
      REDIS_URL: 'redis://redis-host:6379',
    });
    expect(result.env.PORT).toBe(8080);
    expect(result.env.REDIS_URL).toBe('redis://redis-host:6379');
  });
});
