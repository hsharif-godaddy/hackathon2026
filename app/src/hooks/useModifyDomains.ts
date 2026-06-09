import { useMutation, useQueryClient } from '@tanstack/react-query';

import { agentFetch } from '@/lib/agent-fetch';
import { DomainType } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { MWP_V2_APP_OWNER_TYPE } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { normalizeFqdn } from '@/utils/domain';

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
  transferFrom?: {
    appId: string;
    systemId: string;
    subscriptionId: string;
  };
  transferFromMWP?: {
    v2AppId: string;
  };
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
  nestedCode?: string;
  conflictingProduct?: string;
  tldValue?: string;
  conflictDetails?: {
    existingAppId: string;
    existingSystemId?: string;
    existingOwnerType: string;
    existingOwnerId: string;
    existingAppName?: string;
    domain: string;
  };
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

function normalizeModifyDomainsPayload(payload: ModifyDomainsPayload): ModifyDomainsPayload {
  return {
    ...payload,
    domainsToCreate: payload.domainsToCreate?.map((domain) => ({
      ...domain,
      fqdn: normalizeFqdn(domain.fqdn),
    })),
    domainsToDelete: payload.domainsToDelete?.map((domain) => ({
      ...domain,
      fqdn: normalizeFqdn(domain.fqdn),
    })),
  };
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
      const normalizedPayload = normalizeModifyDomainsPayload(payload);
      const response = await appFetch(`/api/sites/${siteId}/domains`, {
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
        const conflictSource = nestedError?.details ?? details ?? null;
        const rawConflictDetails =
          effectiveNestedCode === 'DOMAIN_IN_USE_BY_OWN_APP' &&
          typeof conflictSource === 'object' &&
          conflictSource !== null
            ? conflictSource
            : null;
        const airoConflictDetails =
          rawConflictDetails &&
          typeof rawConflictDetails.existingAppId === 'string' &&
          typeof rawConflictDetails.existingSystemId === 'string' &&
          typeof rawConflictDetails.existingOwnerType === 'string' &&
          typeof rawConflictDetails.existingOwnerId === 'string' &&
          typeof rawConflictDetails.domain === 'string'
            ? {
              existingAppId: rawConflictDetails.existingAppId,
              existingSystemId: rawConflictDetails.existingSystemId,
              existingOwnerType: rawConflictDetails.existingOwnerType,
              existingOwnerId: rawConflictDetails.existingOwnerId,
              ...(typeof rawConflictDetails.existingAppName === 'string'
                && { existingAppName: rawConflictDetails.existingAppName }),
              domain: rawConflictDetails.domain,
            }
            : undefined;
        const mwpRaw =
          effectiveNestedCode === 'DOMAIN_ALREADY_IN_USE' &&
          typeof conflictSource === 'object' &&
          conflictSource !== null
            ? conflictSource
            : null;
        const mwpConflictDetails =
          mwpRaw &&
          typeof mwpRaw.value === 'string' &&
          mwpRaw.value.length > 0 &&
          typeof mwpRaw.mwpTransfer === 'object' &&
          mwpRaw.mwpTransfer !== null &&
          mwpRaw.mwpTransfer.transferable === true &&
          typeof mwpRaw.mwpTransfer.v2AppId === 'string' &&
          mwpRaw.mwpTransfer.v2AppId.trim().length > 0
            ? {
              existingAppId: mwpRaw.mwpTransfer.v2AppId,
              existingOwnerType: MWP_V2_APP_OWNER_TYPE,
              existingOwnerId: mwpRaw.mwpTransfer.v2AppId,
              existingAppName:
                typeof mwpRaw.mwpTransfer.siteName === 'string'
                  ? mwpRaw.mwpTransfer.siteName
                  : undefined,
              domain: mwpRaw.value,
            }
            : undefined;
        if (
          effectiveNestedCode === 'DOMAIN_ALREADY_IN_USE' &&
          !mwpConflictDetails &&
          typeof conflictSource?.mwpTransfer === 'object' &&
          conflictSource.mwpTransfer !== null &&
          conflictSource.mwpTransfer.transferable === true
        ) {
          logger.warn('domain-operations.modify.mwp-conflict-parse-failed', {
            appId: siteId,
            effectiveNestedCode,
            hasNestedError: !!nestedError,
            errorBody: JSON.stringify(errorData),
          });
        }
        const tldValue =
          effectiveNestedCode === 'TLD_NOT_SUPPORTED' &&
          typeof conflictSource?.tld === 'string'
            ? conflictSource.tld
            : undefined;
        const conflictingProduct =
          effectiveNestedCode === 'DOMAIN_ALREADY_IN_USE' &&
          typeof conflictSource?.conflictingProduct === 'string'
            ? conflictSource.conflictingProduct
            : undefined;
        const conflictDetails = airoConflictDetails ?? mwpConflictDetails;
        const errorMessage =
          (typeof details === 'object' ? (details?.message ?? details?.error?.message) : details) ||
          errorData.error ||
          `Failed to modify domains: ${response.status}`;

        const domainSpecificError: Record<string, string> = {};
        for (const d of normalizedPayload.domainsToCreate ?? []) {
          domainSpecificError[normalizeFqdn(d.fqdn)] = errorMessage;
        }
        for (const d of normalizedPayload.domainsToDelete ?? []) {
          domainSpecificError[normalizeFqdn(d.fqdn)] = errorMessage;
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
          ...(effectiveNestedCode && { nestedCode: effectiveNestedCode }),
          ...(conflictingProduct && { conflictingProduct }),
          ...(tldValue && { tldValue }),
          ...(conflictDetails && { conflictDetails }),
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

      // Push domain state to agent so context reflects the change
      void (async () => {
        try {
          const site = useSiteStore.getState().getSite(variables.siteId);
          if (!site?.agent_url) return;

          const existingDomains = (site.domains ?? [])
            .filter(d => d.domainType !== DomainType.PREFIX)
            .map(d => ({
              fqdn: d.fqdn,
              isPrimary: d.isPrimary,
              status: d.status,
            }));
          const newDomains = (variables.payload.domainsToCreate ?? []).map(d => ({
            fqdn: d.fqdn.trim().toLowerCase(),
            isPrimary: d.primary ?? false,
            status: 'provisioning',
          }));
          const deletedFqdns = new Set(
            (variables.payload.domainsToDelete ?? []).map(d => d.fqdn.trim().toLowerCase())
          );
          const newFqdns = new Set(newDomains.map(d => d.fqdn));
          const mergedDomains = [
            ...existingDomains.filter(d => !deletedFqdns.has(d.fqdn.toLowerCase()) && !newFqdns.has(d.fqdn.toLowerCase())),
            ...newDomains,
          ];

          await agentFetch(`${site.agent_url}/apps/${variables.siteId}/publish-state`, {
            siteId: variables.siteId,
            method: 'POST',
            body: JSON.stringify({
              domains: mergedDomains,
            }),
          });
        } catch (err) {
          logger.warn('domain-operations.modify.publish-state-push.failed', {
            appId: variables.siteId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
  });
}
