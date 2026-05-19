/**
 * Conversations Action Executor
 *
 * Called by the Conversations skill in agents to make authed calls to Reamaze.
 * The browser forwards the request to our BFF route (/api/conversations) with
 * credentials: 'include' so auth_idp rides along; the BFF validates + forwards
 * to Reamaze as the authenticated user. Modeled on attachDomainAction.ts.
 *
 * Security benefit: the user's auth_idp stays in the browser ↔ BFF boundary.
 * It is never sent over the websocket to agents service.
 */

import { appFetch, AuthDismissedError } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import type { ClientActionExecutor } from './types';

interface ConversationsParams {
  operation: 'list_accounts' | 'activate_account' | 'list_embeddables' | 'create_embeddable' | 'update_embeddable';
  brandId?: string;
  embeddableId?: number;
  body?: unknown;
}

export const conversationsAction: ClientActionExecutor = async (params) => {
  const { operation, brandId, embeddableId, body } = params as unknown as ConversationsParams;

  if (!operation || typeof operation !== 'string') {
    throw new Error('operation is required and must be a string');
  }
  if (operation === 'update_embeddable' && typeof embeddableId !== 'number') {
    throw new Error('embeddableId (number) is required for update_embeddable');
  }

  try {
    logger.info('conversations-action.begin', { operation, brandId });

    const response = await appFetch(
      '/api/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, brandId, embeddableId, body }),
      },
      { authLevel: 3 },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error('conversations-action.http-error', {
        operation,
        brandId,
        status: response.status,
        errorText: errorText.substring(0, 500),
      });
      throw new Error(`Conversations proxy failed: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const result = (await response.json()) as { status: number; data: unknown };

    if (result.status >= 400) {
      logger.error('conversations-action.upstream-error', {
        operation,
        brandId,
        upstreamStatus: result.status,
      });
    } else {
      logger.info('conversations-action.success', {
        operation,
        brandId,
        upstreamStatus: result.status,
      });
    }

    return result;
  } catch (error) {
    if (error instanceof AuthDismissedError) {
      logger.warn('conversations-action.auth-dismissed', { operation, brandId });
      throw error;
    }
    logger.error('conversations-action.unexpected-error', {
      operation,
      brandId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
