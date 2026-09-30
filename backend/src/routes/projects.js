// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { getDatabase } from '../database/connection.js';
import { QueryBuilder } from '../services/queryBuilder.js';
import { authenticate, requirePermission } from '../middleware/auth.js';

const router = express.Router();
const projectQueryBuilder = new QueryBuilder('projects');

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const VALID_STATUSES = ['active', 'completed', 'draft', 'archived'];

function parseTagsSafely(rawTags, fallback = []) {
  if (rawTags == null) return fallback;
  if (Array.isArray(rawTags)) return rawTags;
  if (typeof rawTags !== 'string') return fallback;
  try {
    const parsed = JSON.parse(rawTags);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function validateProjectPayload(
  { title, description, category, status, funding_goal },
  isUpdate = false
) {
  const errors = [];

  if (!isUpdate) {
    if (!title) errors.push('title is required');
    if (!description) errors.push('description is required');
    if (!category) errors.push('category is required');
    if (!status) errors.push('status is required');
    if (funding_goal === undefined) errors.push('funding_goal is required');
  }

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      errors.push('title must be a non-empty string');
    } else if (title.length > MAX_TITLE_LENGTH) {
      errors.push(`title must be at most ${MAX_TITLE_LENGTH} characters`);
    }
  }

  if (description !== undefined) {
    if (typeof description !== 'string' || !description.trim()) {
      errors.push('description must be a non-empty string');
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(
        `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`
      );
    }
  }

  if (
    status !== undefined &&
    VALID_STATUSES.length > 0 &&
    !VALID_STATUSES.includes(status)
  ) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (funding_goal !== undefined) {
    const goal = Number(funding_goal);
    if (!Number.isFinite(goal) || goal < 0) {
      errors.push('funding_goal must be a non-negative number');
    }
  }

  return errors.length > 0 ? errors : null;
}

// Apply authentication to all projects routes
router.use(authenticate);

/**
 * GET /api/projects
 * Lists projects for the authenticated user, enforcing RLS.
 */
router.get(
  '/',
  requirePermission('project:read'),
  asyncHandler(async (req, res, next) => {
    try {
      const db = getDatabase();

      const limitRaw = parseInt(req.query.limit, 10);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(limitRaw, 100)
          : 50;
      const filter = {};
      if (req.query.category) filter.category = req.query.category;
      if (req.query.status) filter.status = req.query.status;

      const { sql, params } = projectQueryBuilder.buildFullQuery(
        { filter, limit },
        req.user,
        'read'
      );

      const projects = await db.all(sql, params);

      const formatted = projects.map((p) => ({
        ...p,
        tags: parseTagsSafely(p.tags),
      }));

      return res.json({ success: true, projects: formatted });
    } catch (err) {
      return next(
        createHttpError(500, 'Failed to list projects', { cause: err.message })
      );
    }
  })
);

/**
 * GET /api/projects/:id
 * Retrieve a specific project if owned by the user (or admin).
 */
router.get(
  '/:id',
  requirePermission('project:read'),
  asyncHandler(async (req, res, next) => {
    try {
      const db = getDatabase();
      const { id } = req.params;

      if (!id || isNaN(Number(id))) {
        return next(
          createHttpError(400, 'Invalid project id', { field: 'id' })
        );
      }

      const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
      if (!project) {
        return next(createHttpError(404, 'Project not found'));
      }

      if (req.user.role !== 'admin' && project.creator_id !== req.user.id) {
        return next(
          createHttpError(403, 'Forbidden: You do not own this project')
        );
      }

      project.tags = parseTagsSafely(project.tags);
      return res.json({ success: true, project });
    } catch (err) {
      return next(
        createHttpError(500, 'Failed to retrieve project', {
          cause: err.message,
        })
      );
    }
  })
);

/**
 * POST /api/projects
 * Create a new project.
 */
router.post(
  '/',
  requirePermission('project:create'),
  asyncHandler(async (req, res, next) => {
    const { title, description, category, status, funding_goal, tags } =
      req.body || {};

    const validationErrors = validateProjectPayload(
      { title, description, category, status, funding_goal },
      false
    );
    if (validationErrors) {
      return next(
        createHttpError(400, 'Validation failed', { errors: validationErrors })
      );
    }

    if (tags !== undefined && !Array.isArray(tags)) {
      return next(
        createHttpError(400, 'tags must be an array', { field: 'tags' })
      );
    }

    try {
      const db = getDatabase();
      const creatorId = req.user.id;
      const creatorName = req.user.username;
      const tagsJson = JSON.stringify(tags || []);

      const result = await db.run(
        `INSERT INTO projects (title, description, category, status, creator_id, creator_name, funding_goal, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          description,
          category,
          status,
          creatorId,
          creatorName,
          funding_goal,
          tagsJson,
        ]
      );

      const newProject = {
        id: result.lastID,
        title,
        description,
        category,
        status,
        creator_id: creatorId,
        creator_name: creatorName,
        funding_goal,
        tags: tags || [],
      };

      return res.status(201).json({ success: true, project: newProject });
    } catch (err) {
      return next(
        createHttpError(500, 'Failed to create project', { cause: err.message })
      );
    }
  })
);

/**
 * PUT /api/projects/:id
 * Update an existing project if owned by the user (or admin).
 */
router.put(
  '/:id',
  requirePermission('project:update'),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return next(createHttpError(400, 'Invalid project id', { field: 'id' }));
    }

    const { title, description, category, status, funding_goal, tags } =
      req.body || {};

    const validationErrors = validateProjectPayload(
      { title, description, category, status, funding_goal },
      true
    );
    if (validationErrors) {
      return next(
        createHttpError(400, 'Validation failed', { errors: validationErrors })
      );
    }

    if (tags !== undefined && !Array.isArray(tags)) {
      return next(
        createHttpError(400, 'tags must be an array', { field: 'tags' })
      );
    }

    try {
      const db = getDatabase();

      const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
      if (!project) {
        return next(createHttpError(404, 'Project not found'));
      }

      if (req.user.role !== 'admin' && project.creator_id !== req.user.id) {
        return next(
          createHttpError(403, 'Forbidden: You do not own this project')
        );
      }

      const updatedTitle = title !== undefined ? title : project.title;
      const updatedDesc =
        description !== undefined ? description : project.description;
      const updatedCat = category !== undefined ? category : project.category;
      const updatedStatus = status !== undefined ? status : project.status;
      const updatedGoal =
        funding_goal !== undefined ? funding_goal : project.funding_goal;
      const updatedTags =
        tags !== undefined ? JSON.stringify(tags) : project.tags;

      await db.run(
        `UPDATE projects
         SET title = ?, description = ?, category = ?, status = ?, funding_goal = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          updatedTitle,
          updatedDesc,
          updatedCat,
          updatedStatus,
          updatedGoal,
          updatedTags,
          id,
        ]
      );

      const updatedProject = {
        id: parseInt(id, 10),
        title: updatedTitle,
        description: updatedDesc,
        category: updatedCat,
        status: updatedStatus,
        creator_id: project.creator_id,
        creator_name: project.creator_name,
        funding_goal: updatedGoal,
        tags: tags !== undefined ? tags : parseTagsSafely(project.tags),
      };

      return res.json({ success: true, project: updatedProject });
    } catch (err) {
      return next(
        createHttpError(500, 'Failed to update project', { cause: err.message })
      );
    }
  })
);

/**
 * DELETE /api/projects/:id
 * Delete an existing project if owned by the user (or admin).
 */
router.delete(
  '/:id',
  requirePermission('project:delete'),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return next(createHttpError(400, 'Invalid project id', { field: 'id' }));
    }

    try {
      const db = getDatabase();

      const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
      if (!project) {
        return next(createHttpError(404, 'Project not found'));
      }

      if (req.user.role !== 'admin' && project.creator_id !== req.user.id) {
        return next(
          createHttpError(403, 'Forbidden: You do not own this project')
        );
      }

      await db.run('DELETE FROM projects WHERE id = ?', [id]);

      return res.json({
        success: true,
        message: 'Project deleted successfully',
      });
    } catch (err) {
      return next(
        createHttpError(500, 'Failed to delete project', { cause: err.message })
      );
    }
  })
);

export default router;
