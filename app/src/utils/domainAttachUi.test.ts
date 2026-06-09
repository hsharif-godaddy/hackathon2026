import { describe, expect, it } from 'vitest';

import type { AppDomain } from '@/hooks/useAppDetails';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { countDomainListRows, isDomainJobStillInProgress } from './domainAttachUi';

describe('domainAttachUi', function packageTests() {
  describe('#isDomainJobStillInProgress', function isDomainJobStillInProgressTests() {
    const job = { fqdn: 'example.com', startedAt: Date.now() };

    it('returns true when mutation is pending', function mutationPending() {
      expect(isDomainJobStillInProgress(job, undefined, true, false, null)).toBe(true);
    });

    it('returns true when manual DNS setup matches pending customer domain', function manualDnsPending() {
      expect(
        isDomainJobStillInProgress(
          job,
          undefined,
          false,
          true,
          { fqdn: 'example.com' },
        ),
      ).toBe(true);
    });

    it('returns true when app domain status is null for matching fqdn', function nullStatusDomain() {
      const appDetails = {
        domains: [{
          fqdn: 'example.com',
          isPrimary: false,
          status: null,
          domainType: 'custom',
        }],
      } as any;

      expect(isDomainJobStillInProgress(job, appDetails, false, false, null)).toBe(true);
    });

    it('returns false when job is complete', function jobComplete() {
      const appDetails = {
        domains: [{
          fqdn: 'example.com',
          isPrimary: false,
          status: DomainStatus.ACTIVE,
          domainType: 'custom',
        }],
      } as any;

      expect(isDomainJobStillInProgress(job, appDetails, false, false, null)).toBe(false);
    });

    it('returns true when app domain status is pending', function pendingStatusDomain() {
      const appDetails = {
        domains: [{
          fqdn: 'example.com',
          isPrimary: false,
          status: DomainStatus.PENDING,
          domainType: 'custom',
        }],
      } as any;

      expect(isDomainJobStillInProgress(job, appDetails, false, false, null)).toBe(true);
    });

    it('returns true when app domain status is deleting', function deletingStatusDomain() {
      const appDetails = {
        domains: [{
          fqdn: 'example.com',
          isPrimary: false,
          status: DomainStatus.DELETING,
          domainType: 'custom',
        }],
      } as any;

      expect(isDomainJobStillInProgress(job, appDetails, false, false, null)).toBe(true);
    });

    it('returns false when matching domain is prefix type', function prefixDomainExcluded() {
      const appDetails = {
        domains: [{
          fqdn: 'example.com',
          isPrimary: false,
          status: DomainStatus.ACTIVE,
          domainType: 'prefix',
        }],
      } as any;

      expect(isDomainJobStillInProgress(job, appDetails, false, false, null)).toBe(false);
    });

    it('returns false when job is null', function nullJob() {
      expect(isDomainJobStillInProgress(undefined, undefined, false, false, null)).toBe(false);
    });
  });

  describe('#countDomainListRows', function countDomainListRowsTests() {
    it('counts customer root and normalized subdomain rows', function customerWithSubdomain() {
      const connectedCustomerDomains = [{
        customerDomain: { domain: 'Example.COM', name: 'Example.COM' },
        connectedDomains: [
          { fqdn: 'Example.COM', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
          { fqdn: 'shop.example.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
        ],
      }];
      const connectedCustomDomains: AppDomain[] = [];
      const availableCustomDomains: AppDomain[] = [];
      const availableCustomerDomains: typeof connectedCustomerDomains = [];

      expect(countDomainListRows(
        connectedCustomerDomains,
        connectedCustomDomains,
        availableCustomDomains,
        availableCustomerDomains,
      )).toBe(2);
    });

    it('collapses root domain rows when casing differs', function differingCaseRootDomain() {
      const connectedCustomerDomains = [{
        customerDomain: { domain: 'Example.COM', name: 'Example.COM' },
        connectedDomains: [
          { fqdn: 'example.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
        ],
      }];

      expect(countDomainListRows(connectedCustomerDomains, [], [], [])).toBe(1);
    });

    it('uses customer domain name when domain field is absent', function nameOnlyFallback() {
      const connectedCustomerDomains = [{
        customerDomain: { name: 'Display Name' },
        connectedDomains: [
          { fqdn: 'shop.display.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
        ],
      }];

      expect(countDomainListRows(connectedCustomerDomains, [], [], [])).toBe(2);
    });

    it('counts rows across all additive domain lists', function allListsPopulated() {
      const connectedCustomerDomains = [{
        customerDomain: { domain: 'example.com', name: 'example.com' },
        connectedDomains: [
          { fqdn: 'example.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
        ],
      }];
      const connectedCustomDomains = [
        { fqdn: 'connected.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
      ] as AppDomain[];
      const availableCustomDomains = [
        { fqdn: 'available.com', isPrimary: false, status: DomainStatus.ACTIVE, domainType: 'custom' },
      ] as AppDomain[];
      const availableCustomerDomains = [{
        customerDomain: { domain: 'customer.com', name: 'customer.com' },
        connectedDomains: [],
      }];

      expect(countDomainListRows(
        connectedCustomerDomains,
        connectedCustomDomains,
        availableCustomDomains,
        availableCustomerDomains,
      )).toBe(4);
    });
  });
});
