import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCustomerDomainAttach } from './useCustomerDomainAttach';

vi.mock('./useDomainAttach', () => ({
  useDomainAttach: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
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
  });

  it('should return initial state with no pending domain', () => {
    const { result } = renderHook(() =>
      useCustomerDomainAttach(undefined, [])
    );

    expect(result.current.pendingCustomerDomain).toBeNull();
    expect(result.current.isPolling).toBe(false);
    expect(result.current.isAttaching).toBe(false);
  });

  it('should identify pending customer domain', () => {
    const appDetails = {
      domains: [
        {
          fqdn: 'customer.com',
          isPrimary: true,
          status: 'pending',
          anycastIp: '192.168.1.1',
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
});
