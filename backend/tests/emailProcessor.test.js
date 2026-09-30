// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Comprehensive test suite for the Email Notification processor (Issue #971).
// Covers input validation, error handling, and return value shape.

import emailProcessor from '../src/workers/emailProcessor.js';

// Helper to create a mock BullMQ job
function makeJob(data, overrides = {}) {
  return {
    id: overrides.id ?? 'job_1',
    data,
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: 3, ...overrides.opts },
  };
}

describe('emailProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Successful sends ───────────────────────────────────────────────────────

  describe('successful sends', () => {
    it('returns success with correct shape', async () => {
      const job = makeJob({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
      });

      const result = await emailProcessor(job);

      expect(result.success).toBe(true);
      expect(result.sentTo).toBe('user@example.com');
      expect(result.subject).toBe('Hello');
      expect(result.hasTextContent).toBe(true);
      expect(result.hasHtmlContent).toBe(false);
      expect(typeof result.durationMs).toBe('number');
    });

    it('trims whitespace from email address', async () => {
      const job = makeJob({
        to: '  user@example.com  ',
        subject: 'Test',
      });

      const result = await emailProcessor(job);
      expect(result.sentTo).toBe('user@example.com');
    });

    it('handles html content flag', async () => {
      const job = makeJob({
        to: 'user@example.com',
        subject: 'HTML',
        html: '<p>Hello</p>',
      });

      const result = await emailProcessor(job);
      expect(result.hasHtmlContent).toBe(true);
      expect(result.hasTextContent).toBe(false);
    });

    it('sets default subject when none provided', async () => {
      const job = makeJob({
        to: 'user@example.com',
      });

      const result = await emailProcessor(job);
      expect(result.subject).toBe('(no subject)');
    });

    it('includes default from address', async () => {
      const job = makeJob({
        to: 'user@example.com',
      });

      const result = await emailProcessor(job);
      expect(result.from).toBe('noreply@soroban-playground.dev');
    });

    it('uses custom from address when provided', async () => {
      const job = makeJob({
        to: 'user@example.com',
        from: 'admin@test.com',
      });

      const result = await emailProcessor(job);
      expect(result.from).toBe('admin@test.com');
    });
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe('input validation', () => {
    it('throws when job data is null', async () => {
      const job = makeJob(null);
      await expect(emailProcessor(job)).rejects.toThrow('Validation failed');
    });

    it('throws when job data is undefined', async () => {
      const job = makeJob(undefined);
      await expect(emailProcessor(job)).rejects.toThrow('Validation failed');
    });

    it('throws when "to" is missing', async () => {
      const job = makeJob({ subject: 'Test' });
      await expect(emailProcessor(job)).rejects.toThrow('"to" is required');
    });

    it('throws when "to" is empty string', async () => {
      const job = makeJob({ to: '', subject: 'Test' });
      await expect(emailProcessor(job)).rejects.toThrow('"to" is required');
    });

    it('throws when "to" is not a string', async () => {
      const job = makeJob({ to: 123 });
      await expect(emailProcessor(job)).rejects.toThrow('"to" is required');
    });

    it('throws for invalid email format', async () => {
      const job = makeJob({ to: 'not-an-email' });
      await expect(emailProcessor(job)).rejects.toThrow(
        'Invalid email address'
      );
    });

    it('throws for email without domain', async () => {
      const job = makeJob({ to: 'user@' });
      await expect(emailProcessor(job)).rejects.toThrow(
        'Invalid email address'
      );
    });

    it('throws when "subject" is empty string', async () => {
      const job = makeJob({ to: 'user@example.com', subject: '' });
      // Empty subject is allowed — defaults to "(no subject)"
      const result = await emailProcessor(job);
      expect(result.subject).toBe('(no subject)');
    });

    it('throws when "subject" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', subject: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"subject" must be a string'
      );
    });

    it('throws when "body" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', body: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"body" must be a string'
      );
    });

    it('throws when "html" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', html: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"html" must be a string'
      );
    });

    it('throws when "from" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', from: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"from" must be a string'
      );
    });
  });

  // ── Error code ────────────────────────────────────────────────────────────

  describe('error codes', () => {
    it('includes VALIDATION_ERROR code on validation failure', async () => {
      const job = makeJob({});
      try {
        await emailProcessor(job);
        fail('Should have thrown');
      } catch (e) {
        expect(e.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ── Job metadata ───────────────────────────────────────────────────────────

  describe('job metadata', () => {
    it('logs attempt number correctly', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const job = makeJob({ to: 'user@example.com' }, { attemptsMade: 2 });

      await emailProcessor(job);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Attempt 3');
      consoleSpy.mockRestore();
    });

    it('handles job with id 0', async () => {
      const job = makeJob({ to: 'user@example.com' }, { id: 0 });
      const result = await emailProcessor(job);
      expect(result.success).toBe(true);
    });
  });
});
