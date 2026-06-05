import { Router, Request, Response, NextFunction, IRouter } from 'express';
import { AppRepository, BlogPostRepository } from '../../database/index.js';
import { Logger, log } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router: IRouter = Router();
const appRepo = new AppRepository();
const blogPostRepo = new BlogPostRepository();
const logger = Logger.create({ component: 'blog-posts-routes' });

// ============================================================================
// Middleware & Helpers
// ============================================================================

const withApp = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const app = appRepo.findById(id);
  if (!app) {
    logger.warn('route.blog-posts.app_not_found', { appId: id });
    return res.status(404).json({ error: 'App not found' });
  }

  res.locals.appId = id;
  return next();
});

const getAppId = (res: Response): string => res.locals.appId;

// ============================================================================
// Validation Helpers
// ============================================================================

interface ValidationResult {
  valid: boolean;
  error?: string;
  validValues?: string[];
}

function validateSlug(slug: unknown): ValidationResult {
  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    return { valid: false, error: 'slug must be a non-empty string' };
  }
  if (slug.length > 255) {
    return { valid: false, error: 'slug must not exceed 255 characters' };
  }
  return { valid: true };
}

function validateTitle(title: unknown): ValidationResult {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return { valid: false, error: 'title must be a non-empty string' };
  }
  return { valid: true };
}

function validateContentMarkdown(content: unknown): ValidationResult {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { valid: false, error: 'contentMarkdown must be a non-empty string' };
  }
  return { valid: true };
}

function validatePublishedAt(publishedAt: unknown): ValidationResult {
  if (publishedAt === null || publishedAt === undefined) {
    return { valid: true };
  }
  if (typeof publishedAt !== 'string') {
    return { valid: false, error: 'publishedAt must be an ISO 8601 datetime string' };
  }
  const date = new Date(publishedAt);
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'publishedAt must be a valid ISO 8601 datetime' };
  }
  return { valid: true };
}

function validateTags(tags: unknown): ValidationResult {
  if (tags === null || tags === undefined) {
    return { valid: true };
  }
  if (!Array.isArray(tags)) {
    return { valid: false, error: 'tags must be an array' };
  }
  if (!tags.every(tag => typeof tag === 'string')) {
    return { valid: false, error: 'tags must be an array of strings' };
  }
  return { valid: true };
}

function validatePublished(published: unknown): ValidationResult {
  if (published === null || published === undefined) {
    return { valid: true };
  }
  if (typeof published !== 'boolean') {
    return { valid: false, error: 'published must be a boolean' };
  }
  return { valid: true };
}

function validatePositiveInteger(value: string, fieldName: string): ValidationResult {
  // Strict numeric check - no trailing garbage
  if (!/^\d+$/.test(value)) {
    return { valid: false, error: `${fieldName} must be a positive integer` };
  }
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    return { valid: false, error: `${fieldName} must be >= 0` };
  }
  return { valid: true };
}

function validationError(res: Response, result: ValidationResult): Response {
  const response: Record<string, unknown> = { error: result.error };
  if (result.validValues) {
    response.validValues = result.validValues;
  }
  return res.status(400).json(response);
}

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const appId = req.params.id;
  const contextLogger = appId ? log.forApp(appId) : logger;

  log.error(contextLogger, 'route.blog-posts.error', err, {
    appId,
    path: req.path,
    method: req.method,
    error: err.message,
  });

  if (err.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({
      error: 'Duplicate entry',
      details: 'A resource with this unique identifier already exists',
    });
  }

  return res.status(500).json({
    error: 'Internal server error',
  });
}

// ============================================================================
// Authorization Middleware - MUST be before route definitions
// ============================================================================

/**
 * Validate app ownership for all /apps/:id routes
 *
 * This middleware ensures tenant isolation by verifying that the authenticated
 * siteId matches the requested appId.
 */
router.use('/apps/:id', validateAppOwnership);

// ============================================================================
// Blog Post Routes
// ============================================================================

/**
 * POST /apps/:id/blog/posts
 * Body: { slug, title, contentMarkdown, summary?, featuredImage?, tags?, published?, publishedAt?, campaignId? }
 */
router.post('/apps/:id/blog/posts', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { slug, title, contentMarkdown, summary, featuredImage, tags, published, publishedAt, campaignId } = req.body;

  // Validate required fields
  const slugValidation = validateSlug(slug);
  if (!slugValidation.valid) {
    return validationError(res, slugValidation);
  }

  const titleValidation = validateTitle(title);
  if (!titleValidation.valid) {
    return validationError(res, titleValidation);
  }

  const contentValidation = validateContentMarkdown(contentMarkdown);
  if (!contentValidation.valid) {
    return validationError(res, contentValidation);
  }

  // Validate optional fields
  const tagsValidation = validateTags(tags);
  if (!tagsValidation.valid) {
    return validationError(res, tagsValidation);
  }

  const publishedValidation = validatePublished(published);
  if (!publishedValidation.valid) {
    return validationError(res, publishedValidation);
  }

  const publishedAtValidation = validatePublishedAt(publishedAt);
  if (!publishedAtValidation.valid) {
    return validationError(res, publishedAtValidation);
  }

  // Semantic validation: published posts must have publishedAt
  const isPublished = published === true;
  const hasPublishedAt = publishedAt !== null && publishedAt !== undefined;

  if (isPublished && !hasPublishedAt) {
    return res.status(400).json({
      error: 'publishedAt is required when published is true',
      details: 'Published posts must have a publish date to be visible in listings',
    });
  }

  logger.info('route.blog-posts.create.begin', { appId, slug });

  // Check slug uniqueness
  const existing = blogPostRepo.findBySlug(appId, slug);
  if (existing) {
    logger.warn('route.blog-posts.duplicate_slug', { appId, slug });
    return res.status(409).json({
      error: 'Slug already exists for this app',
      details: `A post with slug '${slug}' already exists for app ${appId}`
    });
  }

  // Create post
  const post = blogPostRepo.create({
    appId,
    slug,
    title,
    contentMarkdown,
    summary: summary || null,
    featuredImage: featuredImage || null,
    tags: tags || null,
    published: isPublished,
    publishedAt: hasPublishedAt ? new Date(publishedAt) : null,
    campaignId: campaignId || null,
  });

  logger.info('route.blog-posts.create.success', { appId, postId: post.id, slug });
  return res.status(201).json(post);
}));

/**
 * GET /apps/:id/blog/posts
 * Query params: ?published=true&tag=marketing&limit=50&offset=0
 */
router.get('/apps/:id/blog/posts', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { published, tag, limit, offset } = req.query;

  logger.info('route.blog-posts.list.begin', { appId, published, tag, limit, offset });

  // Parse query parameters
  let publishedFilter: boolean | undefined;
  if (published === 'true') {
    publishedFilter = true;
  } else if (published === 'false') {
    publishedFilter = false;
  }

  // Validate pagination parameters with strict integer checks
  const limitStr = limit as string | undefined;
  const offsetStr = offset as string | undefined;

  if (limitStr) {
    const limitValidation = validatePositiveInteger(limitStr, 'limit');
    if (!limitValidation.valid) {
      return validationError(res, limitValidation);
    }
  }

  if (offsetStr) {
    const offsetValidation = validatePositiveInteger(offsetStr, 'offset');
    if (!offsetValidation.valid) {
      return validationError(res, offsetValidation);
    }
  }

  const limitNum = limitStr ? parseInt(limitStr, 10) : 50;
  const offsetNum = offsetStr ? parseInt(offsetStr, 10) : 0;

  // Range validation
  if (limitNum < 1 || limitNum > 100) {
    return res.status(400).json({ error: 'limit must be between 1 and 100' });
  }

  let posts;
  let hasMore = false;
  let totalCount: number;

  if (tag) {
    // For tag filtering, fetch all matching posts first to get accurate count
    // Then apply pagination (SQLite doesn't support JSON array queries efficiently)
    const allPosts = blogPostRepo.findByAppId(appId, {
      published: publishedFilter,
    });

    // Filter by tag in-memory
    const tagToFilter = tag as string;
    const tagFilteredPosts = allPosts.filter(post =>
      post.tags !== null && post.tags.includes(tagToFilter)
    );

    totalCount = tagFilteredPosts.length;

    // Apply pagination to filtered results
    posts = tagFilteredPosts.slice(offsetNum, offsetNum + limitNum);
    hasMore = offsetNum + limitNum < totalCount;
  } else {
    // No tag filter - use repository methods directly
    posts = blogPostRepo.findByAppId(appId, {
      published: publishedFilter,
      limit: limitNum + 1, // Fetch one extra to check hasMore
      offset: offsetNum,
    });

    // Check if there are more results
    if (posts.length > limitNum) {
      hasMore = true;
      posts = posts.slice(0, limitNum);
    }

    totalCount = blogPostRepo.count(appId, publishedFilter);
  }

  logger.info('route.blog-posts.list.success', {
    appId,
    count: posts.length,
    totalCount,
    hasMore,
    filters: { published: publishedFilter, tag }
  });

  return res.json({
    posts,
    count: posts.length,
    totalCount,
    hasMore,
    limit: limitNum,
    offset: offsetNum,
  });
}));

/**
 * GET /apps/:id/blog/posts/:postId
 */
router.get('/apps/:id/blog/posts/:postId', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { postId } = req.params;

  if (!postId) {
    return res.status(400).json({ error: 'Post ID is required' });
  }

  logger.info('route.blog-posts.get.begin', { appId, postId });

  const post = blogPostRepo.findById(postId);
  if (!post) {
    logger.warn('route.blog-posts.post_not_found', { appId, postId });
    return res.status(404).json({ error: 'Post not found' });
  }

  // Verify ownership
  if (post.appId !== appId) {
    logger.warn('route.blog-posts.get.unauthorized', {
      appId,
      postId,
      postAppId: post.appId,
    });
    return res.status(403).json({ error: 'Post does not belong to this app' });
  }

  logger.info('route.blog-posts.get.success', { appId, postId });
  return res.json(post);
}));

/**
 * PUT /apps/:id/blog/posts/:postId
 * Body: { slug?, title?, contentMarkdown?, summary?, featuredImage?, tags?, published?, publishedAt? }
 */
router.put('/apps/:id/blog/posts/:postId', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { postId } = req.params;
  const { slug, title, contentMarkdown, summary, featuredImage, tags, published, publishedAt } = req.body;

  if (!postId) {
    return res.status(400).json({ error: 'Post ID is required' });
  }

  logger.info('route.blog-posts.update.begin', { appId, postId });

  // Verify post exists
  const existingPost = blogPostRepo.findById(postId);
  if (!existingPost) {
    logger.warn('route.blog-posts.post_not_found', { appId, postId });
    return res.status(404).json({ error: 'Post not found' });
  }

  // Verify ownership
  if (existingPost.appId !== appId) {
    logger.warn('route.blog-posts.update.unauthorized', {
      appId,
      postId,
      postAppId: existingPost.appId,
    });
    return res.status(403).json({ error: 'Post does not belong to this app' });
  }

  // Validate fields if provided
  if (slug !== undefined) {
    const slugValidation = validateSlug(slug);
    if (!slugValidation.valid) {
      return validationError(res, slugValidation);
    }

    // Check slug uniqueness if slug is being changed
    if (slug !== existingPost.slug) {
      const duplicate = blogPostRepo.findBySlug(appId, slug);
      if (duplicate) {
        logger.warn('route.blog-posts.duplicate_slug', { appId, slug });
        return res.status(409).json({
          error: 'Slug already exists for this app',
          details: `A post with slug '${slug}' already exists for app ${appId}`
        });
      }
    }
  }

  if (title !== undefined) {
    const titleValidation = validateTitle(title);
    if (!titleValidation.valid) {
      return validationError(res, titleValidation);
    }
  }

  if (contentMarkdown !== undefined) {
    const contentValidation = validateContentMarkdown(contentMarkdown);
    if (!contentValidation.valid) {
      return validationError(res, contentValidation);
    }
  }

  if (tags !== undefined) {
    const tagsValidation = validateTags(tags);
    if (!tagsValidation.valid) {
      return validationError(res, tagsValidation);
    }
  }

  if (published !== undefined) {
    const publishedValidation = validatePublished(published);
    if (!publishedValidation.valid) {
      return validationError(res, publishedValidation);
    }
  }

  if (publishedAt !== undefined) {
    const publishedAtValidation = validatePublishedAt(publishedAt);
    if (!publishedAtValidation.valid) {
      return validationError(res, publishedAtValidation);
    }
  }

  // At least one field must be provided
  if (slug === undefined && title === undefined && contentMarkdown === undefined &&
      summary === undefined && featuredImage === undefined && tags === undefined &&
      published === undefined && publishedAt === undefined) {
    return res.status(400).json({ error: 'At least one field must be provided for update' });
  }

  // Semantic validation: if setting published to true, must have publishedAt
  const finalPublished = published !== undefined ? published : existingPost.published;
  const finalPublishedAt = publishedAt !== undefined
    ? (publishedAt ? new Date(publishedAt) : null)
    : existingPost.publishedAt;

  if (finalPublished === true && finalPublishedAt === null) {
    return res.status(400).json({
      error: 'publishedAt is required when published is true',
      details: 'Published posts must have a publish date to be visible in listings',
    });
  }

  // Update post
  const updatedPost = blogPostRepo.update(postId, {
    slug,
    title,
    contentMarkdown,
    summary: summary === null ? null : summary,
    featuredImage: featuredImage === null ? null : featuredImage,
    tags: tags === null ? null : tags,
    published,
    publishedAt: publishedAt !== undefined
      ? (publishedAt ? new Date(publishedAt) : null)
      : undefined,
  });

  logger.info('route.blog-posts.update.success', { appId, postId });
  return res.json(updatedPost);
}));

/**
 * DELETE /apps/:id/blog/posts/:postId
 */
router.delete('/apps/:id/blog/posts/:postId', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { postId } = req.params;

  if (!postId) {
    return res.status(400).json({ error: 'Post ID is required' });
  }

  logger.info('route.blog-posts.delete.begin', { appId, postId });

  // Verify post exists
  const existingPost = blogPostRepo.findById(postId);
  if (!existingPost) {
    logger.warn('route.blog-posts.post_not_found', { appId, postId });
    return res.status(404).json({ error: 'Post not found' });
  }

  // Verify ownership
  if (existingPost.appId !== appId) {
    logger.warn('route.blog-posts.delete.unauthorized', {
      appId,
      postId,
      postAppId: existingPost.appId,
    });
    return res.status(403).json({ error: 'Post does not belong to this app' });
  }

  // Delete post
  blogPostRepo.delete(postId);

  logger.info('route.blog-posts.delete.success', { appId, postId });
  return res.status(204).send();
}));

// Apply error handler
router.use(errorHandler);

export default router;
