/**
 * Projects Hook
 *
 * Fetches user's projects for Airo Plus matching.
 */

import { type QueryClient, useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import type { ProjectEdge } from '@/lib/paywall/shared';

const QUERY_KEY = ['projects'] as const;
const STALE_TIME = 30000;

export type { ProjectEdge };

async function fetch(): Promise<ProjectEdge[]> {
  const response = await appFetch('/api/projects', { credentials: 'include' });
  if (!response.ok) return [];
  const data = await response.json();
  return data?.data?.projects?.edges ?? [];
}

interface UseProjectsOptions {
  enabled?: boolean;
}

export function useProjects(options?: UseProjectsOptions) {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetch,
    staleTime: STALE_TIME,
    enabled: options?.enabled,
  });
}

export function prefetchProjects(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: QUERY_KEY,
    queryFn: fetch,
    staleTime: STALE_TIME,
  });
}
