import { Router, Request, Response, NextFunction, IRouter } from 'express';
import { AppRepository } from '../../database/index.js';
import {
  SocialAssociationRepository,
  SocialPostRepository
} from '../../database/index.js';
import { SocialPlatform, PostState, getAllPlatforms, getAllPostStates } from '../../types/social.js';
import { Logger, log } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createForWorkspace } from '../../workspace/index.js';
import { GitUtils } from '../../utils/git.js';

const router: IRouter = Router();
const appRepo = new AppRepository();
const socialAssociationRepo = new SocialAssociationRepository();
const socialPostRepo = new SocialPostRepository();
const logger = Logger.create({ component: 'social-routes' });
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
    logger.warn('route.social.app_not_found', { appId: id });
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

function validateSocialId(socialId: unknown): ValidationResult {
  if (!socialId || typeof socialId !== 'string' || socialId.trim().length === 0) {
    return { valid: false, error: 'socialId must be a non-empty string' };
  }
  if (socialId.length > 255) {
    return { valid: false, error: 'socialId must not exceed 255 characters' };
  }
  return { valid: true };
}

function validatePlatform(platform: unknown): ValidationResult {
  const validPlatforms = getAllPlatforms();
  if (!platform || !validPlatforms.includes(platform as SocialPlatform)) {
    return { valid: false, error: 'Invalid platform', validValues: validPlatforms };
  }
  return { valid: true };
}

function validatePostState(state: unknown): ValidationResult {
  const validStates = getAllPostStates();
  if (!state || !validStates.includes(state as PostState)) {
    return { valid: false, error: 'Invalid state', validValues: validStates };
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

  log.error(contextLogger, 'route.social.error', err, {
    appId,
    path: req.path,
    method: req.method,
    error: err.message,
  });

  if (err.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({
      error: 'An association with this social account already exists',
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
 * siteId matches the requested appId. See agents/CLAUDE.md for security patterns.
 */
router.use('/apps/:id', validateAppOwnership);

// ============================================================================
// Association Routes
// ============================================================================

/**
 * GET /apps/:id/social/associations
 */
router.get('/apps/:id/social/associations', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);

  logger.info('route.social.associations.list.begin', { appId });

  const associations = socialAssociationRepo.findByAppId(appId);

  logger.info('route.social.associations.list.success', { appId, count: associations.length });

  return res.json({ associations });
}));

/**
 * POST /apps/:id/social/associations
 * Body: { socialId: string, platform: string }
 */
router.post('/apps/:id/social/associations', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { socialId, platform } = req.body;

  const socialIdValidation = validateSocialId(socialId);
  if (!socialIdValidation.valid) {
    return validationError(res, socialIdValidation);
  }

  const platformValidation = validatePlatform(platform);
  if (!platformValidation.valid) {
    return validationError(res, platformValidation);
  }

  logger.info('route.social.associations.create.begin', { appId, socialId, platform });

  const association = socialAssociationRepo.create({
    appId,
    socialId,
    platform: platform as SocialPlatform,
  });

  logger.info('route.social.associations.create.success', {
    appId,
    socialId,
    platform,
    associationId: association.id,
  });

  return res.status(201).json({ association });
}));

/**
 * DELETE /apps/:id/social/associations/:associationId
 */
router.delete('/apps/:id/social/associations/:associationId', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { associationId } = req.params;

  if (!associationId) {
    return res.status(400).json({ error: 'Association ID is required' });
  }

  logger.info('route.social.associations.delete.begin', { appId, associationId });

  const association = socialAssociationRepo.findById(associationId);
  if (!association) {
    logger.warn('route.social.associations.delete.not_found', { appId, associationId });
    return res.status(404).json({ error: 'Association not found' });
  }

  if (association.appId !== appId) {
    logger.warn('route.social.associations.delete.unauthorized', {
      appId,
      associationId,
      associationAppId: association.appId,
    });
    return res.status(403).json({ error: 'Association does not belong to this app' });
  }

  const deleted = socialAssociationRepo.delete(associationId);
  if (!deleted) {
    return res.status(500).json({ error: 'Failed to delete association' });
  }

  logger.info('route.social.associations.delete.success', { appId, associationId });

  return res.json({ success: true });
}));

// ============================================================================
// Post Routes
// ============================================================================

/**
 * GET /apps/:id/social/posts
 * Query params: ?state=PUBLISHED&platform=facebook&limit=50
 */
router.get('/apps/:id/social/posts', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { state, platform, limit } = req.query;

  logger.info('route.social.posts.list.begin', { appId, state, platform, limit });

  let posts;
  if (state) {
    posts = socialPostRepo.findByAppAndState(appId, state as PostState);
  } else if (platform) {
    posts = socialPostRepo.findByAppAndPlatform(appId, platform as string);
  } else {
    const limitNum = limit ? parseInt(limit as string, 10) : undefined;
    posts = socialPostRepo.findByAppId(appId, limitNum);
  }

  logger.info('route.social.posts.list.success', { appId, count: posts.length, state, platform });

  return res.json({ posts, count: posts.length });
}));

/**
 * POST /apps/:id/social/posts
 * Body: {
 *   associationId?: string,
 *   platform: string,
 *   state: 'SCHEDULED' | 'PUBLISHED' | 'FAILED',
 *   payload: object,
 *   externalResponse?: object,
 *   externalId?: string,
 *   completedAt?: string,
 *   scheduledAt?: string,
 *   campaignId?: string
 * }
 */
router.post('/apps/:id/social/posts', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const {
    associationId,
    platform,
    state,
    payload,
    externalResponse,
    externalId,
    completedAt,
    scheduledAt,
    campaignId,
  } = req.body;

  if (!platform || !state || !payload) {
    return res.status(400).json({ error: 'platform, state, and payload are required' });
  }

  const stateValidation = validatePostState(state);
  if (!stateValidation.valid) {
    return validationError(res, stateValidation);
  }

  logger.info('route.social.posts.create.begin', { appId, platform, state, associationId });

  if (associationId) {
    const association = socialAssociationRepo.findById(associationId);
    if (!association) {
      return res.status(400).json({ error: 'Invalid associationId reference' });
    }
    if (association.appId !== appId) {
      return res.status(400).json({ error: 'Association does not belong to this app' });
    }
  }

  const post = socialPostRepo.create({
    appId,
    associationId: associationId || null,
    platform,
    state: state as PostState,
    payload,
    externalResponse: externalResponse || null,
    externalId: externalId || null,
    completedAt: completedAt ? new Date(completedAt) : new Date(),
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    campaignId: campaignId || null,
  });

  logger.info('route.social.posts.create.success', {
    appId,
    postId: post.id,
    platform,
    state,
    externalId: post.externalId,
  });

  return res.status(201).json({ post });
}));

/**
 * PUT /apps/:id/social/posts/:postId
 * Body: {
 *   state?: 'SCHEDULED' | 'PUBLISHED' | 'FAILED',
 *   externalResponse?: object,
 *   externalId?: string,
 *   completedAt?: string,
 *   scheduledAt?: string
 * }
 */
router.put('/apps/:id/social/posts/:postId', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { postId } = req.params;
  const { state, externalResponse, externalId, completedAt, scheduledAt } = req.body;

  if (!postId) {
    return res.status(400).json({ error: 'Post ID is required' });
  }

  logger.info('route.social.posts.update.begin', { appId, postId });

  const existingPost = socialPostRepo.findById(postId);
  if (!existingPost) {
    logger.warn('route.social.posts.update.not_found', { appId, postId });
    return res.status(404).json({ error: 'Post not found' });
  }

  if (existingPost.appId !== appId) {
    logger.warn('route.social.posts.update.unauthorized', {
      appId,
      postId,
      postAppId: existingPost.appId,
    });
    return res.status(403).json({ error: 'Post does not belong to this app' });
  }

  if (state) {
    const stateValidation = validatePostState(state);
    if (!stateValidation.valid) {
      return validationError(res, stateValidation);
    }
  }

  const updatedPost = socialPostRepo.update(postId, {
    state: state as PostState | undefined,
    externalResponse,
    externalId,
    completedAt: completedAt ? new Date(completedAt) : undefined,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
  });

  logger.info('route.social.posts.update.success', { appId, postId, state: updatedPost.state });

  return res.json({ post: updatedPost });
}));

// ============================================================================
// SEO Routes
// ============================================================================

/**
 * POST /apps/:id/seo/verification-tag
 * Body: { verificationToken: string }
 *
 * Injects a <meta name="google-site-verification"> tag into index.html
 * and commits the change to git, so it survives the next publish/build.
 */
router.post('/apps/:id/seo/verification-tag', withApp, asyncHandler(async (req: Request, res: Response) => {
  const appId = getAppId(res);
  const { verificationToken } = req.body as { verificationToken?: unknown };

  if (!verificationToken || typeof verificationToken !== 'string' || verificationToken.trim().length === 0) {
    return res.status(400).json({ error: 'verificationToken must be a non-empty string' });
  }

  const app = appRepo.findById(appId);
  if (!app?.path) {
    logger.warn('route.social.gsc-verification-tag.no-app-path', { appId });
    return res.status(404).json({ error: 'App workspace path not found' });
  }

  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    logger.warn('route.social.gsc-verification-tag.no-workspace', { appId });
    return res.status(503).json({ error: 'Workspace unavailable' });
  }

  logger.info('route.social.gsc-verification-tag.begin', { appId });

  const viewResult = await workspace.files.view({ path: 'index.html' });
  const original = viewResult.content;

  const metaTag = `<meta name="google-site-verification" content="${verificationToken}">`;
  const MARKER = '<!--app-head-->';
  const existingTagLineRe = /<meta\s+name="google-site-verification"/i;

  let updated: string;
  if (existingTagLineRe.test(original)) {
    // Replace the entire line — handles malformed content values (e.g. nested meta tag) cleanly
    updated = original.split('\n')
      .map((line: string) => existingTagLineRe.test(line) ? `    ${metaTag}` : line)
      .join('\n');
  } else if (original.includes(MARKER)) {
    updated = original.replace(MARKER, `${metaTag}\n    ${MARKER}`);
  } else {
    const headClose = '</head>';
    if (!original.includes(headClose)) {
      logger.warn('route.social.gsc-verification-tag.no-insertion-point', { appId });
      return res.status(422).json({ error: 'Cannot inject verification tag: no suitable insertion point in index.html' });
    }
    updated = original.replace(headClose, `    ${metaTag}\n  ${headClose}`);
  }

  await workspace.files.write({ path: 'index.html', content: updated });

  const gitUtils = new GitUtils(workspace.tasks);
  const addResult = await gitUtils.addFiles(app.path, ['index.html']);
  if (!addResult.success) {
    logger.error('route.social.gsc-verification-tag.add-failed', { appId, error: addResult.stderr });
    return res.status(500).json({ error: 'Failed to stage verification tag' });
  }

  const commitResult = await gitUtils.commit(app.path, 'Add Google Search Console verification tag');
  const nothingToCommit = !commitResult.success &&
    (commitResult.stdout.includes('nothing to commit') || commitResult.stderr.includes('nothing to commit'));
  if (!commitResult.success && !nothingToCommit) {
    logger.error('route.social.gsc-verification-tag.commit-failed', { appId, error: commitResult.stderr });
    return res.status(500).json({ error: 'Failed to commit verification tag' });
  }

  logger.info('route.social.gsc-verification-tag.success', { appId });
  return res.status(200).json({ success: true });
}));

// Apply error handler
router.use(errorHandler);

export default router;
