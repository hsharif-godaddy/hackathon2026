import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

interface DnsConflictCheckResult {
  hasProductDNSConflict: boolean;
  currentIps: string[] | null;
  failedOpen: boolean;
}

/**
 * On page load, checks whether a connected ACTIVE domain's DNS still resolves
 * to this app by comparing the live-resolved IPs against the app's anycast IP.
 *
 * Falls back to hasProductDNSConflict when anycastIp is unavailable.
 * Returns hasDnsDrift: false when the lookup itself fails (failedOpen) to
 * avoid false alarms.
 *
 * Result is cached for the lifetime of the page visit (staleTime: Infinity).
 */
export function useDomainConflictCheck(
  appId: string | null | undefined,
  fqdn: string | null | undefined,
  anycastIp: string | null | undefined,
  enabled: boolean,
): { hasDnsDrift: boolean } {
  const { data } = useQuery<DnsConflictCheckResult | null>({
    queryKey: ['domain-conflict-check', appId, fqdn],
    queryFn: async (): Promise<DnsConflictCheckResult | null> => {
      const response = await appFetch(
        `/api/apps/${appId}/dns-check-conflict?fqdn=${encodeURIComponent(fqdn!)}`,
      );
      if (!response.ok) {
        logger.warn('domain.conflict-check.http-error', {
          appId,
          fqdn,
          status: response.status,
        });
        return null;
      }
      return response.json();
    },
    enabled: enabled && !!appId && !!fqdn,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  if (!data || data.failedOpen) {
    return { hasDnsDrift: false };
  }

  if (anycastIp && Array.isArray(data.currentIps)) {
    return { hasDnsDrift: !data.currentIps.includes(anycastIp) };
  }

  return { hasDnsDrift: data.hasProductDNSConflict };
}
