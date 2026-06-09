import type { AppDetailsResponse, AppDomain } from '@/hooks/useAppDetails';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import type { DomainJobInProgress } from '@/stores/useDevelopPageStore';
import { normalizeFqdn } from '@/utils/domain';

type CustomerDomainEntry = {
  customerDomain: { domain?: string; name?: string };
  connectedDomains: AppDomain[];
};

export function isDomainJobStillInProgress(
  job: DomainJobInProgress | undefined,
  appDetails: AppDetailsResponse | undefined,
  isMutationPending: boolean,
  requiresManualDnsSetup: boolean,
  pendingCustomerDomainForAttach: { fqdn: string } | null | undefined,
): boolean {
  if (!job) {
    return false;
  }
  if (isMutationPending) {
    return true;
  }

  const jobFqdn = job.fqdn.trim().toLowerCase();
  const hasPendingAppDomain = appDetails?.domains?.some(
    (d) =>
      d.domainType !== 'prefix' &&
      d.fqdn?.trim().toLowerCase() === jobFqdn &&
      (d.status === DomainStatus.PENDING ||
        d.status === DomainStatus.DELETING ||
        d.status == null),
  );
  if (hasPendingAppDomain) {
    return true;
  }

  if (
    requiresManualDnsSetup &&
    pendingCustomerDomainForAttach?.fqdn?.trim().toLowerCase() === jobFqdn
  ) {
    return true;
  }

  return false;
}

export function countDomainListRows(
  connectedCustomerDomains: CustomerDomainEntry[],
  connectedCustomDomains: AppDomain[],
  availableCustomDomains: AppDomain[],
  availableCustomerDomains: CustomerDomainEntry[],
): number {
  let count = 0;
  for (const entry of connectedCustomerDomains) {
    const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';
    count += 1;
    count += entry.connectedDomains.filter(
      (d) => normalizeFqdn(d.fqdn) !== normalizeFqdn(domainName),
    ).length;
  }
  return count
    + connectedCustomDomains.length
    + availableCustomDomains.length
    + availableCustomerDomains.length;
}
