import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { useSiteStore } from '@/stores/useSiteStore';

interface RenameAppParams {
  appId: string;
  newName: string;
}

interface RenameAppResult {
  success: boolean;
  message?: string;
}

interface RenameAppContext {
  previousSiteStore?: SiteInfo;
  previousSitesStore?: SiteInfo;
  previousDevelopSite?: SiteInfo | null;
}

/**
 * Hook to rename an app with proper cache management
 * 
 * This hook ensures consistency across all caches and stores:
 * - Updates backend via API
 * - Optimistically updates all Zustand stores
 * - Invalidates React Query caches
 * - No race conditions
 * 
 * @example
 * ```tsx
 * const { mutate: renameApp, isPending } = useAppRename();
 * 
 * function handleRename() {
 *   renameApp({
 *     appId: 'app-123',
 *     newName: 'My New App Name'
 *   }, {
 *     onSuccess: () => toast.success('Renamed!'),
 *     onError: (err) => toast.error(err.message)
 *   });
 * }
 * ```
 */
export function useAppRename() {
  const queryClient = useQueryClient();

  return useMutation<RenameAppResult, Error, RenameAppParams, RenameAppContext>({
    // Main mutation function - calls API to update app name in control plane
    mutationFn: async ({ appId, newName }) => {
      logger.info('app-rename.start', { appId, newName });

      const response = await appFetch(`/api/sites/${appId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Rename failed: ${response.status}`);
      }

      await response.json();

      return {
        success: true,
        message: 'App renamed successfully'
      };
    },

    onMutate: async ({ appId, newName }) => {
      // Optimistic updates - update UI immediately
      logger.info('app-rename.optimistic-update', { appId, newName });

      // Save previous states for rollback (from Zustand stores for accuracy)
      const previousSiteStore = useSiteStore.getState().sites[appId];
      const previousSitesStore = useSitesStore.getState().sitesById[appId];
      const previousDevelopSite = useDevelopPageStore.getState().site;

      // Update stores in consistent order: useSiteStore → useSitesStore → useDevelopPageStore
      useSiteStore.getState().updateSite(appId, { name: newName });
      useSitesStore.getState().updateSite(appId, { name: newName });

      // Update useDevelopPageStore if this is the currently open app
      const developState = useDevelopPageStore.getState();
      if (developState.site?.id === appId) {
        useDevelopPageStore.setState((state) => {
          if (state.site) {
            return {
              ...state,
              site: {
                ...state.site,
                name: newName
              }
            };
          }
          return state;
        });
      }

      // Return context for rollback if needed
      return { previousSiteStore, previousSitesStore, previousDevelopSite };
    },

    onSuccess: (data, variables) => {
      logger.info('app-rename.success', {
        appId: variables.appId,
        newName: variables.newName
      });

      // Optimistic updates already applied the changes, so we only need to:
      // 1. Update React Query cache to match
      // 2. Mark queries as stale for eventual consistency
      
      queryClient.setQueryData(['site', variables.appId], (old: any) => {
        if (old) {
          return { ...old, name: variables.newName };
        }
        return old;
      });

      queryClient.setQueryData(['sites'], (old: any) => {
        if (old && Array.isArray(old)) {
          return old.map((site) =>
            site.id === variables.appId ? { ...site, name: variables.newName } : site
          );
        }
        return old;
      });

      // Mark queries as stale for background refetch
      queryClient.invalidateQueries({
        queryKey: ['appName', variables.appId],
        refetchType: 'none'
      });
    },

    onError: (error, variables, context) => {
      logger.error('app-rename.error', {
        appId: variables.appId,
        newName: variables.newName,
        error: error.message
      });

      // Rollback optimistic updates to previous state
      logger.warn('app-rename.rollback', {
        appId: variables.appId,
        message: 'Rolling back optimistic updates'
      });

      // Rollback Zustand stores using consistent updateSite method
      if (context?.previousSiteStore) {
        useSiteStore.getState().updateSite(variables.appId, context.previousSiteStore);
      }
      
      if (context?.previousSitesStore) {
        useSitesStore.getState().updateSite(variables.appId, context.previousSitesStore);
      }
      
      if (context?.previousDevelopSite?.id === variables.appId) {
        useDevelopPageStore.setState((state) => {
          return {
            ...state,
            site: context.previousDevelopSite
          }
        });
      }

      // Invalidate to force refetch in case rollback was incomplete
      queryClient.invalidateQueries({
        queryKey: ['site', variables.appId],
      });
      queryClient.invalidateQueries({
        queryKey: ['sites'],
      });
    },
  });
}
