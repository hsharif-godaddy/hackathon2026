import { useQuery } from '@tanstack/react-query';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Represents a secret stored for an application
 */
export interface Secret {
  name: string;
  value?: string;
  systemManaged: boolean;
  variants: ('preview' | 'publish')[];
  syncStatus?: 'synced' | 'added' | 'updated';
}

/**
 * Response from the secrets API endpoint
 */
interface SecretsResponse {
  appId: string;
  secrets: Secret[];
  count: number;
}

/**
 * Options for the useSecrets hook
 */
interface UseSecretsOptions {
  appId: string;
  variant: 'preview' | 'publish';
  enabled?: boolean;
}

/**
 * Fetch secrets for an application
 *
 * Custom hook that fetches the list of secrets for a given app ID and variant.
 * Handles 404 responses as empty state (no secrets configured yet) and provides
 * proper error handling for other failure scenarios.
 *
 * @param options - Configuration options
 * @param options.appId - The application ID to fetch secrets for
 * @param options.variant - The variant to fetch secrets for ('preview' or 'publish')
 * @param options.enabled - Whether the query should run (default: true)
 * @returns Query result with secrets data, loading state, and error
 *
 * @example
 * ```tsx
 * const { data: secrets = [], isLoading, error, refetch } = useSecrets({
 *   appId: 'my-app-id',
 *   variant: 'preview'
 * });
 * ```
 */
export function useSecrets({ appId, variant, enabled = true }: UseSecretsOptions) {
  return useQuery({
    queryKey: ['secrets', appId, variant],
    queryFn: async () => {
      const response = await appFetch(`/api/secrets/${appId}/variants/${variant}`);

      // Handle 404 as empty state (no secrets configured yet)
      if (response.status === 404) {
        return [];
      }

      if (!response.ok) {
        const errorData = await response.json();
        // Handle nested error structures from API
        const errorMessage = errorData.error?.message || errorData.error || errorData.message || 'Failed to fetch secrets';

        logger.error('Secrets fetch error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
        });

        throw new Error(errorMessage);
      }

      const data: SecretsResponse = await response.json();
      // check for the diff between the given variant vs remaining variant
      const destinationVariant = variant === 'preview' ? 'publish' : 'preview';
      const diffResponse = await appFetch(`/api/secrets/${appId}/diff?source=${variant}&destination=${destinationVariant}`);
      if (diffResponse.ok) {
        const diffData = await diffResponse.json();
        for (const secret of data.secrets) {
          if (diffData.added.includes(secret.name)) {
            secret.syncStatus = 'added';
          } else if (diffData.updated.includes(secret.name)) {
            secret.syncStatus = 'updated';
          } else {
            secret.syncStatus = 'synced';
          }
        }
      }
      return data.secrets;
    },
    enabled: enabled && !!appId,
    staleTime: 30000, // Consider data fresh for 30 seconds
    retry: 1, // Retry once on failure
  });
}
