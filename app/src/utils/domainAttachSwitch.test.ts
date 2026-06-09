import { describe, expect, it } from 'vitest';

import type { AppDomain } from '@/hooks/useAppDetails';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { domainsToDeleteForSwitch } from './domainAttachSwitch';

describe('domainAttachSwitch', function packageTests() {
  describe('#domainsToDeleteForSwitch', function domainsToDeleteForSwitchTests() {
    const domains: AppDomain[] = [
      { fqdn: 'prefix.example.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'prefix' },
      { fqdn: 'active.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
      { fqdn: 'pending.com', isPrimary: false, status: DomainStatus.PENDING, domainType: 'custom' },
      { fqdn: 'other.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
      { fqdn: 'inactive.com', isPrimary: false, status: DomainStatus.DELETING, domainType: 'custom' },
    ];

    it('returns empty when feature is disabled', function disabled() {
      expect(domainsToDeleteForSwitch(domains, 'target.com', false)).toEqual([]);
    });

    it('returns empty when domains list is undefined', function noDomains() {
      expect(domainsToDeleteForSwitch(undefined, 'target.com', true)).toEqual([]);
    });

    it('excludes prefix, pending, and normalized target domains', function exclusions() {
      const result = domainsToDeleteForSwitch(domains, 'Active.COM', true);

      expect(result).toEqual([{ fqdn: 'other.com' }]);
    });
  });
});
