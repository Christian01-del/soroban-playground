// Stellar identifier + mass-assignment validation for newly mounted gateways (#1491).

// Stellar public key (base32) and contract ID patterns.
const PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;

export function isContractId(value) {
  return typeof value === 'string' && CONTRACT.test(value);
}

export function isPublicKey(value) {
  return typeof value === 'string' && PUBLIC_KEY.test(value);
}

/**
 * Walks params/query/body and rejects malformed Stellar contract IDs or
 * public keys with HTTP 422 (RFC-7807 style). Also strips unexpected keys
 * from plain-object bodies to reduce mass-assignment surface.
 */
export function stellarIdValidation(req, res, next) {
  const issues = [];

  function walk(node, path) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, idx) => walk(item, `${path}[${idx}]`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string') {
        if (/contract/i.test(key) && value && !isContractId(value)) {
          issues.push({ path: childPath, message: 'Invalid Stellar contract ID (expected C + 55 base32 chars)' });
        }
        if (/(^|_)(address|public_?key|account|from|to|user)/i.test(key) && value.length > 20 && !isPublicKey(value) && !isContractId(value)) {
          // Only flag values that look like Stellar keys (start with G/C) but fail the regex.
          if (/^[GC]/.test(value)) {
            issues.push({ path: childPath, message: 'Invalid Stellar public key or contract ID' });
          }
        }
      } else if (value && typeof value === 'object') {
        walk(value, childPath);
      }
    }
  }

  walk(req.params, 'params');
  walk(req.query, 'query');
  if (req.body && typeof req.body === 'object') {
    // Strip prototype-pollution style keys from bodies.
    for (const banned of ['__proto__', 'constructor', 'prototype']) {
      if (banned in req.body) {
        try {
          delete req.body[banned];
        } catch {
          /* ignore */
        }
      }
    }
    walk(req.body, 'body');
  }

  if (issues.length > 0) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters',
        details: issues,
      },
    });
  }

  return next();
}

export default stellarIdValidation;
