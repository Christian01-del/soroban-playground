// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { deployBatchContracts, deployContract } from '../../services/deployService.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validation.js';
import {
  deployBodyV1,
  deployBatchBodyV1,
  jobIdParams,
} from '../../schemas/sorobanSchemas.js';

const router = express.Router();

router.post(
  '/',
  rateLimitMiddleware('deploy'),
  validateRequest({ body: deployBodyV1 }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const {
      wasmPath,
      contractName,
      network = 'testnet',
      sourceAccount,
    } = req.body;

    const contract = {
      id: contractName,
      contractName,
      wasmPath,
      network,
      sourceAccount,
    };

    try {
      const result = await deployContract(contract);
      return res.json({
        success: true,
        status: 'success',
        contractId: result.contractId,
        contractName,
        network,
        wasmPath,
        deployedAt: new Date().toISOString(),
        message: `Contract "${contractName}" deployed successfully to ${network}`,
      });
    } catch (error) {
      return next(
        createHttpError(502, 'Contract deployment failed', [error.message])
      );
    }
  })
);

router.post(
  '/batch',
  rateLimitMiddleware('deploy'),
  validateRequest({ body: deployBatchBodyV1 }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());

    try {
      const result = await deployBatchContracts(
        {
          requestId: `batch-${Date.now()}`,
          batchId: req.body.batchId,
          contracts: req.body.contracts,
        },
        { signal: controller.signal }
      );

      return res.json(result);
    } catch (error) {
      return next(
        createHttpError(502, 'Batch deployment failed', [error.message])
      );
    }
  })
);

// Memory fallback for deployment jobs in test/offline environments
const inMemoryDeployJobs = new Map();

router.post(
  '/async',
  rateLimitMiddleware('deploy'),
  validateRequest({ body: deployBodyV1 }, { format: 'httpError' }),
  asyncHandler(async (req, res) => {
    const {
      wasmPath,
      contractName,
      network = 'testnet',
      sourceAccount,
    } = req.body;

    const jobId = `deploy-job-${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}`;

    try {
      const { queues } = await import('../../services/queueService.js');
      if (queues && queues.deployment) {
        await queues.deployment.add(
          'deploy-contract',
          {
            wasmPath,
            contractName,
            network,
            sourceAccount,
          },
          { jobId }
        );
      } else {
        inMemoryDeployJobs.set(jobId, {
          status: 'queued',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      inMemoryDeployJobs.set(jobId, {
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
    }

    return res.status(202).json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Deployment job queued asynchronously',
      createdAt: new Date().toISOString(),
    });
  })
);

router.get(
  '/job/:jobId',
  validateRequest({ params: jobIdParams }, { format: 'httpError' }),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    try {
      const { queues } = await import('../../services/queueService.js');
      if (queues && queues.deployment) {
        const job = await queues.deployment.getJob(jobId);
        if (job) {
          const state = await job.getState();
          return res.json({
            success: true,
            jobId,
            status: state,
            result: job.returnvalue || null,
            failedReason: job.failedReason || null,
          });
        }
      }
    } catch {
      // Fall through to memory check
    }

    const memoryJob = inMemoryDeployJobs.get(jobId);
    if (memoryJob) {
      return res.json({
        success: true,
        jobId,
        status: memoryJob.status,
        result: memoryJob.result || null,
      });
    }

    return res.status(404).json({
      success: false,
      error: 'Deployment job not found',
    });
  })
);

export default router;
