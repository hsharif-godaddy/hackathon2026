import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

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
  isWildcardDomain?: boolean;
}

/**
 * Modify domains response
 */
export interface ModifyDomainsResponse {
  statusJobId: string;
  status: string;
  message: string;
}

export interface DomainMutationDetails {
  code?: string;
  message: string;
  domainSpecificError?: Record<string, string>;
}

/**
 * Typed error for domain mutation failures, avoids JSON serialization in Error.message
 */
export class DomainMutationError extends Error {
  constructor(public readonly details: DomainMutationDetails) {
    super(details.message);
    this.name = 'DomainMutationError';
  }
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
 *     createCdn: true,
 *     isWildcardDomain: true,
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
      }, { authLevel: 3 });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const details = errorData.details;
        const errorMessage =
          (typeof details === 'object' ? (details?.message ?? details?.error?.message) : details) ||
          errorData.error ||
          `Failed to modify domains: ${response.status}`;

        const domainSpecificError: Record<string, string> = {};
        for (const d of payload.domainsToCreate ?? []) {
          domainSpecificError[d.fqdn.trim().toLowerCase()] = errorMessage;
        }
        for (const d of payload.domainsToDelete ?? []) {
          domainSpecificError[d.fqdn.trim().toLowerCase()] = errorMessage;
        }
        logger.error('domain-operations.modify.failure', {
          message: errorMessage,
          code: errorData.code,
          appId: siteId,
          errorBody: JSON.stringify(errorData),
          status: response.status,
        });
        throw new DomainMutationError({
          code: errorData.code,
          message: errorMessage,
          ...(Object.keys(domainSpecificError).length > 0 && { domainSpecificError }),
        });
      }

      const data: ModifyDomainsResponse = await response.json();

      // Invalidate app details query to trigger refetch with new domain status
      queryClient.invalidateQueries({ queryKey: ['app-details', siteId] });

      return data;
    },
    onSuccess: (data, variables) => {
      const isConnect = (variables.payload.domainsToCreate?.length ?? 0) > 0;
      const fqdn = variables.payload.domainsToCreate?.[0]?.fqdn?.trim().toLowerCase();
      if (isConnect && fqdn) {
        useDevelopPageStore.getState().setDomainJobInProgress(variables.siteId, {
          fqdn,
          startedAt: Date.now(),
          jobStatus: data.status,
        });
      }
    },
  });
}
