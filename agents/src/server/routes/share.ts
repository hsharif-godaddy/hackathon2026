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
import type { ShareTokenPurpose } from '../../database/schema.js';
import { isValidShareTokenFormat } from '../../utils/share-token-generator.js';
import { Logger } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';

// Per-purpose TTL bounds. 'user' preserves the long-standing 1h–7d UI window.
// 'archive_snapshot' is a hosting-driven mint with a single fixed 15-min TTL —
// long enough for screenshot-generator to render and persist, short enough that
// the token isn't a useful piece of long-lived loot if the URL leaks.
const PURPOSE_TTL_BOUNDS: Record<ShareTokenPurpose, { minSec: number; maxSec: number; defaultSec: number }> = {
  user: { minSec: 3600, maxSec: 604800, defaultSec: 604800 },
  archive_snapshot: { minSec: 60, maxSec: 900, defaultSec: 900 },
};

function isShareTokenPurpose(value: unknown): value is ShareTokenPurpose {
  return value === 'user' || value === 'archive_snapshot';
}

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
  // Build legacy URL using URL API to prevent double-token when baseUrl
  // already contains an airoShareToken (stale DB entry).
  let legacy: string;
  try {
    const normalized = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
    const parsed = new URL(normalized);
    parsed.searchParams.set('airoShareToken', token);
    legacy = parsed.toString();
  } catch {
    // hostname-only or otherwise unparseable — strip any existing token via regex, then concat
    const stripped = baseUrl.replace(/[?&]airoShareToken=[^&]*/g, '').replace(/\?$/, '');
    legacy = `${stripped}?airoShareToken=${token}`;
  }

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
 *   expiresIn?: number,         // seconds, defaults to per-purpose default
 *   replaceActive?: boolean,    // when true, bypass the one-active-token
 *                               // guard and mint a new token even if an
 *                               // active one exists. Default false.
 *   purpose?: 'user' | 'archive_snapshot',
 *                               // 'user' (default): UI-driven preview share,
 *                               //   1h–7d TTL.
 *                               // 'archive_snapshot': hosting-driven snapshot
 *                               //   for the pre-archive screenshot capture.
 *                               //   Allowed only when the caller's JWT
 *                               //   authType === 'cert2s'. 60s–15min TTL.
 * }
 * Response: { token, appId, shareUrl, createdAt, expiresAt, purpose }
 */
router.post('/apps/:id/share', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const appId = req.params.id!; // Type assertion: route param is always defined

  // Ownership already validated by middleware
  // authReq.agentContext.siteId === appId is guaranteed

  try {
    // Validate before coercion so an invalid value can't reach `purpose` —
    // otherwise a future refactor that drops the 400 would silently coerce
    // bad input to 'user' and bypass the cert2s gate below.
    const rawPurpose = req.body.purpose;
    if (rawPurpose !== undefined && !isShareTokenPurpose(rawPurpose)) {
      logger.warn('share.create.invalidPurpose', { appId, purpose: rawPurpose });
      return res.status(400).json({
        error: 'Invalid purpose. Must be "user" or "archive_snapshot"',
      });
    }
    const purpose: ShareTokenPurpose = rawPurpose ?? 'user';

    // Non-default purpose is gated on the caller's JWT auth type — only
    // cert2s (the delegation form hosting uses) can mint archive_snapshot.
    if (purpose !== 'user' && authReq.agentContext?.authType !== 'cert2s') {
      logger.warn('share.create.purposeNotAllowed', {
        appId,
        purpose,
        authType: authReq.agentContext?.authType,
      });
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Auth-at-Edge defense-in-depth — block user-share-link mints for ent
    // apps where SSO is required. archive_snapshot stays open (cert2s
    // system path; not user-shareable). Mirrors the BFF gate; canonical
    // authority is hosting's gate. ssoRequired is read from the JWT claim
    // baked at agent-token mint time.
    if (purpose === 'user' && authReq.agentContext?.ssoRequired === true) {
      logger.warn('share.create.blockedSsoRequired', { appId });
      return res.status(403).json({
        error: 'sso_share_disabled',
        details:
          'Share links are disabled for apps in this organization because SSO is required. ' +
          'Publish the app and use the published URL behind your IdP instead.',
      });
    }

    const ttl = PURPOSE_TTL_BOUNDS[purpose];
    const expiresIn = req.body.expiresIn ?? ttl.defaultSec;
    // archive_snapshot bypasses the one-active guard so hosting can re-mint
    // on SM retry. For user purpose, `replaceActive: true` is opt-in rotation
    // (Slack feedback Preview button); `=== true` is strict so a non-boolean
    // payload falls through to the safer default.
    const replaceActive = purpose === 'archive_snapshot' || req.body.replaceActive === true;

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

    // Per-purpose expiresIn range. 'user' is 1h–7d; 'archive_snapshot' is
    // 60s–15min. Bounds come from PURPOSE_TTL_BOUNDS so a future purpose can
    // be added without forking the validation.
    if (expiresIn < ttl.minSec || expiresIn > ttl.maxSec) {
      logger.warn('share.create.invalidExpiration', {
        appId,
        purpose,
        expiresIn,
        bounds: ttl,
      });
      return res.status(400).json({
        error: `Invalid expiresIn for purpose "${purpose}". Must be between ${ttl.minSec} and ${ttl.maxSec} seconds`,
      });
    }

    logger.info('share.create.begin', {
      appId,
      purpose,
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

    // One-active-link-at-a-time is a server-side invariant for the default
    // UI flow — the UI also gates this, but two tabs / a direct curl / a
    // double-click before React's isPending flips would otherwise create
    // duplicate active tokens. Scoped per-purpose so a 'user' link and an
    // 'archive_snapshot' token coexist.
    const now = Date.now();
    const existingTokens = shareTokenRepository.findByAppId(appId, purpose);
    const existingActive = existingTokens.find((t) => t.expiresAt > now);

    if (!replaceActive) {
      if (existingActive) {
        logger.info('share.create.alreadyActive', {
          appId,
          purpose,
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
        purpose,
        existingActiveCount,
      });
    }

    const shareToken = shareTokenRepository.create({
      appId,
      expiresIn,
      purpose,
    });

    const shareUrl = buildShareUrl(appId, baseUrl, shareToken.token);

    logger.info('share.create.success', {
      appId,
      purpose,
      shareTokenSuffix: tokenSuffix(shareToken.token),
      expiresAt: shareToken.expiresAt,
    });

    return res.status(201).json({
      token: shareToken.token,
      appId,
      shareUrl,
      purpose: shareToken.purpose,
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
      purpose: token.purpose,
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
