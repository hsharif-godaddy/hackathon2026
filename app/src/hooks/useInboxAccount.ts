'use client';

import { useEffect, useRef } from 'react';
import type { QueryObserverResult, RefetchOptions } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export interface InboxAccountData {
  accountId: string | null;
  brandId: string | null;
  // The inbox skill persists embeddableId as a number and the contact-form category id as the
  // Reamaze channel id (number | string); surfaced with their stored types, unlike the string
  // brand/account URL pointers.
  embeddableId: number | null;
  categoryId: number | string | null;
}

/** Minimal shape of a Reamaze account returned by `POST /api/inbox` (list_accounts). */
interface InboxAccountLite {
  accountUrl: string;
  brandUrl: string;
  /** AAB app this account is linked to, when Reamaze has it set. */
  aabAppId: string | null;
}

interface PersistVariables {
  appId: string;
  match: InboxAccountLite;
}

/** Public return shape of {@link useInboxAccount}. */
export interface UseInboxAccountResult {
  accountId: string | null;
  brandId: string | null;
  embeddableId: number | null;
  categoryId: number | string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: (options?: RefetchOptions) => Promise<QueryObserverResult<InboxAccountData, Error>>;
}

/**
 * Total time the browser polls list_accounts for an app's Reamaze account before giving up.
 * The account is provisioned asynchronously by an external worker at app creation, so it may
 * not exist on the first poll. Polling stops immediately once the pointers are persisted.
 */
export const POLL_WINDOW_MS = 5 * 60 * 1000;

/** Stepped poll backoff as a pure function of elapsed time — fast early, then eases off. */
export function pollBackoffMs(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 3_000;
  if (elapsedMs < 90_000) return 7_000;
  return 15_000;
}

/**
 * List Reamaze accounts (the browser carries auth_idp → Reamaze) and return the one linked to
 * this app by aabAppId. We need both pointers to heal the app, so a match missing accountUrl or
 * brandUrl is treated as "not found yet". Returns null when no usable match exists. Throws on a
 * non-ok list response so the caller (a polling query) treats it as a failed poll.
 */
async function listAndMatchAccount(appId: string): Promise<InboxAccountLite | null> {
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
  // Match the account linked to THIS app. We need both pointers to heal the app, so require
  // brandUrl as well as accountUrl on the match.
  const match = accounts.find((account) => account.aabAppId === appId);
  if (!match?.accountUrl || !match.brandUrl) {
    return null;
  }
  return match;
}

/** Persist the resolved accountId + brandId to agents memory. Throws on a non-ok response. */
async function persistAccountPointers({ appId, match }: PersistVariables): Promise<void> {
  const url = await buildDynamicApiUrl('inbox-account', appId);
  const persistResponse = await agentFetch(url, {
    siteId: appId,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: match.accountUrl, brandId: match.brandUrl }),
  });
  if (!persistResponse.ok) {
    throw new Error(`Failed to persist inbox account pointers: ${persistResponse.status} ${persistResponse.statusText}`.trim());
  }
  logger.info('inbox-account.backfill.success', { appId, brandId: match.brandUrl, accountId: match.accountUrl });
}

/**
 * React Query hook for the Conversations account pointers (brandId + accountId) of an app.
 *
 * Beyond reading the persisted pointers, this self-heals apps whose pointers are missing: it
 * polls Reamaze list_accounts (browser-only — Reamaze authorizes on the user's SSO session the
 * agent lacks), matches by aabAppId, and persists accountId + brandId back to agents memory. The
 * Reamaze account is created asynchronously by an external worker at app creation, so polling
 * (bounded to POLL_WINDOW_MS with backoff) covers the window before it exists.
 *
 * @param appId - App ID (optional)
 * @returns { accountId, brandId, isLoading, error, refetch }
 *
 * @example
 * ```typescript
 * const { brandId, accountId, isLoading, error } = useInboxAccount(appId);
 * ```
 */
export function useInboxAccount(appId: string | undefined): UseInboxAccountResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['inbox-account', appId],
    queryFn: async (): Promise<InboxAccountData> => {
      if (!appId) {
        return { accountId: null, brandId: null, embeddableId: null, categoryId: null };
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

  const brandId = query.data?.brandId ?? null;
  const accountId = query.data?.accountId ?? null;
  const embeddableId = query.data?.embeddableId ?? null;
  const categoryId = query.data?.categoryId ?? null;
  const isLoaded = query.isSuccess;
  const pointersComplete = Boolean(brandId && accountId);

  // Poll start time, re-armed whenever appId changes (and naturally per mount). Adjusted during
  // render — a ref keyed on appId — so the very first refetchInterval evaluation sees it.
  const pollStartRef = useRef<{ appId: string | undefined; start: number }>({ appId: undefined, start: 0 });
  if (pollStartRef.current.appId !== appId) {
    pollStartRef.current = { appId, start: Date.now() };
  }

  // Log "gave up" at most once per appId.
  const gaveUpRef = useRef<Set<string>>(new Set());

  // Poll list_accounts until the worker's account appears (or the deadline passes). Read-only —
  // the matched account is persisted by the mutation below, which keeps this read cacheable and
  // pollable. staleTime:0 + refetchOnWindowFocus:false mean a fresh mount re-attempts but a
  // settled give-up does not silently re-poll.
  const discoveryQuery = useQuery<InboxAccountLite | null>({
    queryKey: ['inbox-discovery', appId],
    queryFn: async (): Promise<InboxAccountLite | null> => {
      if (!appId) return null;
      try {
        return await listAndMatchAccount(appId);
      } catch (error: unknown) {
        logger.warn('inbox-account.backfill.poll.error', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    enabled: !!appId && isLoaded && !pointersComplete,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (discovery) => {
      if (discovery.state.data) return false; // matched → stop polling
      const elapsed = Date.now() - pollStartRef.current.start;
      if (elapsed > POLL_WINDOW_MS) {
        if (appId && !gaveUpRef.current.has(appId)) {
          gaveUpRef.current.add(appId);
          logger.info('inbox-account.backfill.give-up', { appId, elapsedMs: elapsed });
        }
        return false; // deadline reached → give up
      }
      return pollBackoffMs(elapsed);
    },
  });

  // Persist a matched account to agents memory (a write — never cached). The effect below marks
  // an appId as attempted before firing, so each match is persisted at most once per mount —
  // including the terminal-failure case: we do not re-fire after the mutation's retries are
  // exhausted (polling has already stopped, so a later mount/session re-attempts with fresh refs).
  const persistedRef = useRef<Set<string>>(new Set());
  const { mutate: persistAccount } = useMutation<void, Error, PersistVariables>({
    mutationFn: persistAccountPointers,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['inbox-account', variables.appId],
        refetchType: 'active',
      });
    },
    onError: (error, variables) => {
      logger.error('inbox-account.backfill.error', {
        appId: variables.appId,
        error: error.message,
      });
    },
  });

  const matchedAccount = discoveryQuery.data ?? null;
  useEffect(() => {
    if (!appId || !matchedAccount) return;
    if (persistedRef.current.has(appId)) return;
    persistedRef.current.add(appId);
    logger.info('inbox-account.backfill.poll.match', {
      appId,
      accountId: matchedAccount.accountUrl,
      brandId: matchedAccount.brandUrl,
    });
    persistAccount({ appId, match: matchedAccount });
  }, [appId, matchedAccount, persistAccount]);

  return {
    accountId,
    brandId,
    embeddableId,
    categoryId,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
