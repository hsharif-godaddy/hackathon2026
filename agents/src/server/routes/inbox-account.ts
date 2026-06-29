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
  // The inbox skill persists embeddableId as a number and contactFormCategoryId as the Reamaze
  // channel id (number | string), so these are surfaced with their stored types — unlike the
  // string-valued brand/account URL pointers.
  embeddableId: number | null;
  categoryId: number | string | null;
}

// Memory keys — per-app pointers to Inbox (Reamaze) resources.
// Must match the keys written by the inbox skill (src/skills/inbox/tools/index.ts).
const MEM_ACCOUNT_ID = 'integrations.inbox.accountId';
const MEM_BRAND_ID = 'integrations.inbox.brandId';
const MEM_EMBEDDABLE_ID = 'integrations.inbox.embeddableId';
const MEM_CATEGORY_ID = 'integrations.inbox.contactFormCategoryId';

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

    // Fetch the brand/account pointers plus the embeddable/contact-form-category ids from memory
    const brandIdResult = await memory.get(scope, MEM_BRAND_ID);
    const accountIdResult = await memory.get(scope, MEM_ACCOUNT_ID);
    const embeddableIdResult = await memory.get(scope, MEM_EMBEDDABLE_ID);
    const categoryIdResult = await memory.get(scope, MEM_CATEGORY_ID);

    let brandId: string | null = null;
    let accountId: string | null = null;
    let embeddableId: number | null = null;
    let categoryId: number | string | null = null;

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

    // Handle embeddableId — persisted as a number by the inbox skill.
    if (embeddableIdResult.success && embeddableIdResult.exists) {
      if (typeof embeddableIdResult.value === 'number') {
        embeddableId = embeddableIdResult.value;
      } else {
        contextLogger.warn('inboxAccount.route.invalidEmbeddableIdData', {
          appId,
          dataType: typeof embeddableIdResult.value
        });
      }
    } else if (!embeddableIdResult.success) {
      contextLogger.warn('inboxAccount.route.embeddableIdMemoryRead.failed', {
        appId,
        key: MEM_EMBEDDABLE_ID,
        error: embeddableIdResult.error
      });
    }

    // Handle categoryId — the Reamaze contact-form channel id, stored as number | string.
    if (categoryIdResult.success && categoryIdResult.exists) {
      if (typeof categoryIdResult.value === 'number' || typeof categoryIdResult.value === 'string') {
        categoryId = categoryIdResult.value;
      } else {
        contextLogger.warn('inboxAccount.route.invalidCategoryIdData', {
          appId,
          dataType: typeof categoryIdResult.value
        });
      }
    } else if (!categoryIdResult.success) {
      contextLogger.warn('inboxAccount.route.categoryIdMemoryRead.failed', {
        appId,
        key: MEM_CATEGORY_ID,
        error: categoryIdResult.error
      });
    }

    // Log the result
    if (brandId !== null || accountId !== null) {
      contextLogger.info('inboxAccount.route.success', {
        appId,
        brandId,
        accountId,
        embeddableId,
        categoryId
      });
    } else {
      contextLogger.info('inboxAccount.route.notFound', { appId });
    }

    res.json({ brandId, accountId, embeddableId, categoryId });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    contextLogger.error('inboxAccount.route.error', {
      appId,
      error: errorMessage,
    });
    res.status(500).json({
      error: 'Internal server error',
      brandId: null,
      accountId: null,
      embeddableId: null,
      categoryId: null
    });
  }
});

/**
 * POST /apps/:id/inbox-account
 * Persists the linked inbox accountId (and optionally brandId) to the memory table.
 *
 * Used to backfill legacy apps that are missing their brandId, accountId, or both. The browser
 * resolves the account via Reamaze (which requires the user's SSO session the agent lacks),
 * matching by aabAppId, and posts the resolved pointers here to persist. brandId is optional —
 * supply it to heal an app whose brandId is also missing from memory.
 *
 * The client-supplied values are trusted: validateAppOwnership guarantees the caller owns
 * this app, and the values only ever land in this app's own memory namespace.
 */
router.post('/apps/:id/inbox-account', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { id: appId } = req.params;
  const contextLogger = log.forApp(appId!);

  const { accountId, brandId } = req.body as { accountId?: unknown; brandId?: unknown };
  if (typeof accountId !== 'string' || accountId.trim().length === 0) {
    res.status(400).json({ error: 'accountId is required and must be a non-empty string' });
    return;
  }
  const resolvedBrandId: string | null =
    typeof brandId === 'string' && brandId.trim().length > 0 ? brandId.trim() : null;

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const scope = workspaceScopeFromAppId(appId!, customerId);

    // These two writes are not transactional, so persist brandId BEFORE accountId: accountId is
    // the pointer that gates the healed Conversations view, so writing it last means a partial
    // failure can only ever leave the app in its prior (pre-heal) state — never accountId without
    // brandId, which would keep the client re-polling. A re-attempt next mount re-writes both
    // idempotently. brandId is skipped when not supplied (heal accountId only).
    const writes: Array<[string, string]> = [];
    if (resolvedBrandId !== null) writes.push([MEM_BRAND_ID, resolvedBrandId]);
    writes.push([MEM_ACCOUNT_ID, accountId]);

    for (const [key, value] of writes) {
      const result = await memory.set(scope, key, value);
      if (!result.success) {
        contextLogger.error('inboxAccount.route.set.failed', { appId, key, error: result.error });
        res.status(500).json({ error: 'Failed to persist inbox account data' });
        return;
      }
    }

    contextLogger.info('inboxAccount.route.set.success', { appId, accountId, brandId: resolvedBrandId });
    res.json({ accountId, brandId: resolvedBrandId });
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
