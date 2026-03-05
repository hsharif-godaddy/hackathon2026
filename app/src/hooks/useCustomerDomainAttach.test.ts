import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useCustomerDomainAttach } from './useCustomerDomainAttach';
import { useDomainAttach } from './useDomainAttach';

vi.mock('./useDomainAttach', () => ({
  useDomainAttach: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  })),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useCustomerDomainAttach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDomainAttach).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      reset: vi.fn(),
    } as any);
  });

  it('should return initial state with no pending domain', () => {
    const { result } = renderHook(() =>
      useCustomerDomainAttach(undefined, [])
    );

    expect(result.current.pendingCustomerDomain).toBeNull();
    expect(result.current.isPolling).toBe(false);
    expect(result.current.isAttaching).toBe(false);
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

    it('should be true when attach mutation fails for current domain', () => {
      // Start with no error - mutate will be called
      const mockMutate = vi.fn();
      vi.mocked(useDomainAttach).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
        isError: false,
        reset: vi.fn(),
      } as any);

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
          nameservers: ['ns31.domaincontrol.com'],
        },
      ];

      const { result, rerender } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      // Mutate should have been called, setting lastAttemptedDomainRef
      expect(mockMutate).toHaveBeenCalled();

      // Now simulate error occurring
      vi.mocked(useDomainAttach).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
        isError: true,
        reset: vi.fn(),
      } as any);

      rerender();

      // Error should be scoped to this domain
      expect(result.current.attachFailed).toBe(true);
      expect(result.current.requiresManualDnsSetup).toBe(true);
    });

    it('should be false when domain has GoDaddy nameservers and attach not failed', () => {
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

  describe('error scoping to current domain', () => {
    it('should not show error for domain B when domain A failed', () => {
      vi.mocked(useDomainAttach).mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: true, // Error exists from previous attempt
        reset: vi.fn(),
      } as any);

      // Domain B is pending, but error is from a previous domain A attempt
      const appDetails = {
        domains: [
          {
            fqdn: 'domain-b.com',
            status: 'pending',
            anycastIp: '192.168.1.2',
          },
        ],
      };

      const customerDomains = [
        { domain: 'domain-a.com', hasInternalNameservers: true, nameservers: ['ns1.domaincontrol.com'] },
        { domain: 'domain-b.com', hasInternalNameservers: true, nameservers: ['ns1.domaincontrol.com'] },
      ];

      const { result } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      // Error should not affect domain B since lastAttemptedDomainRef doesn't match
      expect(result.current.attachFailed).toBe(false);
      expect(result.current.requiresManualDnsSetup).toBe(false);
    });

    it('should show error only for the domain that was attempted', () => {
      const mockMutate = vi.fn();
      vi.mocked(useDomainAttach).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
        isError: false,
        reset: vi.fn(),
      } as any);

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
        { domain: 'customer.com', hasInternalNameservers: true, nameservers: ['ns1.domaincontrol.com'] },
      ];

      const { result, rerender } = renderHook(() =>
        useCustomerDomainAttach(appDetails as any, customerDomains as any)
      );

      // Initially no error
      expect(result.current.attachFailed).toBe(false);

      // Simulate mutation being called and then failing
      vi.mocked(useDomainAttach).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
        isError: true,
        reset: vi.fn(),
      } as any);

      rerender();

      // Now error should show for this domain (since we attempted it)
      expect(result.current.attachFailed).toBe(true);
      expect(result.current.requiresManualDnsSetup).toBe(true);
    });
  });
});
