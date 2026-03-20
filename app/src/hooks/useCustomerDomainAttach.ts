import { useMemo } from 'react';

import { Domain } from '@/hooks/useDomainsQuery';
import { CdnStatus, DomainStatus } from '@/lib/mgmt-airo/types';
import { findCustomerDomain, hasExternalNameservers, isCustomerDomain } from '@/utils/domain';
import { AppDomain } from './useAppDetails';

/**
 * Custom hook to track customer domain attachment state
 *
 * IMPORTANT: As of AIROBUILD-1057, the control plane now handles DNS configuration
 * for GoDaddy domains. This hook NO LONGER makes DNS changes - it only tracks
 * domain state for UI purposes.
 *
 * The hook:
 * 1. Monitors app details for customer domains that are still pending
 * 2. Detects whether domains have external nameservers (requiring manual DNS setup)
 * 3. Provides state for UI to show appropriate messaging
 *
 * For GoDaddy domains with internal nameservers: Control plane handles DNS automatically
 * For domains with external nameservers: User must configure DNS manually
 *
 * @param appDetails - App details including domain list (from parent's useAppDetails)
 * @param customerDomains - List of customer-owned domains
 * @returns Object with pending domain info and DNS setup requirements
 */
export function useCustomerDomainAttach(
  appDetails: { domains?: AppDomain[] } | undefined,
  customerDomains: Domain[],
) {

  /**
   * Get the currently pending customer domain
   *
   * Finds the first customer domain that hasn't reached fully active state.
   */
  const pendingCustomerDomain = useMemo(() => {
    if (!appDetails?.domains) return null;

    return appDetails.domains.find((d) => {
      // Only check customer domains
      if (!isCustomerDomain(d.fqdn, customerDomains)) return false;

      // Check if domain is not yet fully active
      const isFullyActive = d.status === DomainStatus.ACTIVE && d.cdnStatus === CdnStatus.ACTIVE;
      return !isFullyActive;
    }) || null;
  }, [appDetails?.domains, customerDomains]);

  // Find the customer domain data (including nameservers) for the pending domain
  const pendingDomainCustomerData = useMemo(() => {
    if (!pendingCustomerDomain) return null;
    return findCustomerDomain(pendingCustomerDomain.fqdn, customerDomains);
  }, [pendingCustomerDomain, customerDomains]);

  /**
   * Check if the pending domain uses external (non-GoDaddy) nameservers
   * If true, user must configure DNS manually
   */
  const pendingDomainHasExternalNameservers = useMemo(() => {
    if (!pendingDomainCustomerData) return false;
    return hasExternalNameservers(
      pendingDomainCustomerData.hasInternalNameservers,
      pendingDomainCustomerData.nameservers
    );
  }, [pendingDomainCustomerData]);

  // Domains with external nameservers require manual DNS setup
  // GoDaddy domains with internal nameservers are handled automatically by the control plane
  const requiresManualDnsSetup = pendingDomainHasExternalNameservers;

  return {
    pendingCustomerDomain,
    isPolling: !!pendingCustomerDomain,
    hasExternalNameservers: pendingDomainHasExternalNameservers,
    requiresManualDnsSetup,
  };
}

