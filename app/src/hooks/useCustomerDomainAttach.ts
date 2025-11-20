import { useEffect, useMemo, useRef } from 'react';
import { useDomainAttach } from './useDomainAttach';
import { useAppDetails, AppDomain } from './useAppDetails';
import { DomainStatus, CdnStatus } from '@/lib/mgmt-airo/types';
import { isCustomerDomain } from '@/utils/domain';
import { logger } from '@/lib/request-context';
import { Domain } from '@/hooks/useDomainsQuery';

/**
 * Custom hook to manage customer domain attachment flow
 *
 * Handles the automatic DNS configuration for GoDaddy-owned domains:
 * 1. Waits for anycastIp to be assigned (polling handled by parent component)
 * 2. Calls attach API to configure DNS
 * 3. Cleans up tracking when domain becomes fully active (status='active' AND cdnStatus=3)
 *
 *
 * @param appId - Application ID
 * @param customerDomains - List of customer-owned domains
 * @param customerId - Customer ID for authentication
 * @returns Object with pending domain info and polling state
 */
export function useCustomerDomainAttach(
  appId: string | null,
  customerDomains: Domain[],
  customerId: string | undefined
) {
  const attachMutation = useDomainAttach();
  const hasCalledAttachRef = useRef<Set<string>>(new Set());

  /**
   * Find customer domain that is pending activation
   *
   * Returns the first customer domain that hasn't reached fully active state.
   */
  function findPendingCustomerDomain(domains: AppDomain[] | undefined): AppDomain | null {
    if (!domains) return null;

    return domains.find((d) => {
      // Only check customer domains
      if (!isCustomerDomain(d.fqdn, customerDomains)) return false;

      // Check if domain is not yet fully active
      const isFullyActive = d.status === DomainStatus.ACTIVE && d.cdnStatus === CdnStatus.ACTIVE;
      return !isFullyActive;
    }) || null;
  }

  const {
    data: appDetails,
    isLoading,
  } = useAppDetails(appId, {
    enabled: !!appId,
    includeCdn: true,
  });

  /**
   * Get the currently pending customer domain
   */
  const pendingCustomerDomain = useMemo(
    () => findPendingCustomerDomain(appDetails?.domains),
    [appDetails?.domains, customerDomains] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * Check if domain is ready for attach API call
   */
  const isReadyForAttach = useMemo(() => {
    if (!pendingCustomerDomain || !customerId) return false;
    if (!pendingCustomerDomain.anycastIp) return false;
    if (attachMutation.isPending) return false;

    // Check if we've already called attach for this domain
    return !hasCalledAttachRef.current.has(pendingCustomerDomain.fqdn);
  }, [pendingCustomerDomain, customerId, attachMutation.isPending]);

  /**
   * Call attach API when domain is ready
   */
  useEffect(() => {
    if (!isReadyForAttach || !pendingCustomerDomain) return;

    const domainName = pendingCustomerDomain.fqdn;
    const anycastIp = pendingCustomerDomain.anycastIp!;

    logger.info('domain-attach.anycast-ip.received', {
      message: 'Anycast IP received for customer domain, calling attach API',
      domainName,
      anycastIp,
      status: pendingCustomerDomain.status,
      cdnStatus: pendingCustomerDomain.cdnStatus,
    });

    // Mark as called to prevent duplicate calls
    hasCalledAttachRef.current.add(domainName);

    attachMutation.mutate(
      { domainName, ip: anycastIp },
      {
        onError: () => {
          // Remove from set on error to allow retry
          hasCalledAttachRef.current.delete(domainName);
        },
      }
    );
  }, [isReadyForAttach, pendingCustomerDomain, attachMutation]);

  /**
   * when domain becomes fully active clean up tracking
   */
  useEffect(() => {
    if (!pendingCustomerDomain) return;

    const isFullyActive =
      pendingCustomerDomain.status === DomainStatus.ACTIVE &&
      pendingCustomerDomain.cdnStatus === CdnStatus.ACTIVE;

    if (isFullyActive) {
      logger.info('domain-attach.fully-active', {
        message: 'Customer domain is fully active',
        domainName: pendingCustomerDomain.fqdn,
        status: pendingCustomerDomain.status,
        cdnStatus: pendingCustomerDomain.cdnStatus,
      });

      hasCalledAttachRef.current.delete(pendingCustomerDomain.fqdn);
    }
  }, [pendingCustomerDomain]);

  return {
    pendingCustomerDomain,
    isPolling: !!pendingCustomerDomain,
    isAttaching: attachMutation.isPending,
    isLoading,
  };
}

