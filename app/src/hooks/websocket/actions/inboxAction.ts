/**
 * Inbox Action Executor
 *
 * Called by the Inbox skill in agents to make authed calls to Reamaze.
 * The browser forwards the request to our BFF route (/api/inbox) with
 * credentials: 'include' so auth_idp rides along; the BFF validates + forwards
 * to Reamaze as the authenticated user. Modeled on attachDomainAction.ts.
 *
 * Security benefit: the user's auth_idp stays in the browser ↔ BFF boundary.
 * It is never sent over the websocket to agents service.
 */

import { appFetch, AuthDismissedError } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import type { ClientActionExecutor } from './types';

interface InboxParams {
  operation: 'list_accounts' | 'activate_account' | 'update_account' | 'list_embeddables' | 'create_embeddable' | 'update_embeddable' | 'list_categories' | 'create_category' | 'get_staff' | 'update_staff';
  brandId?: string;
  embeddableId?: number;
  staffId?: number;
  body?: unknown;
}

export const inboxAction: ClientActionExecutor = async (params) => {
  const { operation, brandId, embeddableId, staffId, body } = params as unknown as InboxParams;

  if (!operation || typeof operation !== 'string') {
    throw new Error('operation is required and must be a string');
  }
  if (operation === 'update_embeddable' && typeof embeddableId !== 'number') {
    throw new Error('embeddableId (number) is required for update_embeddable');
  }
  if (operation === 'update_staff' && typeof staffId !== 'number') {
    throw new Error('staffId (number) is required for update_staff');
  }

  try {
    logger.info('inbox-action.begin', { operation, brandId });

    const response = await appFetch(
      '/api/inbox',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, brandId, embeddableId, staffId, body }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error('inbox-action.http-error', {
        operation,
        brandId,
        status: response.status,
        errorText: errorText.substring(0, 500),
      });
      throw new Error(`Inbox proxy failed: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const result = (await response.json()) as { status: number; data: unknown };

    if (result.status >= 400) {
      logger.error('inbox-action.upstream-error', {
        operation,
        brandId,
        upstreamStatus: result.status,
      });
    } else {
      logger.info('inbox-action.success', {
        operation,
        brandId,
        upstreamStatus: result.status,
      });
    }

    return result;
  } catch (error) {
    if (error instanceof AuthDismissedError) {
      logger.warn('inbox-action.auth-dismissed', { operation, brandId });
      throw error;
    }
    logger.error('inbox-action.unexpected-error', {
      operation,
      brandId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
