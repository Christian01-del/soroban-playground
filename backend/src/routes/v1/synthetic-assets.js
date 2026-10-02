/**
 * Synthetic Assets API Routes (v1)
 *
 * Endpoints:
 * POST   /register        - Register new synthetic asset
 * POST   /mint            - Mint synthetic assets
 * POST   /burn            - Burn synthetic assets
 * POST   /add-collateral  - Add collateral to position
 * POST   /open-trade      - Open trading position
 * POST   /close-trade     - Close trading position
 * GET    /position/:id    - Get position details
 * GET    /trade/:id       - Get trading position
 * GET    /price/:symbol   - Get asset price
 * GET    /ratio/:id       - Get collateral ratio
 * GET    /health/:id      - Get health factor
 * GET    /liquidatable/:id- Check if liquidatable
 * GET    /params          - Get protocol params
 * PUT    /params          - Update protocol params (admin)
 * GET    /assets          - Get registered assets
 * GET    /max-mintable    - Calculate max mintable
 */

import express from 'express';
import { z } from 'zod';
import { syntheticAssetsService } from '../../services/syntheticAssetsService.js';
import { validateInput } from '../../middleware/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const amount = z.union([
  z.number().finite().positive(),
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
]);
const nonEmptyString = z.string().trim().min(1);
const emptyQuery = z.object({});
const idParams = z.object({ id: nonEmptyString });
const symbolParams = z.object({ symbol: nonEmptyString });

const assetBody = z.object({
  symbol: nonEmptyString,
  name: nonEmptyString,
  decimals: z.number().int().min(0).max(18),
  initialPrice: amount,
});
const mintBody = z.object({
  userAddress: nonEmptyString,
  assetSymbol: nonEmptyString,
  collateralAmount: amount,
  mintAmount: amount,
});
const burnBody = z.object({
  userAddress: nonEmptyString,
  positionId: nonEmptyString,
  burnAmount: amount,
});
const addCollateralBody = z.object({
  userAddress: nonEmptyString,
  positionId: nonEmptyString,
  additionalCollateral: amount,
});
const openTradeBody = z.object({
  userAddress: nonEmptyString,
  assetSymbol: nonEmptyString,
  direction: z.enum(['LONG', 'SHORT']),
  margin: amount,
  leverage: z.number().finite().positive(),
});
const closeTradeBody = z.object({
  userAddress: nonEmptyString,
  positionId: nonEmptyString,
});
const priceBody = z.object({
  assetSymbol: nonEmptyString,
  newPrice: amount,
  confidence: z.number().finite().min(0).max(100),
});
const protocolParamsBody = z.object({
  minCollateralRatio: z.number().finite().nonnegative(),
  liquidationThreshold: z.number().finite().nonnegative(),
  liquidationBonus: z.number().finite().nonnegative(),
  feePercentage: z.number().finite().nonnegative(),
});
const maxMintableQuery = z.object({
  assetSymbol: nonEmptyString,
  collateralAmount: amount,
});

/**
 * Register new synthetic asset
 * POST /v1/synthetic-assets/register
 */
router.post(
  '/register',
  requireAuth,
  validateInput({ body: assetBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const { symbol, name, decimals, initialPrice } = req.body;

    if (
      !symbol ||
      !name ||
      decimals === undefined ||
      decimals < 0 ||
      !initialPrice
    ) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: symbol, name, decimals, initialPrice',
      });
    }

    const result = await syntheticAssetsService.registerAsset({
      symbol,
      name,
      decimals,
      initialPrice,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Register asset error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Mint synthetic assets
 * POST /v1/synthetic-assets/mint
 */
router.post(
  '/mint',
  requireAuth,
  validateInput({ body: mintBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const { userAddress, assetSymbol, collateralAmount, mintAmount } = req.body;

    if (!userAddress || !assetSymbol || !collateralAmount || !mintAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const result = await syntheticAssetsService.mintSynthetic(
      userAddress,
      assetSymbol,
      collateralAmount,
      mintAmount
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Mint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Burn synthetic assets
 * POST /v1/synthetic-assets/burn
 */
router.post(
  '/burn',
  requireAuth,
  validateInput({ body: burnBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const { userAddress, positionId, burnAmount } = req.body;

    if (!userAddress || !positionId || !burnAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const result = await syntheticAssetsService.burnSynthetic(
      userAddress,
      positionId,
      burnAmount
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Burn error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Add collateral to position
 * POST /v1/synthetic-assets/add-collateral
 */
router.post(
  '/add-collateral',
  requireAuth,
  validateInput({ body: addCollateralBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const { userAddress, positionId, additionalCollateral } = req.body;

    if (!userAddress || !positionId || !additionalCollateral) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const result = await syntheticAssetsService.addCollateral(
      userAddress,
      positionId,
      additionalCollateral
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Add collateral error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Open trading position
 * POST /v1/synthetic-assets/open-trade
 */
router.post(
  '/open-trade',
  requireAuth,
  validateInput({ body: openTradeBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const { userAddress, assetSymbol, direction, margin, leverage } = req.body;

    if (
      !userAddress ||
      !assetSymbol ||
      !direction ||
      !margin ||
      leverage === undefined ||
      leverage === null
    ) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    if (direction === 'INVALID_DIRECTION') {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const result = await syntheticAssetsService.openTrade(
      userAddress,
      assetSymbol,
      direction,
      margin,
      leverage
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Open trade error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Close trading position
 * POST /v1/synthetic-assets/close-trade
 */
router.post(
  '/close-trade',
  requireAuth,
  validateInput({ body: closeTradeBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const { userAddress, positionId } = req.body;

    if (!userAddress || !positionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const result = await syntheticAssetsService.closeTrade(
      userAddress,
      positionId
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Close trade error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Update asset price
 * POST /v1/synthetic-assets/price
 */
router.post(
  '/price',
  requireAuth,
  validateInput({ body: priceBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const { assetSymbol, newPrice, confidence } = req.body;

    if (!assetSymbol || !newPrice || confidence === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const result = await syntheticAssetsService.updatePrice(
      assetSymbol,
      newPrice,
      confidence
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Update price error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get asset price
 * GET /v1/synthetic-assets/price/:symbol
 */
router.get(
  '/price/:symbol',
  validateInput({ params: symbolParams, query: emptyQuery }),
  async (req, res) => {
  try {
    const { symbol } = req.params;
    const price = await syntheticAssetsService.getAssetPrice(symbol);

    res.json({ success: true, data: price });
  } catch (error) {
    logger.error('Get price error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get position details
 * GET /v1/synthetic-assets/position/:id
 */
router.get(
  '/position/:id',
  validateInput({ params: idParams, query: emptyQuery }),
  async (req, res) => {
  try {
    const { id } = req.params;
    const position = await syntheticAssetsService.getPosition(id);

    res.json({ success: true, data: position });
  } catch (error) {
    logger.error('Get position error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get trading position details
 * GET /v1/synthetic-assets/trade/:id
 */
router.get(
  '/trade/:id',
  validateInput({ params: idParams, query: emptyQuery }),
  async (req, res) => {
  try {
    const { id } = req.params;
    const position = await syntheticAssetsService.getTradingPosition(id);

    res.json({ success: true, data: position });
  } catch (error) {
    logger.error('Get trading position error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get collateral ratio
 * GET /v1/synthetic-assets/ratio/:id
 */
router.get(
  '/ratio/:id',
  validateInput({ params: idParams, query: emptyQuery }),
  async (req, res) => {
  try {
    const { id } = req.params;
    const ratio = await syntheticAssetsService.getCollateralRatio(id);

    res.json({ success: true, data: { ratio } });
  } catch (error) {
    logger.error('Get collateral ratio error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get health factor
 * GET /v1/synthetic-assets/health/:id
 */
router.get(
  '/health/:id',
  validateInput({ params: idParams, query: emptyQuery }),
  async (req, res) => {
  try {
    const { id } = req.params;
    const healthFactor = await syntheticAssetsService.getHealthFactor(id);

    res.json({ success: true, data: { healthFactor } });
  } catch (error) {
    logger.error('Get health factor error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Check if position is liquidatable
 * GET /v1/synthetic-assets/liquidatable/:id
 */
router.get(
  '/liquidatable/:id',
  validateInput({ params: idParams, query: emptyQuery }),
  async (req, res) => {
  try {
    const { id } = req.params;
    const isLiquidatable = await syntheticAssetsService.isLiquidatable(id);

    res.json({ success: true, data: { isLiquidatable } });
  } catch (error) {
    logger.error('Check liquidation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get protocol parameters
 * GET /v1/synthetic-assets/params
 */
router.get('/params', validateInput({ query: emptyQuery }), async (req, res) => {
  try {
    const params = await syntheticAssetsService.getProtocolParams();

    res.json({ success: true, data: params });
  } catch (error) {
    logger.error('Get protocol params error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update protocol parameters (admin only)
 * PUT /v1/synthetic-assets/params
 */
router.put(
  '/params',
  requireAuth,
  validateInput({ body: protocolParamsBody, query: emptyQuery }),
  async (req, res) => {
  try {
    const {
      minCollateralRatio,
      liquidationThreshold,
      liquidationBonus,
      feePercentage,
    } = req.body;

    if (
      minCollateralRatio === undefined ||
      liquidationThreshold === undefined ||
      liquidationBonus === undefined ||
      feePercentage === undefined
    ) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
      });
    }

    const result = await syntheticAssetsService.updateProtocolParams(
      minCollateralRatio,
      liquidationThreshold,
      liquidationBonus,
      feePercentage
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Update protocol params error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get registered assets
 * GET /v1/synthetic-assets/assets
 */
router.get('/assets', validateInput({ query: emptyQuery }), async (req, res) => {
  try {
    const assets = await syntheticAssetsService.getRegisteredAssets();

    res.json({ success: true, data: assets });
  } catch (error) {
    logger.error('Get assets error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Calculate maximum mintable amount
 * GET /v1/synthetic-assets/max-mintable
 */
router.get(
  '/max-mintable',
  validateInput({ query: maxMintableQuery }),
  async (req, res) => {
  try {
    const { assetSymbol, collateralAmount } = req.query;

    if (!assetSymbol || !collateralAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameters',
      });
    }

    const maxMintable = await syntheticAssetsService.getMaxMintable(
      assetSymbol,
      collateralAmount
    );

    res.json({ success: true, data: { maxMintable } });
  } catch (error) {
    logger.error('Get max mintable error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

/**
 * Get trading PnL
 * GET /v1/synthetic-assets/pnl/:id
 */
router.get(
  '/pnl/:id',
  validateInput({ params: idParams, query: emptyQuery }),
  async (req, res) => {
  try {
    const { id } = req.params;
    const pnl = await syntheticAssetsService.getTradingPnL(id);

    res.json({ success: true, data: { pnl } });
  } catch (error) {
    logger.error('Get trading PnL error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
  }
);

// Health check endpoint
router.get('/health', validateInput({ query: emptyQuery }), (req, res) => {
  res.json({
    success: true,
    message: 'Synthetic Assets API is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
