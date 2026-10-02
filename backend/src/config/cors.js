// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import cors from 'cors';

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];
const DEFAULT_MAX_AGE_SECONDS = 86400;

const ORIGIN_ENV_KEYS = [
  'CORS_ALLOWED_ORIGINS',
  'CORS_ORIGINS',
  'ALLOWED_ORIGINS',
];

// Verified frontend deployments that are always trusted in addition to the
// explicit allowlist (e.g. the Vercel URL the backend is paired with).
const FRONTEND_ENV_KEYS = ['FRONTEND_URL', 'FRONTEND_ORIGIN'];

// Any port on the loopback interface. Trusted outside production so local
// frontends (Next.js on :3000, Storybook, Playwright, ...) work without
// maintaining an allowlist.
const LOOPBACK_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getFirstConfiguredValue = (env, keys) => {
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  return undefined;
};

export function isProductionEnv(env = process.env) {
  return [env.NODE_ENV, env.APP_ENV].some(
    (value) =>
      String(value || '')
        .trim()
        .toLowerCase() === 'production'
  );
}

// Browsers send a canonical Origin (lowercase, no trailing slash, no path).
// Normalise configured entries the same way so `https://App.example.com/`
// in an env var still matches.
export function normalizeOrigin(origin) {
  return String(origin || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
}

// Convert a wildcard pattern like *.example.com or https://*.example.com to a RegExp.
// Only a single-label wildcard is supported (e.g. *.example.com matches
// app.example.com but NOT deep.sub.example.com).
export function compileOriginPattern(pattern) {
  if (!pattern.includes('*')) return null;
  // Escape all regex special chars first (leaves * untouched since it isn't one),
  // then replace each * with a single DNS label.
  const escaped = normalizeOrigin(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[a-z0-9-]+');
  return new RegExp(`^${escaped}$`);
}

// Build a fast origin-checking function that handles exact matches and wildcard patterns.
export function buildOriginMatcher(origins) {
  const exactSet = new Set();
  const patterns = [];

  for (const origin of origins) {
    if (origin.includes('*')) {
      const re = compileOriginPattern(origin);
      if (re) patterns.push(re);
    } else {
      exactSet.add(normalizeOrigin(origin));
    }
  }

  return function isAllowed(origin) {
    if (!origin) return true; // server-to-server / no Origin header
    const normalized = normalizeOrigin(origin);
    if (exactSet.has(normalized)) return true;
    return patterns.some((re) => re.test(normalized));
  };
}

export function parseCorsOrigins(value) {
  const origins = [...new Set(splitList(value))];
  const allowAll = origins.length === 0 || origins.includes('*');

  return {
    allowAll,
    origins: allowAll ? [] : origins,
  };
}

/**
 * Resolve the effective origin policy for an environment.
 *
 * Production: only the explicit allowlist, FRONTEND_URL and the runtime (DB)
 * whitelist are trusted. `*` or an empty allowlist is ignored unless
 * CORS_ALLOW_ALL_ORIGINS=true is set as a deliberate opt-out.
 *
 * Development/test: an empty allowlist or `*` allows every origin (the
 * historical default). Once an allowlist exists, loopback origins on any
 * port stay trusted unless CORS_ALLOW_LOCALHOST=false.
 */
export function resolveCorsPolicy(env = process.env) {
  const production = isProductionEnv(env);
  const { allowAll: envAllowAll, origins: envOrigins } = parseCorsOrigins(
    getFirstConfiguredValue(env, ORIGIN_ENV_KEYS)
  );
  const frontendOrigins = FRONTEND_ENV_KEYS.flatMap((key) =>
    splitList(env[key])
  );
  const origins = [...new Set([...envOrigins, ...frontendOrigins])];
  const warnings = [];

  let allowAll;
  if (production) {
    allowAll = env.CORS_ALLOW_ALL_ORIGINS === 'true';
    if (allowAll) {
      warnings.push(
        'CORS_ALLOW_ALL_ORIGINS=true: every origin may call the API in production.'
      );
    } else if (envAllowAll && envOrigins.length === 0) {
      warnings.push(
        'No CORS allowlist configured for production; cross-origin browser requests are rejected. ' +
          'Set CORS_ALLOWED_ORIGINS (comma-separated) or FRONTEND_URL.'
      );
    }
  } else {
    allowAll = envAllowAll && envOrigins.length === 0;
  }

  const allowLoopback = !production && env.CORS_ALLOW_LOCALHOST !== 'false';

  return { production, allowAll, origins, allowLoopback, warnings };
}

function isSameOrigin(origin, req) {
  const host = req?.headers?.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Build the complete CORS policy: `cors` options plus an origin-isolation
 * middleware that rejects (403) requests carrying an untrusted Origin header,
 * so simple cross-origin requests (which browsers send without a preflight)
 * cannot trigger side effects.
 *
 * @param {object} env
 * @param {string[] | (() => string[]) | null} dynamicOrigins
 *   Extra runtime-managed origins (e.g. the DB whitelist). Pass a function to
 *   have changes picked up without a restart.
 */
export function createCorsPolicy(env = process.env, dynamicOrigins = null) {
  const policy = resolveCorsPolicy(env);
  const getDynamic =
    typeof dynamicOrigins === 'function'
      ? () => dynamicOrigins() || []
      : () => dynamicOrigins || [];

  // Rebuild the matcher only when the dynamic list actually changes.
  let cachedKey = null;
  let cachedMatcher = null;
  const matcherFor = (dynamic) => {
    const key = dynamic.join(',');
    if (key !== cachedKey) {
      cachedKey = key;
      cachedMatcher = buildOriginMatcher([...policy.origins, ...dynamic]);
    }
    return cachedMatcher;
  };

  function isOriginAllowed(origin, req) {
    if (!origin) return true;
    const dynamic = getDynamic();
    if (policy.allowAll && dynamic.length === 0) return true;
    if (matcherFor(dynamic)(origin)) return true;
    if (
      policy.allowLoopback &&
      LOOPBACK_ORIGIN_RE.test(normalizeOrigin(origin))
    )
      return true;
    return Boolean(req) && isSameOrigin(origin, req);
  }

  const allowCredentials = env.CORS_ALLOW_CREDENTIALS === 'true';
  const allowedHeaders = splitList(env.CORS_ALLOWED_HEADERS);
  const allowedMethods = splitList(env.CORS_ALLOWED_METHODS);
  const exposedHeaders = splitList(env.CORS_EXPOSED_HEADERS);

  const options = {
    credentials: allowCredentials,
    maxAge: toPositiveInt(env.CORS_MAX_AGE_SECONDS, DEFAULT_MAX_AGE_SECONDS),
    methods: allowedMethods.length > 0 ? allowedMethods : DEFAULT_METHODS,
    optionsSuccessStatus: 204,
  };

  if (allowedHeaders.length > 0) {
    options.allowedHeaders = allowedHeaders;
  }

  if (exposedHeaders.length > 0) {
    options.exposedHeaders = exposedHeaders;
  }

  const staticDynamic = typeof dynamicOrigins !== 'function';
  if (policy.allowAll && staticDynamic && getDynamic().length === 0) {
    // Pure wildcard keeps the fast '*' path
    options.origin = allowCredentials ? true : '*';
  } else {
    options.origin = (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    };
  }

  const strict = env.CORS_STRICT_ORIGIN_CHECK !== 'false';

  function enforceOriginIsolation(req, res, next) {
    const origin = req.headers.origin;
    if (!strict || isOriginAllowed(origin, req)) return next();
    res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: `Origin '${origin}' is not allowed to access this API`,
    });
  }

  const corsMiddleware = cors((req, callback) => {
    callback(null, {
      ...options,
      origin:
        typeof options.origin === 'function'
          ? (origin, cb) => cb(null, isOriginAllowed(origin, req))
          : options.origin,
    });
  });

  return {
    ...policy,
    corsOptions: options,
    isOriginAllowed,
    corsMiddleware,
    enforceOriginIsolation,
  };
}

// dynamicOrigins: additional origins loaded at runtime (e.g. from the DB whitelist).
export function createCorsOptions(env = process.env, dynamicOrigins = null) {
  return createCorsPolicy(env, dynamicOrigins).corsOptions;
}

export const corsOptions = createCorsOptions();
