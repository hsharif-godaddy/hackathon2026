import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { normalizeFqdn } from '@/utils/domain';
import { DomainMutationError, type DomainToCreate, type ModifyDomainsResponse } from './useModifyDomains';

/**
 * CAA remediation request payload — same create-side shape as the attach call,
 * plus explicit consent and an optional issuer override.
 */
export interface CaaRemediationPayload {
  domainsToCreate: DomainToCreate[];
  createCdn?: boolean;
  consent: boolean;
  issuer?: string;
}

/**
 * React Query mutation hook for consent-gated CAA remediation.
 *
 * Calls the BFF caa-remediation route which additively authorizes a supported
 * issuer on the domain's existing CAA records and re-runs the attach. On
 * success it seeds the in-progress domain job so the existing per-row polling
 * (useDomainJobPolling) resumes tracking the re-attach.
 *
 * @returns Mutation object with mutate/mutateAsync functions
 *
 * @example
 * ```typescript
 * const caaRemediation = useCaaRemediation();
 * await caaRemediation.mutateAsync({
 *   siteId: 'app-123',
 *   payload: {
 *     domainsToCreate: [{ fqdn: 'example.com', primary: true }],
 *     createCdn: true,
 *     consent: true,
 *   },
 * });
 * ```
 */
export function useCaaRemediation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      siteId,
      payload,
    }: {
      siteId: string;
      payload: CaaRemediationPayload;
    }): Promise<ModifyDomainsResponse> => {
      const normalizedPayload: CaaRemediationPayload = {
        ...payload,
        domainsToCreate: payload.domainsToCreate.map((domain) => ({
          ...domain,
          fqdn: normalizeFqdn(domain.fqdn),
        })),
      };

      const response = await appFetch(`/api/sites/${siteId}/domains/caa-remediation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(normalizedPayload),
      }, { authLevel: 3 });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const details = errorData.details;
        const nestedError =
          typeof details === 'object' && details !== null
            ? (typeof details.error === 'object' && details.error !== null
                ? details.error
                : details)
            : null;
        const nestedCode = typeof nestedError?.code === 'string' ? nestedError.code : undefined;
        const effectiveNestedCode =
          nestedCode ?? (typeof errorData?.code === 'string' ? errorData.code : undefined);
        const errorMessage =
          (typeof details === 'object' ? (details?.message ?? details?.error?.message) : details) ||
          errorData.error ||
          `Failed to run CAA remediation: ${response.status}`;

        logger.error('domain-operations.caa-remediation.failure', {
          message: errorMessage,
          code: errorData.code,
          appId: siteId,
          errorBody: JSON.stringify(errorData),
          status: response.status,
        });
        throw new DomainMutationError({
          code: errorData.code,
          message: errorMessage,
          ...(effectiveNestedCode && { nestedCode: effectiveNestedCode }),
        });
      }

      const data: ModifyDomainsResponse = await response.json();
      queryClient.invalidateQueries({ queryKey: ['app-details', siteId] });
      return data;
    },
    onSuccess: (data, variables) => {
      const fqdn = variables.payload.domainsToCreate[0]?.fqdn?.trim().toLowerCase();
      if (fqdn) {
        useDevelopPageStore.getState().setDomainJobInProgress(variables.siteId, {
          fqdn,
          startedAt: Date.now(),
          jobStatus: data.status,
        });
      }
    },
  });
}
