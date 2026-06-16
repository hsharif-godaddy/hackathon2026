// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockAppFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/gasket-config', () => ({ appFetch: mockAppFetch }));

import { useDkimAutoOnboard } from '../useDkimAutoOnboard';

const internalOwnership = { isGoDaddyDns: true } as any;
const externalOwnership = { isGoDaddyDns: false } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockAppFetch.mockResolvedValue({ ok: true });
});

describe('useDkimAutoOnboard', () => {
  it('POSTs onboard when enabled and isGoDaddyDns is true', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', ownership: internalOwnership, enabled: true }));
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/apps/aaaaaaaaaa/dkim/onboard',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ domain: 'acme.com' }) }),
    );
  });

  it('does NOT POST when DNS is not GoDaddy (external)', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', ownership: externalOwnership, enabled: true }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does NOT POST when disabled', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', ownership: internalOwnership, enabled: false }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('fires once per mount and swallows fetch errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAppFetch.mockRejectedValue(new Error('network'));
    const { rerender } = renderHook(
      (props) => useDkimAutoOnboard(props),
      { initialProps: { appId: 'aaaaaaaaaa', domain: 'acme.com', ownership: internalOwnership, enabled: true } },
    );
    rerender({ appId: 'aaaaaaaaaa', domain: 'acme.com', ownership: internalOwnership, enabled: true });
    await act(async () => { await Promise.resolve(); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('dkim.auto-onboard.failed', expect.objectContaining({ domain: 'acme.com' }));
    warnSpy.mockRestore();
  });

  it('does NOT POST when ownership is null', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', ownership: null, enabled: true }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('warns when the onboard response is not ok', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAppFetch.mockResolvedValue({ ok: false, status: 500 });
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', ownership: internalOwnership, enabled: true }));
    await act(async () => { await Promise.resolve(); });
    expect(warnSpy).toHaveBeenCalledWith('dkim.auto-onboard.failed', expect.objectContaining({ status: 500 }));
    warnSpy.mockRestore();
  });
});
