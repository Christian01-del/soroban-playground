import express from 'express';
import patentRegistryService from '../services/patentRegistryService.js';

const router = express.Router();

function actorFrom(req) {
  const headerActor = req.headers['x-actor-address'];
  if (typeof headerActor === 'string' && headerActor.trim()) {
    return headerActor.trim();
  }
  if (typeof req.body?.actor === 'string' && req.body.actor.trim()) {
    return req.body.actor.trim();
  }
  return '';
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorResponse(res, statusCode, message, details) {
  return res.status(statusCode).json({
    success: false,
    status: 'error',
    message,
    ...(details ? { details } : {}),
  });
}

function clampLimit(value, defaultValue, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), max);
}

router.get('/', async (_req, res) => {
  return res.json({
    success: true,
    status: 'success',
    message: 'Patent registry dashboard loaded',
    data: await patentRegistryService.getDashboard(),
  });
});

router.get('/health', async (_req, res) => {
  const dashboard = await patentRegistryService.getDashboard();
  return res.json({
    success: true,
    status: 'success',
    message: 'Patent registry service healthy',
    data: {
      status: 'ok',
      patentCount: dashboard.metrics.patentCount,
      verifiedCount: dashboard.metrics.verifiedCount,
      licenseCount: dashboard.metrics.licenseCount,
      paused: dashboard.paused,
      timestamp: new Date().toISOString(),
      service: 'soroban-playground-patent-registry',
    },
  });
});

// -----------------------------------------------------------------------------
// Patents collection — marketplace listing with filters, sorting, pagination
// -----------------------------------------------------------------------------

router.get('/patents', async (req, res) => {
  try {
    const {
      q: search,
      owner,
      verified,
      listed,
      sort = 'recent',
      order,
      page = '1',
      limit = '20',
    } = req.query;

    const result = patentRegistryService.listPatents({
      search: typeof search === 'string' ? search : '',
      owner: typeof owner === 'string' ? owner : '',
      verified:
        verified === 'true' ? true : verified === 'false' ? false : undefined,
      listed:
        listed === 'true' ? true : listed === 'false' ? false : undefined,
      sort: typeof sort === 'string' ? sort : 'recent',
      order: order === 'asc' ? 'asc' : 'desc',
      page: clampLimit(page, 1, 10000),
      limit: clampLimit(limit, 20, 100),
    });

    return res.json({
      success: true,
      status: 'success',
      message: 'Patents loaded',
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.post('/patents', async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push('actor is required');
  if (!isText(req.body?.title)) errors.push('title is required');
  if (!isText(req.body?.metadata_uri)) errors.push('metadata_uri is required');
  if (!isText(req.body?.metadata_hash))
    errors.push('metadata_hash is required');

  if (errors.length > 0) {
    return errorResponse(res, 400, 'Validation failed', errors);
  }

  try {
    const patent = patentRegistryService.registerPatent(
      actor,
      req.body.title.trim(),
      req.body.metadata_uri.trim(),
      req.body.metadata_hash.trim()
    );

    return res.status(201).json({
      success: true,
      status: 'success',
      message: 'Patent registered successfully',
      data: patent,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.get('/patents/:id', async (req, res) => {
  try {
    const patent = patentRegistryService.getPatent(Number(req.params.id));
    return res.json({
      success: true,
      status: 'success',
      message: 'Patent loaded',
      data: patent,
    });
  } catch (error) {
    return errorResponse(res, 404, error.message);
  }
});

router.patch('/patents/:id', async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push('actor is required');
  if (!isText(req.body?.title)) errors.push('title is required');
  if (!isText(req.body?.metadata_uri)) errors.push('metadata_uri is required');
  if (!isText(req.body?.metadata_hash))
    errors.push('metadata_hash is required');

  if (errors.length > 0) {
    return errorResponse(res, 400, 'Validation failed', errors);
  }

  try {
    const patent = patentRegistryService.updatePatent(
      actor,
      Number(req.params.id),
      req.body.title.trim(),
      req.body.metadata_uri.trim(),
      req.body.metadata_hash.trim()
    );

    return res.json({
      success: true,
      status: 'success',
      message: 'Patent updated successfully',
      data: patent,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Not patent owner' ? 403 : 500,
      error.message
    );
  }
});

router.post('/patents/:id/verify', async (req, res) => {
  const actor = actorFrom(req);

  if (!actor) {
    return errorResponse(res, 400, 'Validation failed', ['actor is required']);
  }

  try {
    const patent = patentRegistryService.verifyPatent(
      actor,
      Number(req.params.id)
    );
    return res.json({
      success: true,
      status: 'success',
      message: 'Patent verified successfully',
      data: patent,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Not verifier' ? 403 : 500,
      error.message
    );
  }
});

// -----------------------------------------------------------------------------
// Licensing marketplace + escrow flows
// -----------------------------------------------------------------------------

router.post('/patents/:id/licenses', async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push('actor is required');
  if (!isText(req.body?.licensee)) errors.push('licensee is required');
  if (!isText(req.body?.terms)) errors.push('terms is required');
  if (!isText(req.body?.payment_currency))
    errors.push('payment_currency is required');
  if (
    !Number.isFinite(req.body?.payment_amount) ||
    req.body.payment_amount <= 0
  ) {
    errors.push('payment_amount must be a positive number');
  }

  if (errors.length > 0) {
    return errorResponse(res, 400, 'Validation failed', errors);
  }

  try {
    const license = patentRegistryService.createLicenseOffer(
      actor,
      Number(req.params.id),
      req.body.licensee.trim(),
      req.body.terms.trim(),
      Number(req.body.payment_amount),
      req.body.payment_currency.trim()
    );

    return res.status(201).json({
      success: true,
      status: 'success',
      message: 'License offer created successfully',
      data: license,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Not patent owner' ? 403 : 500,
      error.message
    );
  }
});

router.get('/patents/:id/licenses', async (req, res) => {
  try {
    const licenses = patentRegistryService.getLicensesByPatent(
      Number(req.params.id)
    );
    return res.json({
      success: true,
      status: 'success',
      message: 'Licenses loaded',
      data: licenses,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.patch('/patents/:patent_id/licenses/:license_id', async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push('actor is required');
  if (!isText(req.body?.payment_reference))
    errors.push('payment_reference is required');

  if (errors.length > 0) {
    return errorResponse(res, 400, 'Validation failed', errors);
  }

  try {
    const license = patentRegistryService.acceptLicense(
      actor,
      Number(req.params.patent_id),
      Number(req.params.license_id),
      req.body.payment_reference.trim()
    );

    return res.json({
      success: true,
      status: 'success',
      message: 'License accepted successfully',
      data: license,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Unauthorized' ? 403 : 500,
      error.message
    );
  }
});

// Escrow funding — licensee deposits funds into escrow before acceptance.
Router.post('/patents/:patent_id/licenses/:license_id/escrow', async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push('actor is required');
  if (!isText(req.body?.payment_reference))
    errors.push('payment_reference is required');

  if (errors.length > 0) {
    return errorResponse(res, 400, 'Validation failed', errors);
  }

  try {
    const license = patentRegistryService.fundEscrow(
      actor,
      Number(req.params.patent_id),
      Number(req.params.license_id),
      req.body.payment_reference.trim()
    );

    return res.json({
      success: true,
      status: 'success',
      message: 'Escrow funded successfully',
      data: license,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Unauthorized' ? 403 : 500,
      error.message
    );
  }
});

// Escrow release — patent owner confirms delivery and releases funds.
Router.post('/patents/:patent_id/licenses/:license_id/escrow/release', async (req, res) => {
  const actor = actorFrom(req);

  if (!actor) {
    return errorResponse(res, 400, 'Validation failed', ['actor is required']);
  }

  try {
    const license = patentRegistryService.releaseEscrow(
      actor,
      Number(req.params.patent_id),
      Number(req.params.license_id)
    );

    return res.json({
      success: true,
      status: 'success',
      message: 'Escrow released successfully',
      data: license,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Unauthorized' ? 403 : 500,
      error.message
    );
  }
});

// Escrow refund — licensee can refund funds if offer expired or disputed.
Router.post('/patents/:patent_id/licenses/:license_id/escrow/refund', async (req, res) => {
  const actor = actorFrom(req);

  if (!actor) {
    return errorResponse(res, 400, 'Validation failed', ['actor is required']);
  }

  try {
    const license = patentRegistryService.refundEscrow(
      actor,
      Number(req.params.patent_id),
      Number(req.params.license_id)
    );

    return res.json({
      success: true,
      status: 'success',
      message: 'Escrow refunded successfully',
      data: license,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Unauthorized' ? 403 : 500,
      error.message
    );
  }
});

// -----------------------------------------------------------------------------
// Dispute dashboard flows
// -----------------------------------------------------------------------------

router.post('/patents/:patent_id/licenses/:license_id/disputes', async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push('actor is required');
  if (!isText(req.body?.reason)) errors.push('reason is required');

  if (errors.length > 0) {
    return errorResponse(res, 400, 'Validation failed', errors);
  }

  try {
    const dispute = patentRegistryService.openDispute(
      actor,
      Number(req.params.patent_id),
      Number(req.params.license_id),
      req.body.reason.trim()
    );

    return res.status(201).json({
      success: true,
      status: 'success',
      message: 'Dispute opened successfully',
      data: dispute,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Unauthorized' ? 403 : 500,
      error.message
    );
  }
});

router.get('/patents/:patent_id/licenses/:license_id/disputes', async (req, res) => {
  try {
    const disputes = patentRegistryService.getDisputesByLicense(
      Number(req.params.patent_id),
      Number(req.params.license_id)
    );
    return res.json({
      success: true,
      status: 'success',
      message: 'Disputes loaded',
      data: disputes,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.patch('/disputes/:dispute_id', async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push('actor is required');
  if (!isText(req.body?.resolution))
    errors.push('resolution is required');
  if (!isText(req.body?.status)) errors.push('status is required');

  if (errors.length > 0) {
    return errorResponse(res, 400, 'Validation failed', errors);
  }

  try {
    const dispute = patentRegistryService.resolveDispute(
      actor,
      Number(req.params.dispute_id),
      req.body.status.trim(),
      req.body.resolution.trim()
    );

    return res.json({
      success: true,
      status: 'success',
      message: 'Dispute resolved successfully',
      data: dispute,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === 'Unauthorized' ? 403 : 500,
      error.message
    );
  }
});

router.get('/disputes', async (req, res) => {
  try {
    const { status, page = '1', limit = '20' } = req.query;
    const result = patentRegistryService.listDisputes({
      status: typeof status === 'string' ? status : '',
      page: clampLimit(page, 1, 10000),
      limit: clampLimit(limit, 20, 100),
    });
    return res.json({
      success: true,
      status: 'success',
      message: 'Disputes loaded',
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

// -----------------------------------------------------------------------------
// IPFS document previewer + document metadata
// -----------------------------------------------------------------------------

router.get('/patents/:id/documents', async (req, res) => {
  try {
    const docs = await patentRegistryService.getPatentDocuments(
      Number(req.params.id)
    );
    return res.json({
      success: true,
      status: 'success',
      message: 'Patent documents loaded',
      data: docs,
    });
  } catch (error) {
    return errorResponse(res, 404, error.message);
  }
});

router.get('/patents/:id/documents/:docId', async (req, res) => {
  try {
    const doc = await patentRegistryService.getPatentDocument(
      Number(req.params.id),
      req.params.docId
    );
    return res.json({
      success: true,
      status: 'success',
      message: 'Patent document loaded',
      data: doc,
    });
  } catch (error) {
    return errorResponse(res, 404, error.message);
  }
});

// -----------------------------------------------------------------------------
// License collections
// -----------------------------------------------------------------------------

router.get('/licenses', async (req, res) => {
  try {
    const {
      status,
      licensee,
      licensor,
      patentId,
      page = '1',
      limit = '20',
    } = req.query;
    const result = patentRegistryService.listLicenses({
      status: typeof status === 'string' ? status : '',
      licensee: typeof licensee === 'string' ? licensee : '',
      licensor: typeof licensor === 'string' ? licensor : '',
      patentId: Number.isFinite(Number(patentId)) ? Number(patentId) : undefined,
      page: clampLimit(page, 1, 10000),
      limit: clampLimit(limit, 20, 100),
    });
    return res.json({
      success: true,
      status: 'success',
      message: 'Licenses loaded',
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.get('/licenses/:id', async (req, res) => {
  try {
    const license = patentRegistryService.getLicense(Number(req.params.id));
    return res.json({
      success: true,
      status: 'success',
      message: 'License loaded',
      data: license,
    });
  } catch (error) {
    return errorResponse(res, 404, error.message);
  }
});

export default router;
