/**
 * Inbox Account Route
 *
 * Fetches the linked inbox account data (brandId and accountId) from the memory table.
 * Data is stored in Memory by the inbox skill after linking an account.
 */

import { Router, Request, Response } from 'express';
import { log } from '../../logging/index.js';
import { getKvMemoryStore } from '../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

interface InboxAccountData {
  brandId: string | null;
  accountId: string | null;
}

const router: Router = Router();
const memory = getKvMemoryStore();

/**
 * GET /apps/:id/inbox-account
 * Fetches linked inbox account data (brandId and accountId) from memory table.
 */
router.get('/apps/:id/inbox-account', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { id: appId } = req.params;
  const contextLogger = log.forApp(appId!);

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const scope = workspaceScopeFromAppId(appId!, customerId);

    // Fetch both brandId and accountId from memory
    const brandIdResult = await memory.get(scope, 'integrations.inbox.brandId');
    const accountIdResult = await memory.get(scope, 'integrations.inbox.accountId');

    let brandId: string | null = null;
    let accountId: string | null = null;

    // Handle brandId
    if (brandIdResult.success && brandIdResult.exists) {
      if (typeof brandIdResult.value === 'string') {
        brandId = brandIdResult.value;
      } else {
        contextLogger.warn('inboxAccount.route.invalidBrandIdData', {
          appId,
          dataType: typeof brandIdResult.value
        });
      }
    } else if (!brandIdResult.success) {
      contextLogger.warn('inboxAccount.route.brandIdMemoryRead.failed', {
        appId,
        key: 'integrations.inbox.brandId',
        error: brandIdResult.error
      });
    }

    // Handle accountId
    if (accountIdResult.success && accountIdResult.exists) {
      if (typeof accountIdResult.value === 'string') {
        accountId = accountIdResult.value;
      } else {
        contextLogger.warn('inboxAccount.route.invalidAccountIdData', {
          appId,
          dataType: typeof accountIdResult.value
        });
      }
    } else if (!accountIdResult.success) {
      contextLogger.warn('inboxAccount.route.accountIdMemoryRead.failed', {
        appId,
        key: 'integrations.inbox.accountId',
        error: accountIdResult.error
      });
    }

    // Log the result
    if (brandId !== null || accountId !== null) {
      contextLogger.info('inboxAccount.route.success', {
        appId,
        brandId,
        accountId
      });
    } else {
      contextLogger.info('inboxAccount.route.notFound', { appId });
    }

    res.json({ brandId, accountId });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    contextLogger.error('inboxAccount.route.error', {
      appId,
      error: errorMessage,
    });
    res.status(500).json({
      error: 'Internal server error',
      brandId: null,
      accountId: null
    });
  }
});

export default router;
