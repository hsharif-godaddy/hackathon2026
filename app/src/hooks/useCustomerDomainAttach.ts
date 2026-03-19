import { useEffect, useMemo, useRef } from 'react';

import { Domain } from '@/hooks/useDomainsQuery';
import { CdnStatus, DomainStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { findCustomerDomain, hasExternalNameservers, isCustomerDomain } from '@/utils/domain';
import { AppDomain } from './useAppDetails';
import { useDomainAttach } from './useDomainAttach';

/**
 * Custom hook to manage customer domain attachment flow
 *
 * Handles the automatic DNS configuration for GoDaddy-owned domains:
 * 1. Monitors app details for customer domains with anycastIp assigned
 * 2. Automatically calls attach API when anycastIp becomes available (once per domain)
 * 3. Cleans up tracking when domain becomes fully active (status='active' AND cdnStatus=3)
 *
 * The hook attempts the attach mutation only once per domain. The mutation itself
 * handles retries (3 attempts with exponential backoff). If the mutation fails after
 * all retries, the hook will not attempt it again.
 *
 * @param appDetails - App details including domain list (from parent's useAppDetails)
 * @param customerDomains - List of customer-owned domains
 * @param isDCVEnabled - Feature flag to enable DCV (Domain Control Validation) support
 * @returns Object with pending domain info and attach state
 */
export function useCustomerDomainAttach(
  appDetails: { domains?: AppDomain[] } | undefined,
  customerDomains: Domain[],
  isDCVEnabled?: boolean,
) {
  const attachMutation = useDomainAttach();
  const hasCalledAttachRef = useRef<Set<string>>(new Set());
  const lastAttemptedDomainRef = useRef<string | null>(null);

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
   * If true, auto-attach will be skipped and user must configure DNS manually
   */
  const pendingDomainHasExternalNameservers = useMemo(() => {
    if (!pendingDomainCustomerData) return false;
    return hasExternalNameservers(
      pendingDomainCustomerData.hasInternalNameservers,
      pendingDomainCustomerData.nameservers
    );
  }, [pendingDomainCustomerData]);

  /**
   * Check if domain is ready for attach API call
   */
  const isReadyForAttach = useMemo(() => {
    logger.info('domain-attach.ready-check', {
      message: 'Checking if domain is ready for attach',
      pendingDomainFqdn: pendingCustomerDomain?.fqdn,
      anycastIp: pendingCustomerDomain?.anycastIp,
      isAttachPending: attachMutation.isPending,
      alreadyCalled: pendingCustomerDomain ? hasCalledAttachRef.current.has(pendingCustomerDomain.fqdn) : false,
      domainStatus: pendingCustomerDomain?.status,
      cdnStatus: pendingCustomerDomain?.cdnStatus,
      hasExternalNameservers: pendingDomainHasExternalNameservers,
      hasInternalNameservers: pendingDomainCustomerData?.hasInternalNameservers,
    });

    if (!pendingCustomerDomain) return false;
    if (!pendingCustomerDomain.anycastIp) return false;
    if (isDCVEnabled && !pendingCustomerDomain.certificateValidationCname) return false;
    if (attachMutation.isPending) return false;

    // Skip auto-attach for domains with external nameservers
    if (pendingDomainHasExternalNameservers) {
      logger.info('domain-attach.skip-external-nameservers', {
        message: 'Skipping auto-attach for domain with external nameservers',
        domainFqdn: pendingCustomerDomain.fqdn,
        hasInternalNameservers: pendingDomainCustomerData?.hasInternalNameservers,
      });
      return false;
    }

    // Check if we've already called attach for this domain
    return !hasCalledAttachRef.current.has(pendingCustomerDomain.fqdn);
  }, [pendingCustomerDomain, attachMutation.isPending, isDCVEnabled, pendingDomainHasExternalNameservers, pendingDomainCustomerData]);

  /**
   * Call attach API when domain is ready
   *
   * Attempts the mutation once per domain. The mutation handles its own retries.
   * If it fails after all retries, we don't attempt again.
   */
  useEffect(() => {
    if (!isReadyForAttach || !pendingCustomerDomain) return;

    const domainName = pendingCustomerDomain.fqdn;
    const anycastIp = pendingCustomerDomain.anycastIp!;
    const dcv = isDCVEnabled && pendingCustomerDomain.certificateValidationCname
      ? pendingCustomerDomain.certificateValidationCname
      : undefined;

    // Mark as called to prevent duplicate calls
    hasCalledAttachRef.current.add(domainName);
    lastAttemptedDomainRef.current = domainName;

    logger.info('domain-attach.hook.calling-mutation', {
      message: 'Calling domain attach mutation',
      domainName,
      anycastIp,
      hasDcv: !!dcv,
      isDCVEnabled,
    });

    attachMutation.mutate(
      { domainName, ip: anycastIp, dcv },
      {
        onError: (error) => {
          // dont remove from set since it has reached a terminal failed state
          logger.error('domain-attach.hook.mutation-failed', {
            message: 'Domain attach mutation failed, will not retry from hook',
            domainName,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      }
    );
  }, [isReadyForAttach, pendingCustomerDomain, attachMutation, isDCVEnabled]);

  /**
   * when domain becomes fully active clean up tracking
   */
  useEffect(() => {
    if (!pendingCustomerDomain) return;

    const isFullyActive =
      pendingCustomerDomain.status === DomainStatus.ACTIVE &&
      pendingCustomerDomain.cdnStatus === CdnStatus.ACTIVE;

    if (isFullyActive) {
      hasCalledAttachRef.current.delete(pendingCustomerDomain.fqdn);
    }
  }, [pendingCustomerDomain]);

  // Only consider attach error relevant if it's for the current pending domain
  const attachFailedForCurrentDomain =
    attachMutation.isError &&
    lastAttemptedDomainRef.current === pendingCustomerDomain?.fqdn;

  const requiresManualDnsSetup = pendingDomainHasExternalNameservers || attachFailedForCurrentDomain;

  return {
    pendingCustomerDomain,
    isPolling: !!pendingCustomerDomain,
    isAttaching: attachMutation.isPending,
    hasExternalNameservers: pendingDomainHasExternalNameservers,
    attachFailed: attachFailedForCurrentDomain,
    requiresManualDnsSetup,
  };
}

