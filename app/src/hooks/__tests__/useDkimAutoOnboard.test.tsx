// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { mockAppFetch } = vi.hoisted(() => ({
  mockAppFetch: vi.fn(),
}));
vi.mock('@/lib/gasket-config', () => ({ appFetch: mockAppFetch }));

import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';
import { useDkimAutoOnboard } from '../useDkimAutoOnboard';

const internalOwnership: AiroDomainDnsOwnershipResponse = {
  isGdDomain: true,
  isGDDomainOwner: true,
  isGoDaddyDns: true,
  pendingNsPropagation: false,
  domainCreatedAt: null,
  zoneMatchedAt: null,
  nameserverType: 'GODADDY',
  nameservers: [],
  dnsApiResponseCode: null,
  domainsApiResponseCode: null,
};
const externalOwnership: AiroDomainDnsOwnershipResponse = { ...internalOwnership, isGoDaddyDns: false };

describe('useDkimAutoOnboard', () => {
  beforeEach(() => {
    mockAppFetch.mockReset();
    mockAppFetch.mockResolvedValue(new Response(JSON.stringify({ result: 'activated' }), { status: 200 }));
  });

  it('does not fire when enabled is false', () => {
    renderHook(() =>
      useDkimAutoOnboard({ appId: 'app-1', domain: 'example.com', ownership: internalOwnership, enabled: false })
    );
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does not fire when ownership is null', () => {
    renderHook(() =>
      useDkimAutoOnboard({ appId: 'app-1', domain: 'example.com', ownership: null, enabled: true })
    );
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does not fire when isGoDaddyDns is false', () => {
    renderHook(() =>
      useDkimAutoOnboard({ appId: 'app-1', domain: 'example.com', ownership: externalOwnership, enabled: true })
    );
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('fires POST /api/apps/[id]/dkim/onboard when isGoDaddyDns is true', async () => {
    renderHook(() =>
      useDkimAutoOnboard({ appId: 'app-1', domain: 'example.com', ownership: internalOwnership, enabled: true })
    );
    await act(async () => {});
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/apps/app-1/dkim/onboard',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fires only once across re-renders with same input', async () => {
    const { rerender } = renderHook(
      (props) => useDkimAutoOnboard(props),
      { initialProps: { appId: 'app-1', domain: 'example.com', ownership: internalOwnership, enabled: true } }
    );
    await act(async () => {});
    rerender({ appId: 'app-1', domain: 'example.com', ownership: internalOwnership, enabled: true });
    await act(async () => {});
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
  });

  it('swallows fetch errors silently without throwing', async () => {
    mockAppFetch.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() =>
      useDkimAutoOnboard({ appId: 'app-1', domain: 'example.com', ownership: internalOwnership, enabled: true })
    );
    await act(async () => {});
    // Hook should not throw; result is undefined (void hook)
    expect(result.current).toBeUndefined();
  });
});
