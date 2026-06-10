/**
 * App Metadata Routes
 *
 * GET   /apps/:id/metadata  → read the metadata object
 * PATCH /apps/:id/metadata  → shallow-merge a patch into it
 *
 * Mounted at /apps under protectedRouter (jwt-auth + product-access already
 * applied). validateAppOwnership enforces :id === authenticated siteId.
 */

import { Router, Request, Response, IRouter } from 'express';
import { AppMetadataRepository, MetadataTooLargeError } from '../../database/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { Logger } from '../../logging/index.js';
import type { AppMetadata } from '@airo/shared';

const router: IRouter = Router();
const repo = new AppMetadataRepository();
const logger = Logger.create({ component: 'app-metadata-routes' });

// Defense-in-depth: appsRouter's prefix middleware also validates ownership for
// all /apps/:id/* routes, but this router must be independently secure regardless
// of mount order. Cross-tenant requests terminate at the first guard; this second
// check only fires on the legitimate path (adds a DEBUG log, not a duplicate alert).
router.get('/:id/metadata', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id!;
  try {
    res.json({ metadata: repo.get(appId) });
  } catch (error) {
    logger.error('app.metadata.get.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to read metadata' });
  }
});

router.patch('/:id/metadata', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id!;
  const body = req.body as unknown;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    res.status(400).json({ error: 'Request body must be a metadata object' });
    return;
  }

  try {
    const merged = repo.merge(appId, body as Partial<AppMetadata>);
    res.json({ metadata: merged });
  } catch (error) {
    if (error instanceof MetadataTooLargeError) {
      // Oversize write is a client/resource condition, not a server fault —
      // warn level keeps telemetry clean; 413 tells the caller what happened.
      logger.warn('app.metadata.patch.too_large', {
        appId,
        error: error.message,
      });
      res.status(413).json({ error: 'Metadata exceeds maximum size' });
      return;
    }
    logger.error('app.metadata.patch.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

export const appMetadataRouter = router;
