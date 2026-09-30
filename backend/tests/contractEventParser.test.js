// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Test suite for the enhanced contractEventParser (Issue #963).
// Covers XdrParseError, validateRawEvent, parseEvent, registerHandler, dispatchEvent.

import { jest } from '@jest/globals';

jest.mock('@stellar/stellar-sdk', () => ({
  xdr: {
    ScVal: {
      fromXDR: jest.fn((val, enc) => {
        if (val === 'bad-xdr') throw new Error('XDR decode error');
        return val;
      }),
    },
  },
  scValToNative: jest.fn((val) => val),
}));

import {
  decodeScVal,
  parseEvent,
  registerHandler,
  dispatchEvent,
  validateRawEvent,
  XdrParseError,
} from '../src/services/contractEventParser.js';

describe('contractEventParser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── XdrParseError ──────────────────────────────────────────────────────────

  describe('XdrParseError', () => {
    it('has correct name and properties', () => {
      const err = new XdrParseError('test error', 'raw-xdr');
      expect(err.name).toBe('XdrParseError');
      expect(err.message).toBe('test error');
      expect(err.rawXdr).toBe('raw-xdr');
      expect(err._category).toBe('parse');
      expect(err).toBeInstanceOf(Error);
    });
  });

  // ── validateRawEvent ───────────────────────────────────────────────────────

  describe('validateRawEvent', () => {
    it('returns valid for a correct event', () => {
      const result = validateRawEvent({ contractId: 'C123', ledger: 1 });
      expect(result).toEqual({ valid: true, error: null });
    });

    it('rejects null input', () => {
      const result = validateRawEvent(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-null object');
    });

    it('rejects non-object input', () => {
      const result = validateRawEvent('string');
      expect(result.valid).toBe(false);
    });

    it('rejects missing contractId', () => {
      const result = validateRawEvent({ ledger: 1 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('contractId');
    });

    it('rejects missing ledger', () => {
      const result = validateRawEvent({ contractId: 'C123' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ledger');
    });

    it('accepts null contractId (it exists)', () => {
      const result = validateRawEvent({ contractId: null, ledger: 1 });
      expect(result.valid).toBe(true);
    });
  });

  // ── decodeScVal ────────────────────────────────────────────────────────────

  describe('decodeScVal', () => {
    it('decodes a valid XDR string', () => {
      const result = decodeScVal('valid-base64');
      expect(result).toBe('valid-base64');
    });

    it('throws XdrParseError for empty string', () => {
      expect(() => decodeScVal('')).toThrow(XdrParseError);
    });

    it('throws XdrParseError for non-string input', () => {
      expect(() => decodeScVal(123)).toThrow(XdrParseError);
    });

    it('throws XdrParseError for invalid XDR', () => {
      expect(() => decodeScVal('bad-xdr')).toThrow(XdrParseError);
    });

    it('includes rawXdr in the error', () => {
      try {
        decodeScVal('bad-xdr');
        fail('Should have thrown');
      } catch (e) {
        expect(e.rawXdr).toBe('bad-xdr');
      }
    });
  });

  // ── parseEvent ─────────────────────────────────────────────────────────────

  describe('parseEvent', () => {
    it('parses a valid raw event', () => {
      const raw = {
        contractId: 'CABC123',
        ledger: 42,
        topic: ['transfer'],
        value: { xdr: 'abc123' },
        type: 'contract',
      };

      const result = parseEvent(raw);

      expect(result.contractId).toBe('CABC123');
      expect(result.ledgerSequence).toBe(42);
      expect(result.topics).toEqual(['transfer']);
      expect(result.rawXdr).toBe('abc123');
      expect(result.eventType).toBe('contract');
    });

    it('throws for invalid event', () => {
      expect(() => parseEvent(null)).toThrow('Invalid event');
      expect(() => parseEvent({})).toThrow('Invalid event');
      expect(() => parseEvent({ contractId: 'C123' })).toThrow('Invalid event');
    });

    it('handles missing topic array', () => {
      const raw = { contractId: 'C123', ledger: 1 };
      const result = parseEvent(raw);
      expect(result.topics).toEqual([]);
    });

    it('handles missing value', () => {
      const raw = { contractId: 'C123', ledger: 1 };
      const result = parseEvent(raw);
      expect(result.value).toBeNull();
      expect(result.rawXdr).toBeNull();
    });

    it('handles null value.xdr', () => {
      const raw = { contractId: 'C123', ledger: 1, value: {} };
      const result = parseEvent(raw);
      expect(result.value).toBeNull();
    });

    it('defaults event type to "contract"', () => {
      const raw = { contractId: 'C123', ledger: 1 };
      const result = parseEvent(raw);
      expect(result.eventType).toBe('contract');
    });

    it('uses provided event type', () => {
      const raw = { contractId: 'C123', ledger: 1, type: 'system' };
      const result = parseEvent(raw);
      expect(result.eventType).toBe('system');
    });

    it('gracefully handles bad XDR in topics', () => {
      const raw = {
        contractId: 'C123',
        ledger: 1,
        topic: ['bad-xdr', 'good-topic'],
      };
      const result = parseEvent(raw);
      expect(result.topics[0]).toBe('bad-xdr'); // falls back to raw value
      expect(result.topics[1]).toBe('good-topic');
    });

    it('gracefully handles bad XDR in value', () => {
      const raw = {
        contractId: 'C123',
        ledger: 1,
        value: { xdr: 'bad-xdr' },
      };
      const result = parseEvent(raw);
      expect(result.value).toBe('bad-xdr'); // falls back to raw value
    });
  });

  // ── registerHandler ────────────────────────────────────────────────────────

  describe('registerHandler', () => {
    it('registers a handler for a contract type', () => {
      const fn = jest.fn();
      registerHandler('transfer', fn);
      // No error thrown
    });

    it('throws for empty contract type', () => {
      expect(() => registerHandler('', jest.fn())).toThrow('non-empty string');
    });

    it('throws for non-function handler', () => {
      expect(() => registerHandler('transfer', 'not-a-function')).toThrow(
        'must be a function'
      );
    });
  });

  // ── dispatchEvent ──────────────────────────────────────────────────────────

  describe('dispatchEvent', () => {
    it('calls the registered handler with the parsed event', () => {
      const fn = jest.fn();
      registerHandler('transfer', fn);

      const parsed = { topics: ['transfer'], value: 100 };
      dispatchEvent(parsed);

      expect(fn).toHaveBeenCalledWith(parsed);
    });

    it('calls wildcard handler for unregistered types', () => {
      const fn = jest.fn();
      registerHandler('*', fn);

      const parsed = { topics: ['unknown_type'] };
      dispatchEvent(parsed);

      expect(fn).toHaveBeenCalledWith(parsed);
    });

    it('does not throw when handler throws', () => {
      registerHandler('error_type', () => {
        throw new Error('handler boom');
      });

      const parsed = { topics: ['error_type'] };
      expect(() => dispatchEvent(parsed)).not.toThrow();
    });

    it('does nothing when no handler matches', () => {
      // No wildcard registered
      const parsed = { topics: ['no_handler'] };
      expect(() => dispatchEvent(parsed)).not.toThrow();
    });

    it('uses "unknown" for events with no topics', () => {
      const fn = jest.fn();
      registerHandler('unknown', fn);

      const parsed = { topics: [] };
      dispatchEvent(parsed);

      expect(fn).toHaveBeenCalledWith(parsed);
    });
  });
});
