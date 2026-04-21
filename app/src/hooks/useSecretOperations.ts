import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Represents a secret update operation
 */
interface SecretUpdate {
  name: string;
  value: string;
}

/**
 * Request payload for bulk secret operations
 */
interface SecretOperationsRequest {
  appId: string;
  variant: 'preview' | 'publish';
  operations: {
    additions?: SecretUpdate[];
    updates?: SecretUpdate[];
    deletions?: string[];
  };
}

/**
 * Response from the secret operations API endpoint
 */
interface SecretOperationsResponse {
  success: boolean;
  message: string;
  operations: {
    added: number;
    updated: number;
    deleted: number;
  };
}

/**
 * Perform bulk secret operations (add/update/delete)
 *
 * Custom hook that handles bulk secret operations for a given app ID and variant.
 * Supports adding new secrets, updating existing secrets, and deleting secrets
 * in a single API call. Automatically invalidates the secrets cache on success.
 *
 * @returns Mutation object with mutate function and state
 *
 * @example
 * ```tsx
 * const secretOperations = useSecretOperations();
 *
 * await secretOperations.mutateAsync({
 *   appId: 'my-app-id',
 *   variant: 'preview',
 *   operations: {
 *     additions: [{ name: 'NEW_KEY', value: 'new_value' }],
 *     updates: [{ name: 'EXISTING_KEY', value: 'updated_value' }],
 *     deletions: ['OLD_KEY']
 *   }
 * });
 * ```
 */
export function useSecretOperations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: SecretOperationsRequest) => {
      const { appId, variant, operations } = request;

      logger.info('Secret operations request:', {
        appId,
        variant,
        additions: operations.additions?.length || 0,
        updates: operations.updates?.length || 0,
        deletions: operations.deletions?.length || 0,
      });

      const response = await appFetch(`/api/secrets/${appId}/variants/${variant}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operations,
        }),
      }, { authLevel: 3 });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || errorData.error || errorData.message || 'Failed to perform secret operations';

        logger.error('Secret operations error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
          variant,
        });

        throw new Error(errorMessage);
      }

      const data: SecretOperationsResponse = await response.json();

      logger.info('Secret operations success:', {
        appId,
        variant,
        added: data.operations.added,
        updated: data.operations.updated,
        deleted: data.operations.deleted,
      });

      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['secrets', variables.appId, variables.variant],
      });

      logger.info('Secrets cache invalidated:', {
        appId: variables.appId,
        variant: variables.variant,
      });
    },
    onError: (error, variables) => {
      logger.error('Secret operations mutation error:', {
        error: error instanceof Error ? error.message : String(error),
        appId: variables.appId,
        variant: variables.variant,
      });
    },
  });
}
