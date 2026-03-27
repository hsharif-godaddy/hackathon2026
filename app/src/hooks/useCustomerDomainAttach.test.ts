import { describe, expect, it } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';

import { useCustomerDomainAttach } from './useCustomerDomainAttach';

describe('useCustomerDomainAttach', () => {

  it('should return initial state with no pending domain', () => {
    const { result } = renderHook(() =>
      useCustomerDomainAttach(undefined, [])
    );

    expect(result.current.pendingCustomerDomain).toBeNull();
    expect(result.current.isPolling).toBe(false);
    expect(result.current.hasExternalNameservers).toBe(false);
    expect(result.current.requiresManualDnsSetup).toBe(false);
  });

  it('should identify pending customer domain', () => {
    const appDetails = {
      domains: [
        {
          fqdn: 'customer.com',
          isPrimary: true,
          status: 'pending',
          anycastIp: '192.168.1.1',
          certificateValidationCname: 'dcv.customer.com',
        },
      ],
    };

    const customerDomains = [{ domain: 'customer.com' }];

    const { result } = renderHook(() =>
      useCustomerDomainAttach(appDetails as any, customerDomains as any)
    );

    expect(result.current.pendingCustomerDomain).toBeDefined();
    expect(result.current.isPolling).toBe(true);
  });

  it('should not return fully active domains as pending', () => {
    const appDetails = {
      domains: [
        {
          fqdn: 'customer.com',
          isPrimary: true,
          status: 'active',
          cdnStatus: 3,
        },
      ],
    };

    const customerDomains = [{ domain: 'customer.com' }];

    const { result } = renderHook(() =>
      useCustomerDomainAttach(appDetails as any, customerDomains as any)
    );

    expect(result.current.pendingCustomerDomain).toBeNull();
  });

  describe('external nameserver detection', () => {
    it('should detect external nameservers using hasInternalNameservers flag', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          hasInternalNameservers: false,
          nameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      expect(result.current.hasExternalNameservers).toBe(true);
      expect(result.current.requiresManualDnsSetup).toBe(true);
    });

    it('should detect GoDaddy nameservers as internal', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          hasInternalNameservers: true,
          nameservers: ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'],
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      expect(result.current.hasExternalNameservers).toBe(false);
      expect(result.current.requiresManualDnsSetup).toBe(false);
    });

    it('should detect external nameservers for subdomain using root domain data', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'blog.customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          hasInternalNameservers: false,
          nameservers: ['ns1.cloudflare.com'],
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      expect(result.current.hasExternalNameservers).toBe(true);
      expect(result.current.requiresManualDnsSetup).toBe(true);
    });

    it('should fallback to nameserver pattern when flag is undefined', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          nameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
          // hasInternalNameservers is undefined
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      expect(result.current.hasExternalNameservers).toBe(true);
      expect(result.current.requiresManualDnsSetup).toBe(true);
    });

    it('should use domaincontrol pattern fallback when flag is undefined', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          nameservers: ['pdns13.domaincontrol.com', 'pdns14.domaincontrol.com'],
          // hasInternalNameservers is undefined
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      expect(result.current.hasExternalNameservers).toBe(false);
    });
  });

  describe('requiresManualDnsSetup flag', () => {
    it('should be true when domain has external nameservers', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          hasInternalNameservers: false,
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      expect(result.current.requiresManualDnsSetup).toBe(true);
    });

    it('should be false when domain has GoDaddy nameservers (control plane handles DNS)', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          hasInternalNameservers: true,
          nameservers: ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'],
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      expect(result.current.requiresManualDnsSetup).toBe(false);
    });
  });

  describe('flag and nameserver mismatch', () => {
    it('should detect external when flag is true but nameservers are external', () => {
      const appDetails = {
        domains: [
          {
            fqdn: 'customer.com',
            status: 'pending',
            anycastIp: '192.168.1.1',
          },
        ],
      };

      const customerDomains = [
        {
          domain: 'customer.com',
          hasInternalNameservers: true, // Flag says internal
          nameservers: ['ns1.cloudflare.com'], // But nameservers are external
        },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      // Should be detected as external due to belt-and-suspenders approach
      expect(result.current.hasExternalNameservers).toBe(true);
      expect(result.current.requiresManualDnsSetup).toBe(true);
    });
  });

});
