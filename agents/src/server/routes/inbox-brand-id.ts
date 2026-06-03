/**
 * Inbox Brand ID Route
 *
 * Fetches the linked inbox brand ID from the memory table.
 * Data is stored in Memory by the inbox skill after linking an account.
 */

import { Router, Request, Response } from 'express';
import { log } from '../../logging/index.js';
import { getKvMemoryStore } from '../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

interface InboxBrandData {
  brandId: string | null;
}

const router: Router = Router();
const memory = getKvMemoryStore();

/**
 * GET /apps/:id/inbox-brand-id
 * Fetches linked inbox brand ID from memory table.
 */
router.get('/apps/:id/inbox-brand-id', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { id: appId } = req.params;
  const contextLogger = log.forApp(appId!);

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const scope = workspaceScopeFromAppId(appId!, customerId);

    // Fetch brand ID from memory
    const brandIdResult = await memory.get(scope, 'integrations.inbox.brandId');

    if (!brandIdResult.success) {
      contextLogger.warn('inboxBrandId.route.memoryRead.failed', {
        appId,
        key: 'integrations.inbox.brandId',
        error: brandIdResult.error
      });
      res.status(500).json({
        error: 'Failed to read brand ID from memory',
        brandId: null
      });
      return;
    }

    if (!brandIdResult.exists) {
      contextLogger.info('inboxBrandId.route.notFound', { appId });
      res.json({ brandId: null });
      return;
    }

    // Validate the data structure - should be a string
    const brandId = brandIdResult.value;
    if (typeof brandId !== 'string') {
      contextLogger.warn('inboxBrandId.route.invalidData', {
        appId,
        dataType: typeof brandId
      });
      res.json({ brandId: null });
      return;
    }

    contextLogger.info('inboxBrandId.route.success', {
      appId,
      brandId
    });

    res.json({ brandId });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    contextLogger.error('inboxBrandId.route.error', {
      appId,
      error: errorMessage,
    });
    res.status(500).json({
      error: 'Internal server error',
      brandId: null
    });
  }
});

export default router;
