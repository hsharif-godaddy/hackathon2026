/**
 * Rewrite App Identity Route (post-clone SQLite fix)
 *
 * Called by the control plane during app cloning, AFTER the source app's data has
 * been restored into the target cell but while the agent DB still references the
 * OLD app ID / OLD cell. Rewrites every reference to the NEW app ID / NEW cell so
 * chat, preview, and publish resolve correctly.
 *
 * POST /apps/:id/rewrite-identity
 *   :id  = the NEW (target) app ID — the identity the app is being cloned into. The
 *          caller holds a per-app JWT for this ID (cert2s → /api/auth/token?siteId=
 *          newAppId → Bearer), the same auth path the share-token / screenshot flows
 *          use for the provisioned target app. validateAppOwnership enforces
 *          siteId === :id.
 *   body = { oldAppId, oldCell?, newCell? } — oldAppId is the source identity
 *          currently occupying the restored DB.
 *
 * The rewrite runs in-process against the live better-sqlite3 connection. Because
 * better-sqlite3 is synchronous, the whole transaction executes without yielding
 * the event loop, so no other request handler can interleave a DB write mid-rewrite.
 *
 * NOTE: this mutates the DB but does not evict in-process caches the running agent
 * may hold keyed by the old app ID (app record, siteId-bound state). The clone
 * orchestration must reload/re-bind the target agent after a successful call so no
 * stale in-memory state survives.
 */

import { Router, type Response, type IRouter } from 'express';
import { z } from 'zod';

import { getDatabase } from '../../database/connection.js';
import {
  rewriteAppIdentity,
  RewriteAppIdentityError,
  type RewriteErrorCode,
} from '../../database/rewrite-app-identity.js';
import { Logger } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const logger = Logger.create({ component: 'rewrite-app-identity-routes' });

const router: IRouter = Router();

const bodySchema = z.object({
  oldAppId: z.string(),
  oldCell: z.string().optional(),
  newCell: z.string().optional(),
});

// JWT siteId must match :id (the NEW/target app ID the app is cloned into).
router.use('/apps/:id([a-z0-9]{10})/rewrite-identity', validateAppOwnership);

/** Map a domain error code to an HTTP status. */
function statusForCode(code: RewriteErrorCode): number {
  switch (code) {
    case 'source_missing':
      return 404;
    case 'invalid_app_id':
    case 'invalid_cell':
    case 'same_app_id':
    case 'cell_incomplete':
      return 400;
    case 'no_columns':
    case 'fk_violation':
    case 'verification_failed':
      return 500;
    default:
      // Exhaustiveness: a new RewriteErrorCode must add an explicit case above
      // rather than silently defaulting to 500.
      return assertNever(code);
  }
}

/** Compile-time exhaustiveness guard; also 500s at runtime if reached. */
function assertNever(code: never): number {
  logger.error('route.rewrite_identity.unmapped_code', { code });
  return 500;
}

// Same ([a-z0-9]{10}) constraint as the ownership middleware above so the two stay
// in lockstep: a malformed :id never reaches the handler (Express 404s instead).
router.post('/apps/:id([a-z0-9]{10})/rewrite-identity', (req: AuthenticatedRequest, res: Response) => {
  const newAppId = req.params.id!;

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  }
  const { oldAppId, oldCell, newCell } = parsed.data;

  logger.info('route.rewrite_identity.begin', { oldAppId, newAppId, oldCell, newCell });

  try {
    const report = rewriteAppIdentity(
      getDatabase(),
      { oldAppId, newAppId, oldCell, newCell },
      { info: (event, meta) => logger.info(event, meta), warn: (event, meta) => logger.warn(event, meta) }
    );

    logger.info('route.rewrite_identity.success', { ...report });
    return res.json({ success: true, report });
  } catch (error) {
    if (error instanceof RewriteAppIdentityError) {
      const status = statusForCode(error.code);
      logger.warn('route.rewrite_identity.rejected', {
        oldAppId,
        newAppId,
        code: error.code,
        message: error.message,
      });
      return res.status(status).json({ success: false, error: error.message, code: error.code });
    }

    logger.error('route.rewrite_identity.error', {
      oldAppId,
      newAppId,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ success: false, error: 'Failed to rewrite app identity' });
  }
});

export default router;
