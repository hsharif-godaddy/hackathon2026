import type { AppDomain } from '@/hooks/useAppDetails';
import { type DomainToDelete } from '@/hooks/useModifyDomains';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { normalizeFqdn } from '@/utils/domain';

/**
 * When switching connected domain via radio + Connect, detach other ACTIVE
 * domains in one modifyDomains call. PENDING domains are excluded — they may
 * still be provisioning and must not be auto-deleted on switch.
 */
export function domainsToDeleteForSwitch(
  domains: AppDomain[] | undefined,
  targetFqdn: string,
  enabled: boolean,
): DomainToDelete[] {
  if (!enabled || !domains) {
    return [];
  }

  const normalizedTarget = normalizeFqdn(targetFqdn);
  return domains
    .filter(
      (d) =>
        d.domainType !== 'prefix' &&
        d.status === DomainStatus.ACTIVE &&
        normalizeFqdn(d.fqdn) !== normalizedTarget,
    )
    .map((d) => ({ fqdn: d.fqdn }));
}
