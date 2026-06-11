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

// Memory keys — per-app pointers to Inbox (Reamaze) resources.
// Must match the keys written by the inbox skill (src/skills/inbox/tools/index.ts).
const MEM_ACCOUNT_ID = 'integrations.inbox.accountId';
const MEM_BRAND_ID = 'integrations.inbox.brandId';

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
    const brandIdResult = await memory.get(scope, MEM_BRAND_ID);
    const accountIdResult = await memory.get(scope, MEM_ACCOUNT_ID);

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
        key: MEM_BRAND_ID,
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
        key: MEM_ACCOUNT_ID,
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

/**
 * POST /apps/:id/inbox-account
 * Persists the linked inbox accountId to the memory table.
 *
 * Used to backfill legacy apps that have a brandId in memory but no accountId (the
 * accountId key was added after brandId). The browser resolves the accountId via Reamaze
 * (which requires the user's SSO session the agent lacks) and posts it here to persist.
 *
 * The client-supplied accountId is trusted: validateAppOwnership guarantees the caller owns
 * this app, and the value only ever lands in this app's own memory namespace.
 */
router.post('/apps/:id/inbox-account', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { id: appId } = req.params;
  const contextLogger = log.forApp(appId!);

  const { accountId } = req.body as { accountId?: unknown };
  if (typeof accountId !== 'string' || accountId.trim().length === 0) {
    res.status(400).json({ error: 'accountId is required and must be a non-empty string' });
    return;
  }

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const scope = workspaceScopeFromAppId(appId!, customerId);

    const result = await memory.set(scope, MEM_ACCOUNT_ID, accountId);
    if (!result.success) {
      contextLogger.error('inboxAccount.route.set.failed', {
        appId,
        key: MEM_ACCOUNT_ID,
        error: result.error,
      });
      res.status(500).json({ error: 'Failed to persist inbox account data' });
      return;
    }

    contextLogger.info('inboxAccount.route.set.success', { appId, accountId });
    res.json({ accountId });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    contextLogger.error('inboxAccount.route.set.error', {
      appId,
      error: errorMessage,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
