'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export interface InboxAccountData {
  accountId: string | null;
  brandId: string | null;
}

/** Minimal shape of a Reamaze account returned by `POST /api/inbox` (list_accounts). */
interface InboxAccountLite {
  accountUrl: string;
  brandUrl: string;
}

interface DiscoverVariables {
  appId: string;
  brandId: string;
}

/**
 * Resolve and persist the inbox accountId for a legacy app that has a brandId in memory
 * but no accountId.
 *
 * Discovery (`list_accounts`) must run from the browser because Reamaze authorizes on the
 * user's SSO session — the agent/server doesn't hold it. We match the account by brandUrl,
 * then POST the resolved accountUrl back to the agents memory route to persist it.
 *
 * Returns the resolved accountId, or null when no matching account exists (terminal — the
 * caller's ref guard prevents a retry loop).
 */
async function discoverAndPersistAccount({ appId, brandId }: DiscoverVariables): Promise<string | null> {
  // 1. List accounts via the BFF — the browser carries auth_idp through to Reamaze.
  const listResponse = await appFetch('/api/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'list_accounts' }),
  });
  if (!listResponse.ok) {
    throw new Error(`Failed to list inbox accounts: ${listResponse.status} ${listResponse.statusText}`.trim());
  }

  const payload = (await listResponse.json()) as { status: number; data?: { accounts?: InboxAccountLite[] } };
  const accounts = payload.data?.accounts ?? [];
  const match = accounts.find((account) => account.brandUrl === brandId);
  if (!match?.accountUrl) {
    logger.warn('inbox-account.backfill.no-match', { appId, brandId });
    return null;
  }

  // 2. Persist the resolved accountId to agents memory.
  const url = await buildDynamicApiUrl('inbox-account', appId);
  const persistResponse = await agentFetch(url, {
    siteId: appId,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: match.accountUrl }),
  });
  if (!persistResponse.ok) {
    throw new Error(`Failed to persist inbox accountId: ${persistResponse.status} ${persistResponse.statusText}`.trim());
  }

  logger.info('inbox-account.backfill.success', { appId, brandId, accountId: match.accountUrl });
  return match.accountUrl;
}

/**
 * React Query hook for fetching the Conversations account data (brandId and accountId) for an app.
 *
 * Uses TanStack Query for automatic caching, background refetching, and deduplication.
 * The account data is cached and shared across components for the same appId.
 *
 * @param appId - App ID (optional)
 * @returns Query result with brandId, accountId, isLoading, error, and refetch function
 *
 * @example
 * ```typescript
 * const { brandId, accountId, isLoading, error } = useConversationsAccount(appId);
 * ```
 */

export function useInboxAccount(appId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['inbox-account', appId],
    queryFn: async (): Promise<InboxAccountData> => {
      if (!appId) {
        return { accountId: null, brandId: null };
      }

      logger.debug('inbox-account.fetch.start', {
        message: 'Fetching inbox account data via React Query',
        appId,
      });

      const url = await buildDynamicApiUrl('inbox-account', appId);
      const response = await agentFetch(url, { siteId: appId });

      if (!response.ok) {
        const errorMessage = `Failed to fetch inbox account data: ${response.status} ${response.statusText}`.trim();
        logger.error('inbox-account.fetch.failure', {
          message: errorMessage,
          appId,
        });
        throw new Error(errorMessage);
      }

      const data = await response.json() as InboxAccountData;

      logger.info('inbox-account.fetch.success', {
        accountId: data.accountId,
        brandId: data.brandId,
        appId,
      });

      return data;
    },
    enabled: !!appId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Self-heal legacy apps: a brandId with no accountId predates the accountId memory key.
  // Resolve the accountId from Reamaze (browser-only, needs SSO) and persist it.
  const { mutate: discoverAccount } = useMutation<string | null, Error, DiscoverVariables>({
    mutationFn: discoverAndPersistAccount,
    // Survive transient failures (network blip, BFF 502, persist 5xx). Both operations are
    // idempotent — list_accounts is a read, and persist sets the same accountId — so retrying
    // is safe. onError only fires once the retries are exhausted (a genuinely persistent
    // failure), at which point the ref guard intentionally stops us hammering until a reload.
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    onSuccess: (resolvedAccountId, variables) => {
      if (resolvedAccountId) {
        void queryClient.invalidateQueries({
          queryKey: ['inbox-account', variables.appId],
          refetchType: 'active',
        });
      }
    },
    onError: (error, variables) => {
      logger.error('inbox-account.backfill.error', {
        appId: variables.appId,
        error: error.message,
      });
    },
  });

  // Attempt at most once per appId per mount — also avoids re-firing on the terminal
  // "no matching account" case, where accountId stays null.
  const attemptedRef = useRef<Set<string>>(new Set());
  const brandId = query.data?.brandId ?? null;
  const accountId = query.data?.accountId ?? null;

  useEffect(() => {
    if (!appId || !brandId || accountId) return;
    if (attemptedRef.current.has(appId)) return;
    attemptedRef.current.add(appId);
    discoverAccount({ appId, brandId });
  }, [appId, brandId, accountId, discoverAccount]);

  return {
    accountId,
    brandId,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
