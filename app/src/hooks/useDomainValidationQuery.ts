import { useQuery } from '@tanstack/react-query';
import { appFetch } from '@/lib/gasket-config';
import { DomainMode, DomainValidationError, type DomainValidationErrorObject } from '@/lib/mgmt-airo/types';

/**
 * Domain validation response from API
 */
interface DomainValidationResponse {
  available: boolean;
  mode: DomainMode;
  projectPrefix?: string;
  fqdn?: string;
  domain?: string;
  errors?: DomainValidationErrorObject[];
}

/**
 * React Query hook for domain availability validation
 * 
 * Checks if a domain (project prefix or custom domain) is available
 * 
 * @param appId - Application ID
 * @param domain - Domain value to check
 * @param options - Query options
 * @param options.mode - Domain mode (DomainMode.PROJECT or DomainMode.CUSTOM)
 * @param options.enabled - Whether the query should run
 * @param options.subscriptionId - Optional subscription ID (speeds up validation if provided)
 * @param options.systemId - Optional system ID (speeds up validation if provided)
 * @returns Query result with availability data
 * 
 * @example
 * ```typescript
 * const { data, isLoading } = useDomainValidationQuery(
 *   appId,
 *   'my-subdomain',
 *   { 
 *     mode: DomainMode.PROJECT, 
 *     enabled: true,
 *     subscriptionId: site?.subscription_id,
 *     systemId: site?.system_id
 *   }
 * );
 * ```
 */
export function useDomainValidationQuery(
  appId: string | null,
  domain: string,
  options: {
    mode?: DomainMode;
    enabled?: boolean;
    subscriptionId?: string;
    systemId?: string;
  } = {}
) {
  const { mode = DomainMode.PROJECT, enabled = true, subscriptionId, systemId } = options;

  return useQuery<DomainValidationResponse, Error>({
    queryKey: ['domain-validation', appId, domain, mode],
    queryFn: async function validateDomain(): Promise<DomainValidationResponse> {
      const params = new URLSearchParams({
        domain: domain,
        ...(mode !== DomainMode.PROJECT && { mode }),
        ...(subscriptionId && { subscriptionId }),
        ...(systemId && { systemId })
      });

      const response = await appFetch(
        `/api/apps/${appId}/domain/check?${params.toString()}`
      );

      if (response.ok) {
        const data = await response.json();
        return data;
      }

      try {
        const errorData = await response.json();
        // If the API returned validation errors, use them
        if (errorData.errors) {
          return {
            available: false,
            mode,
            ...errorData
          };
        }

        return {
          available: false,
          mode,
          errors: [{
            code: DomainValidationError.DOMAIN_FORMAT_INVALID,
            message: errorData.error || 'Invalid domain format',
            field: mode === DomainMode.PROJECT ? 'projectPrefix' : 'fqdn',
            value: domain
          }]
        };
      } catch {
        return {
          available: false,
          mode,
          errors: [{
            code: DomainValidationError.DOMAIN_FORMAT_INVALID,
            message: 'Invalid domain format',
            field: mode === DomainMode.PROJECT ? 'projectPrefix' : 'fqdn',
            value: domain
          }]
        };
      }
    },
    enabled: enabled && !!appId && !!domain && domain.length > 0,
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}

