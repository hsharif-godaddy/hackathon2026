import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Query key factory for app name operations
 * Centralizes query key generation for consistency across hooks
 */
export const appNameKeys = {
  all: ['appName'] as const,
  detail: (appId: string) => [...appNameKeys.all, appId] as const,
  validation: (name: string) => [...appNameKeys.all, 'validate', name] as const,
};

/**
 * Parameters for the app name update mutation
 */
interface UpdateAppNameParams {
  appId: string;
  newName: string;
}

/**
 * Result returned from the update mutation
 */
interface UpdateAppNameResult {
  success: boolean;
  message: string;
  appId: string;
  newName: string;
}

/**
 * Result returned from the validation query
 */
interface ValidateAppNameResult {
  isValid: boolean;
  isAvailable?: boolean;
  reason?: string;
  suggestions?: string[];
}

/**
 * React Query hook to fetch the current app name
 *
 * This is a query hook that fetches and caches the app name.
 * Use this when you need to display or read the current app name.
 *
 * @param appId - The app ID to fetch the name for
 * @param options - Optional React Query options
 * @returns Query object with data, isLoading, error, etc.
 *
 * @example
 * ```tsx
 * const { data: appName, isLoading } = useAppName('app-123');
 *
 * if (isLoading) return <Spinner />;
 * return <div>App Name: {appName}</div>;
 * ```
 */
export function useAppName(appId: string | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: appNameKeys.detail(appId || ''),
    queryFn: async () => {
      if (!appId) {
        throw new Error('App ID is required');
      }

      logger.info('app-name.fetch.start', { appId });

      const response = await appFetch(`/api/apps/${appId}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Fetch failed: ${response.status}`);
      }

      const result = await response.json();

      logger.info('app-name.fetch.success', { appId, name: result.name });

      return result.name as string;
    },
    enabled: !!appId && (options?.enabled !== false),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

/**
 * React Query mutation hook for updating an app's name
 *
 * This is a mutation hook that updates the app name and automatically
 * invalidates relevant caches on success.
 *
 * @returns Mutation object with mutate, mutateAsync, isPending, isError, error, data
 *
 * @example
 * ```tsx
 * const updateAppName = useAppNameUpdate();
 *
 * const handleSave = async () => {
 *   try {
 *     await updateAppName.mutateAsync({
 *       appId: 'app-123',
 *       newName: 'my-new-app-name'
 *     });
 *     toast.success('Name updated!');
 *   } catch (error) {
 *     toast.error('Update failed');
 *   }
 * };
 * ```
 */
export function useAppNameUpdate() {
  const queryClient = useQueryClient();

  return useMutation<UpdateAppNameResult, Error, UpdateAppNameParams>({
    mutationFn: async ({ appId, newName }) => {
      logger.info('app-name.update.start', {
        appId,
        newName,
      });

      const response = await appFetch(`/api/apps/${appId}/project-domain`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectPrefix: newName }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Update failed: ${response.status}`);
      }

      const result = await response.json();
      return result;
    },
    onSuccess: (data, variables) => {
      logger.info('app-name.update.success', {
        appId: variables.appId,
        newName: variables.newName,
      });

      // Invalidate app name cache
      queryClient.invalidateQueries({
        queryKey: appNameKeys.detail(variables.appId),
      });

      // Invalidate site cache (for backward compatibility)
      queryClient.invalidateQueries({
        queryKey: ['site', variables.appId],
      });
    },
    onError: (error, variables) => {
      logger.error('app-name.update.error', {
        appId: variables.appId,
        newName: variables.newName,
        error: error.message,
      });
    },
  });
}

/**
 * React Query hook to validate if an app name meets the backend validation rules
 *
 * This is a query hook that checks if a proposed app name is valid
 *  Currently returns isValid: true always because the backend validation rules are enforced in the mutation hook.
 * @param name - The app name to validate
 * @param options - Optional React Query options
 * @returns Query object with validation result
 *
 * @example
 * ```tsx
 * const { data: validation, isLoading } = useAppNameValidation('my-app-name', {
 *   enabled: name.length > 0
 * });
 *
 * if (validation?.isValid) {
 *   return <span>✓ Name is available</span>;
 * } else {
 *   return <span>✗ {validation?.reason}</span>;
 * }
 * ```
 */
export function useAppNameValidation(
  name: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: appNameKeys.validation(name || ''),
    queryFn: async (): Promise<ValidateAppNameResult> => {
      if (!name) {
        return {
          isValid: false,
          reason: 'Name cannot be empty',
        };
      }

      logger.info('app-name.validate.start', { name });

      // Basic validation rules follows backend validation rules
      const minLength = 1;
      const maxLength = 63;
      const validPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?/;

      if (name.length < minLength) {
        return {
          isValid: false,
          reason: `Name must be at least ${minLength} characters`,
        };
      }

      if (name.length > maxLength) {
        return {
          isValid: false,
          reason: `Name must be less than ${maxLength} characters`,
        };
      }

      if (!validPattern.test(name)) {
        return {
          isValid: false,
          reason: 'Subdomain must use only letters, numbers, and hyphens. Must start and end with a letter or number (minimum 5 characters).',
        };
      }

      // TODO: Check against database for availability
      // const response = await appFetch(`/api/apps/validate-name?name=${encodeURIComponent(name)}`);
      // const result = await response.json();
      // return result;

      logger.info('app-name.validate.success', { name, isValid: true });

      return {
        isValid: true,
        isAvailable: true,
      };
    },
    enabled: !!name && name.length > 0 && (options?.enabled !== false),
    staleTime: 1000 * 60, // Cache validation for 1 minute
    retry: false, // Don't retry validation requests
  });
}
