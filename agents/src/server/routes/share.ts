import { Router, Request, Response, IRouter } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { jwtAuthMiddleware } from '../middleware/jwt-auth.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { shareTokenRepository } from '../../database/repositories/index.js';
import { isValidShareTokenFormat } from '../../utils/share-token-generator.js';
import { Logger } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';

const router: IRouter = Router();
const logger = Logger.create({ service: 'share-routes' });

// ==================================================================================
// Protected Routes (require JWT + app ownership validation)
// ==================================================================================

// CRITICAL: Middleware MUST be applied BEFORE route definitions
// JWT auth FIRST, then ownership validation
router.use('/apps/:id/share', jwtAuthMiddleware.authenticate, validateAppOwnership);

/**
 * POST /apps/:id/share
 * Create a new share token for an app
 *
 * Body: { expiresIn?: number } (seconds, default: 604800 = 7 days)
 * Response: { token, appId, shareUrl, createdAt, expiresAt }
 */
router.post('/apps/:id/share', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const appId = req.params.id!; // Type assertion: route param is always defined

  // Ownership already validated by middleware
  // authReq.agentContext.siteId === appId is guaranteed

  try {
    const expiresIn = req.body.expiresIn ?? 604800; // Default: 7 days (604800 seconds)

    // Validate expiresIn is a number
    if (typeof expiresIn !== 'number' || isNaN(expiresIn)) {
      logger.warn('share.create.invalidType', {
        appId,
        expiresIn,
        type: typeof expiresIn,
      });
      return res.status(400).json({
        error: 'Invalid expiresIn. Must be a number',
      });
    }

    // Validate expiresIn range (1 hour to 7 days in seconds)
    if (expiresIn < 3600 || expiresIn > 604800) {
      logger.warn('share.create.invalidExpiration', {
        appId,
        expiresIn,
      });
      return res.status(400).json({
        error: 'Invalid expiresIn. Must be between 3600 (1 hour) and 604800 (7 days) seconds',
      });
    }

    logger.info('share.create.begin', {
      appId,
      expiresIn,
      siteId: authReq.agentContext?.siteId,
    });

    // Validate PREVIEW_URL is configured before creating token
    // This prevents orphaned tokens in database if URL is not available
    // Note: PREVIEW_URL is app-specific hostname (set via Nomad job template)
    const previewUrl = process.env.PREVIEW_URL;
    if (!previewUrl) {
      logger.error('share.create.missing_preview_url', {
        appId,
        message: 'PREVIEW_URL environment variable is not set',
      });
      return res.status(500).json({ error: 'Preview URL not configured' });
    }

    // Ensure URL has https:// protocol (Nomad templates provide hostname only)
    const baseUrl = previewUrl.startsWith('http://') || previewUrl.startsWith('https://')
      ? previewUrl
      : `https://${previewUrl}`;

    // Create token after validating PREVIEW_URL is available
    const shareToken = shareTokenRepository.create({
      appId,
      expiresIn,
    });

    const shareUrl = `${baseUrl}?airoShareToken=${shareToken.token}`;

    logger.info('share.create.success', {
      appId,
      shareToken: shareToken.token,
      expiresAt: shareToken.expiresAt,
    });

    return res.status(201).json({
      token: shareToken.token,
      appId,
      shareUrl,
      createdAt: shareToken.createdAt.toISOString(),
      expiresAt: new Date(shareToken.expiresAt).getTime(), // Unix timestamp in ms
    });
  } catch (error) {
    logger.error('share.create.error', {
      appId,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ error: 'Failed to create share link' });
  }
});

/**
 * GET /apps/:id/share
 * List all share tokens for an app (includes expired tokens - let UI decide how to display)
 *
 * Response: { tokens: Array<{ token, appId, shareUrl, createdAt, expiresAt, firstUsedAt }> }
 */
router.get('/apps/:id/share', async (req: Request, res: Response) => {
  const appId = req.params.id!; // Type assertion: route param is always defined

  // Ownership already validated by middleware

  try {
    logger.debug('share.list.begin', { appId });

    const tokens = shareTokenRepository.findByAppId(appId);

    // Build response with share URLs using PREVIEW_URL from agent environment
    // Note: PREVIEW_URL should always be set in production via Nomad job template
    const previewUrl = process.env.PREVIEW_URL;
    if (!previewUrl) {
      logger.error('share.list.missing_preview_url', {
        appId,
        message: 'PREVIEW_URL environment variable is not set',
      });
      return res.status(500).json({ error: 'Preview URL not configured' });
    }

    // Ensure URL has https:// protocol (Nomad templates provide hostname only)
    const baseUrl = previewUrl.startsWith('http://') || previewUrl.startsWith('https://')
      ? previewUrl
      : `https://${previewUrl}`;

    const tokensList = tokens.map((token) => ({
      token: token.token,
      appId: token.appId,
      shareUrl: `${baseUrl}?airoShareToken=${token.token}`,
      createdAt: token.createdAt.toISOString(),
      expiresAt: new Date(token.expiresAt).getTime(), // Unix timestamp in ms
      firstUsedAt: token.firstUsedAt ? token.firstUsedAt.toISOString() : null,
    }));

    logger.debug('share.list.success', {
      appId,
      count: tokensList.length,
    });

    return res.json({ tokens: tokensList });
  } catch (error) {
    logger.error('share.list.error', {
      appId,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ error: 'Failed to list share links' });
  }
});

// ==================================================================================
// Public Routes (no authentication - called by dev-supervisor)
// ==================================================================================

/**
 * GET /api/share/validate/:token
 * Validate a share token (public endpoint for dev-supervisor)
 *
 * Response (valid): { valid: true, appId, expiresAt }
 * Response (invalid): { valid: false, reason }
 */
router.get('/api/share/validate/:token', async (req: Request, res: Response) => {
  const token = req.params.token!; // Type assertion: route param is always defined

  try {
    // Validate token format
    if (!isValidShareTokenFormat(token)) {
      logger.debug('share.validate.invalidFormat', { shareToken: token });
      return res.json({
        valid: false,
        reason: 'invalid_format',
      });
    }

    // Query database
    const shareToken = shareTokenRepository.findByToken(token);

    if (!shareToken) {
      logger.debug('share.validate.notFound', { shareToken: token });
      return res.json({
        valid: false,
        reason: 'not_found',
      });
    }

    // Check expiration
    if (shareToken.expiresAt < Date.now()) {
      logger.debug('share.validate.expired', {
        shareToken: token,
        expiresAt: shareToken.expiresAt,
      });
      return res.json({
        valid: false,
        reason: 'expired',
      });
    }

    // Mark first use (idempotent)
    shareTokenRepository.markFirstUsed(token);

    logger.info('share.validate.success', {
      shareToken: token,
      appId: shareToken.appId,
    });

    return res.json({
      valid: true,
      appId: shareToken.appId,
      expiresAt: shareToken.expiresAt,
    });
  } catch (error) {
    logger.error('share.validate.error', {
      token,
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      valid: false,
      reason: 'internal_error',
    });
  }
});

export default router;
