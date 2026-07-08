'use client';

import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export type CommerceBindingStatus =
  | 'business_bound'
  | 'store_bound'
  | 'channel_pending'
  | 'channel_ready'
  | 'invalid';

export type CommerceBindingSource =
  | 'user_selected'
  | 'tool_setup'
  | 'tool_discovery'
  | 'tool_channel_ensure'
  | 'migration'
  | 'env_fallback'
  | 'unknown';

export type CommerceBinding = {
  appId: string;
  businessId?: string | null;
  businessName?: string | null;
  storeId?: string | null;
  storeName?: string | null;
  storeUrl?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  defaultLocationId?: string | null;
  currencyCode?: string | null;
  status: CommerceBindingStatus;
  source: CommerceBindingSource;
  lastVerifiedAt: string | null;
  verificationError?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommerceBindingResponse = {
  configured: boolean;
  binding: CommerceBinding | null;
};

export async function fetchCommerceBinding(
  appId: string,
  signal?: AbortSignal
): Promise<CommerceBindingResponse> {
  const response = await appFetch(
    `/api/apps/${encodeURIComponent(appId)}/commerce/binding`,
    { headers: { Accept: 'application/json' }, signal }
  );

  if (!response.ok) {
    logger.warn('commerce.binding.fetch.error', { appId, status: response.status });
    throw new Error(`Failed to resolve Commerce binding (${response.status})`);
  }

  return response.json() as Promise<CommerceBindingResponse>;
}

/**
 * Resolves an Airo app's durable Commerce binding via the BFF.
 *
 * Disabled while `appId` is undefined.
 */
export function useCommerceBinding(appId: string | undefined) {
  return useQuery({
    queryKey: ['commerce-binding', appId],
    queryFn: ({ signal }) => fetchCommerceBinding(appId as string, signal),
    enabled: Boolean(appId),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
