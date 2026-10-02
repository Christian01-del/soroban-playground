import express from 'express';
import authService from '../services/authService.js';
import {
  generateNonce,
  verifyJwtMiddleware,
  signAccessToken,
  revokeAccessToken,
} from '../middleware/challengeAuth.js';

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

export const requireAuth = async (req, res, next) => {
  try {
    let token = null;

    if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    } else if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = await authService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.message === 'Token is blacklisted') {
      return res.status(401).json({ error: 'Token is invalid or blacklisted' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const setCookies = (res, accessToken, refreshToken) => {
  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

router.post('/login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(501).json({
      error: 'Password demo login is disabled; use wallet authentication',
    });
  }
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const dummyUser = { id: 'user_123', username };
    const { accessToken, refreshToken } =
      await authService.generateTokens(dummyUser);

    setCookies(res, accessToken, refreshToken);

    return res
      .status(200)
      .json({ success: true, message: 'Logged in successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// SEP-0010 Challenge Generation
router.get('/challenge', async (req, res) => {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ error: 'address query parameter required' });
  }
  try {
    const challenge = await authService.generateStellarChallenge(address);
    return res.json(challenge);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/auth/nonce?address=G...
 * Issues a replay-resistant nonce bound to the given Stellar address (#1576).
 * The nonce must be included as X-Request-Nonce on subsequent challenge-verify requests.
 */
router.get('/nonce', async (req, res) => {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ error: 'address query parameter required' });
  }
  try {
    const nonce = await generateNonce(address);
    return res.json({
      nonce,
      expiresInSeconds:
        Number.parseInt(process.env.SEP10_CHALLENGE_TTL_MS || '300000', 10) /
        1000,
      address,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// SEP-0010 Challenge Verification and Token Issuance
router.post('/verify', async (req, res) => {
  const { address, transactionXDR } = req.body;
  if (!address || !transactionXDR) {
    return res
      .status(400)
      .json({ error: 'address and transactionXDR required' });
  }
  try {
    const tokens = await authService.verifyStellarChallengeAndIssueTokens(
      address,
      transactionXDR
    );
    setCookies(res, tokens.accessToken, tokens.refreshToken);
    return res.json({ success: true, accessToken: tokens.accessToken });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const { accessToken: newAccess, refreshToken: newRefresh } =
      await authService.rotateRefreshToken(refreshToken);

    setCookies(res, newAccess, newRefresh);

    return res.status(200).json({ success: true, accessToken: newAccess });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await authService.revokeRefreshToken(req.cookies?.refreshToken);
    let user;
    try {
      const accessToken =
        req.cookies?.accessToken ||
        req.headers.authorization?.replace(/^Bearer /, '');
      if (accessToken) user = await authService.verifyAccessToken(accessToken);
    } catch {
      // Expired access cookies must not prevent refresh-session revocation.
    }
    if (user && user.jti && user.exp) {
      await authService.blacklistAccessToken(user.jti, user.exp);
    }

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return res
      .status(200)
      .json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
