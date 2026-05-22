/**
 * Conversation Brand ID Route
 *
 * Fetches the linked conversation brand ID from the memory table.
 * Data is stored in Memory by the conversations skill after linking an account.
 */

import { Router, Request, Response } from 'express';
import { log } from '../../logging/index.js';
import { getKvMemoryStore } from '../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

interface ConversationBrandData {
  brandId: string | null;
}

const router: Router = Router();
const memory = getKvMemoryStore();

/**
 * GET /apps/:id/conversation-brand-id
 * Fetches linked conversation brand ID from memory table.
 */
router.get('/apps/:id/conversation-brand-id', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { id: appId } = req.params;
  const contextLogger = log.forApp(appId!);

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const scope = workspaceScopeFromAppId(appId!, customerId);

    // Fetch brand ID from memory
    const brandIdResult = await memory.get(scope, 'integrations.conversations.brandId');

    if (!brandIdResult.success) {
      contextLogger.warn('conversationBrandId.route.memoryRead.failed', {
        appId,
        key: 'integrations.conversations.brandId',
        error: brandIdResult.error
      });
      res.status(500).json({
        error: 'Failed to read brand ID from memory',
        brandId: null
      });
      return;
    }

    if (!brandIdResult.exists) {
      contextLogger.info('conversationBrandId.route.notFound', { appId });
      res.json({ brandId: null });
      return;
    }

    // Validate the data structure - should be a string
    const brandId = brandIdResult.value;
    if (typeof brandId !== 'string') {
      contextLogger.warn('conversationBrandId.route.invalidData', {
        appId,
        dataType: typeof brandId
      });
      res.json({ brandId: null });
      return;
    }

    contextLogger.info('conversationBrandId.route.success', {
      appId,
      brandId
    });

    res.json({ brandId });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    contextLogger.error('conversationBrandId.route.error', {
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
