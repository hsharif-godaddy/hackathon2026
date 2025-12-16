import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Domain to create for an app
 */
export interface DomainToCreate {
  fqdn: string;
  primary?: boolean;
}

/**
 * Domain to delete from an app
 */
export interface DomainToDelete {
  fqdn: string;
}

/**
 * Modify domains request payload
 */
export interface ModifyDomainsPayload {
  domainsToCreate?: DomainToCreate[];
  domainsToDelete?: DomainToDelete[];
  createCdn?: boolean;
}

/**
 * Modify domains response
 */
export interface ModifyDomainsResponse {
  statusJobId: string;
  status: string;
  message: string;
}



/**
 * React Query mutation hook for modifying app domains
 *
 * Triggers domain modification (create/delete) for an app and returns a job ID
 * to track the workflow progress.
 *
 * @returns Mutation object with mutate/mutateAsync functions
 *
 * @example
 * ```typescript
 * const modifyDomainsMutation = useModifyDomains();
 *
 * // Add a domain
 * await modifyDomainsMutation.mutateAsync({
 *   siteId: 'app-123',
 *   payload: {
 *     domainsToCreate: [{ fqdn: 'example.com', primary: true }],
 *     createCdn: true
 *   }
 * });
 * ```
 */
export function useModifyDomains() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      siteId,
      payload,
    }: {
      siteId: string;
      payload: ModifyDomainsPayload;
    }): Promise<ModifyDomainsResponse> => {
      const response = await appFetch(`/api/sites/${siteId}/domains`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to modify domains: ${response.status}`;
        logger.error('domain-operations.modify.failure', {
          message: errorMessage,
          siteId,
          status: response.status,
        });
        throw new Error(errorMessage);
      }

      const data: ModifyDomainsResponse = await response.json();

      // Invalidate app details query to trigger refetch with new domain status
      queryClient.invalidateQueries({ queryKey: ['app-details', siteId] });

      return data;
    },
  });
}
