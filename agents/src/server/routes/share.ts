import { Router, Request, Response, IRouter } from 'express';
import {
  encodeSharePayload,
  isEncodableCellPrefix,
  isEncodableSiteId,
  isEncodableToken,
  tokenSuffix,
} from '@airo/shared';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { jwtAuthMiddleware } from '../middleware/jwt-auth.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { validateProductAccess } from '../middleware/product-access.js';
import { appRepository, shareTokenRepository } from '../../database/repositories/index.js';
import { isValidShareTokenFormat } from '../../utils/share-token-generator.js';
import { Logger } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';

const router: IRouter = Router();
const logger = Logger.create({ component: 'share-routes' });

// Default BFF host. Production canonical (`airo.ai`). Test environments are
// detected explicitly via the preview URL's TLD in resolveBffDomain below;
// everything else falls back here.
const FALLBACK_BFF_DOMAIN = 'airo.ai';

/**
 * Resolve the BFF host that should serve `/share/{encoded}` redirects for
 * this agents allocation. Resolution order:
 *
 *   1. AIRO_BFF_DOMAIN env var (deployment override).
 *   2. Detect test envs explicitly via the preview URL TLD: previews on
 *      `*.test-airoapp.ai` produce `airo-builder.test-godaddy.com` (the
 *      currently-deployed test BFF). Nomad templates write the correct
 *      preview URL into the agents DB per env, so this is reliable.
 *   3. Otherwise default to FALLBACK_BFF_DOMAIN (`airo.ai`, prod canonical).
 *
 * Prod-by-default means a misconfigured non-prod env emits prod URLs that
 * 404 against the real prod BFF — visible failure beats silent misrouting
 * to a different env.
 */
function resolveBffDomain(previewBaseUrl: string | null): string {
  if (process.env.AIRO_BFF_DOMAIN) return process.env.AIRO_BFF_DOMAIN;

  if (previewBaseUrl) {
    try {
      const host = new URL(previewBaseUrl).hostname;
      // Test env: preview lives at *.test-airoapp.ai (covers both deployed
      // test and local dev which share that preview TLD). The BFF for these
      // envs is currently deployed at airo-builder.test-godaddy.com.
      if (host.endsWith('.test-airoapp.ai')) {
        return 'airo-builder.test-godaddy.com';
      }
    } catch (error) {
      logger.warn('share.resolveBffDomain.invalidPreviewUrl', {
        previewBaseUrlPrefix: previewBaseUrl.slice(0, 64),
        fallback: FALLBACK_BFF_DOMAIN,
        error: getErrorMessage(error),
      });
    }
  }

  return FALLBACK_BFF_DOMAIN;
}

/**
 * Resolve the preview base URL for an app from the database.
 * Ensures the URL has a protocol prefix since Nomad templates store hostname-only values.
 */
function getPreviewBaseUrl(appId: string): string | null {
  const app = appRepository.findById(appId);
  const previewUrl = app?.previewUrl;
  if (!previewUrl) return null;

  return previewUrl.startsWith('http://') || previewUrl.startsWith('https://')
    ? previewUrl
    : `https://${previewUrl}`;
}

/**
 * Extract the cell prefix from a preview URL of shape
 * `https://{siteId}.preview.{cellPrefix}.{baseDomain}`. Returns null if the
 * URL does not match the expected pattern.
 */
function extractCellPrefix(previewUrl: string): string | null {
  const match = previewUrl.match(/\.preview\.(c\d+)\./);
  return match?.[1] ?? null;
}

/**
 * Build the BFF share URL `https://{bffDomain}/share/{base64url(siteId:cellPrefix:token)}`
 * when bff domain, cell prefix, and an encodable siteId can all be resolved.
 * Falls back to the legacy direct-preview URL on any mismatch so share-create
 * never fails. Each fallback path emits a debug/warn log so operators can
 * diagnose why the BFF URL isn't being used.
 */
function buildShareUrl(appId: string, baseUrl: string, token: string): string {
  const legacy = `${baseUrl}?airoShareToken=${token}`;

  const cellPrefix = extractCellPrefix(baseUrl);
  if (!cellPrefix) {
    // baseUrl is the diagnostic key here — if production preview-URL format
    // changes, every share link silently reverts to legacy and this warn
    // is the only signal. baseUrl is already public (returned in share
    // responses). At warn so it surfaces at the default LOG_LEVEL=info.
    logger.warn('share.buildShareUrl.noCellPrefix', { appId, baseUrl });
    return legacy;
  }

  // appId may be a UUID (36 chars) which is too long for SITE_ID_REGEX.
  // Pre-check before encode so failures surface here, not as broken
  // recipient redirects later.
  if (!isEncodableSiteId(appId)) {
    logger.warn('share.buildShareUrl.siteIdNotEncodable', { appId });
    return legacy;
  }

  // Defense-in-depth: extractCellPrefix already ensures `c\d+` shape, but
  // pre-check explicitly so the contract surfaces if either changes.
  if (!isEncodableCellPrefix(cellPrefix)) {
    logger.warn('share.buildShareUrl.cellPrefixNotEncodable', { appId, cellPrefix });
    return legacy;
  }

  // Token-generator changes that produce out-of-charset chars would otherwise
  // only surface inside the encode try/catch with no token-specific log.
  // Pre-checking matches the siteId/cellPrefix pattern above.
  if (!isEncodableToken(token)) {
    logger.warn('share.buildShareUrl.tokenNotEncodable', { appId, cellPrefix });
    return legacy;
  }

  try {
    const bffDomain = resolveBffDomain(baseUrl);
    const encoded = encodeSharePayload({ siteId: appId, cellPrefix, token });
    return `https://${bffDomain}/share/${encoded}`;
  } catch (error) {
    // Defense-in-depth: if encode throws despite the pre-check (e.g. token
    // charset mismatch), still return a usable URL rather than failing the
    // already-persisted share-create call.
    logger.warn('share.buildShareUrl.encodeFailure', {
      appId,
      cellPrefix,
      error: getErrorMessage(error),
    });
    return legacy;
  }
}

// ==================================================================================
// Protected Routes (require JWT + app ownership validation)
// ==================================================================================

// CRITICAL: Middleware MUST be applied BEFORE route definitions
// JWT auth FIRST, then ownership validation
router.use('/apps/:id/share', jwtAuthMiddleware.authenticate, validateProductAccess, validateAppOwnership);

/**
 * POST /apps/:id/share
 * Create a new share token for an app
 *
 * Body: {
 *   expiresIn?: number,         // seconds, default: 604800 = 7 days
 *   replaceActive?: boolean,    // when true, bypass the one-active-token
 *                               // guard and mint a new token even if an
 *                               // active one exists. Default false.
 * }
 * Response: { token, appId, shareUrl, createdAt, expiresAt }
 */
router.post('/apps/:id/share', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const appId = req.params.id!; // Type assertion: route param is always defined

  // Ownership already validated by middleware
  // authReq.agentContext.siteId === appId is guaranteed

  try {
    const expiresIn = req.body.expiresIn ?? 604800; // Default: 7 days (604800 seconds)
    // `replaceActive` is opt-in token rotation. The default (false) keeps
    // the long-standing "one active token per app" UI invariant intact.
    // Programmatic callers (currently: app/src/lib/share/inject-preview-token.ts
    // when an existing token is older than its freshness window) pass true.
    // Strict `=== true` so any non-boolean payload (a string "true", null,
    // undefined, etc.) falls through to the safer default behavior — the
    // caller has to be deliberate to bypass the guard.
    const replaceActive = req.body.replaceActive === true;

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
      replaceActive,
      siteId: authReq.agentContext?.siteId,
    });

    const app = appRepository.findById(appId);
    if (!app) {
      logger.error('share.create.appNotFound', { appId });
      return res.status(404).json({ error: 'App not found' });
    }

    const baseUrl = getPreviewBaseUrl(appId);
    if (!baseUrl) {
      logger.error('share.create.missingPreviewUrl', {
        appId,
        message: 'App has no preview URL configured',
      });
      return res.status(400).json({ error: 'App has no preview URL configured' });
    }

    // Enforce one-active-link-at-a-time as a server-side invariant for the
    // default UI flow. The UI gates this too (SharePanel + ShareMenu), but
    // two open tabs, a direct curl, or a double-click before the React
    // isPending flag flips would otherwise create duplicate active tokens.
    //
    // `replaceActive: true` opts out of the guard for programmatic rotation:
    // when a copy-friendly link (e.g., the Slack feedback Preview button) is
    // being generated and the existing token is past its freshness window,
    // the BFF helper requests a fresh token. The previous token is left in
    // place to expire on its own schedule — already-copied URLs keep working
    // until their original 7-day window elapses.
    //
    // Hoisted out of the if/else: both branches need the list, so paying
    // for one DB read covers both paths.
    const now = Date.now();
    const existingTokens = shareTokenRepository.findByAppId(appId);
    const existingActive = existingTokens.find((t) => t.expiresAt > now);

    if (!replaceActive) {
      if (existingActive) {
        logger.info('share.create.alreadyActive', {
          appId,
          existingExpiresAt: existingActive.expiresAt,
        });
        return res.status(409).json({
          error: 'An active share link already exists for this app',
        });
      }
    } else {
      // Observability: distinguish a rotation event from a first-create so
      // operators can see how often programmatic rotation fires per app.
      const existingActiveCount = existingTokens.filter((t) => t.expiresAt > now).length;
      logger.info('share.create.replacingActive', {
        appId,
        existingActiveCount,
      });
    }

    const shareToken = shareTokenRepository.create({
      appId,
      expiresIn,
    });

    const shareUrl = buildShareUrl(appId, baseUrl, shareToken.token);

    logger.info('share.create.success', {
      appId,
      shareTokenSuffix: tokenSuffix(shareToken.token),
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

    const baseUrl = getPreviewBaseUrl(appId);
    if (!baseUrl && tokens.length > 0) {
      // POST treats this as a 400 hard error; GET stays soft (omits shareUrl
      // and lets the BFF fall back to <origin>?airoShareToken=...) but logs
      // so operators see when the listing path silently degrades.
      logger.warn('share.list.missingPreviewUrl', { appId });
    }

    const tokensList = tokens.map((token) => ({
      token: token.token,
      appId: token.appId,
      shareUrl: baseUrl ? buildShareUrl(appId, baseUrl, token.token) : undefined,
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
      logger.debug('share.validate.invalidFormat', { shareTokenSuffix: tokenSuffix(token) });
      return res.json({
        valid: false,
        reason: 'invalid_format',
      });
    }

    // Query database
    const shareToken = shareTokenRepository.findByToken(token);

    if (!shareToken) {
      logger.debug('share.validate.notFound', { shareTokenSuffix: tokenSuffix(token) });
      return res.json({
        valid: false,
        reason: 'not_found',
      });
    }

    // Check expiration
    if (shareToken.expiresAt < Date.now()) {
      logger.debug('share.validate.expired', {
        shareTokenSuffix: tokenSuffix(token),
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
      shareTokenSuffix: tokenSuffix(token),
      appId: shareToken.appId,
    });

    return res.json({
      valid: true,
      appId: shareToken.appId,
      expiresAt: shareToken.expiresAt,
    });
  } catch (error) {
    logger.error('share.validate.error', {
      shareTokenSuffix: tokenSuffix(token),
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      valid: false,
      reason: 'internal_error',
    });
  }
});

export default router;
