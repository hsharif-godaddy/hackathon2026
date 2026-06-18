/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

const mockAppFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/gasket-config', () => ({ appFetch: mockAppFetch }));

import { useDkimAutoOnboard } from '../useDkimAutoOnboard';

beforeEach(() => {
  vi.clearAllMocks();
  mockAppFetch.mockResolvedValue({ ok: true });
});

describe('useDkimAutoOnboard', () => {
  it('POSTs onboard when enabled with a domain', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/apps/aaaaaaaaaa/dkim/onboard',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ domain: 'acme.com' }) }),
    );
  });

  it('POSTs for external domains too (origin check is server-side)', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'external.com', enabled: true }));
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/apps/aaaaaaaaaa/dkim/onboard',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ domain: 'external.com' }) }),
    );
  });

  it('does NOT POST when disabled', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: false }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does NOT POST when appId is missing', () => {
    renderHook(() => useDkimAutoOnboard({ appId: null, domain: 'acme.com', enabled: true }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does NOT POST when domain is missing', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: null, enabled: true }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('fires once per mount and swallows fetch errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAppFetch.mockRejectedValue(new Error('network'));
    const { rerender } = renderHook(
      (props) => useDkimAutoOnboard(props),
      { initialProps: { appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true } },
    );
    rerender({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true });
    await act(async () => { await Promise.resolve(); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('dkim.auto-onboard.failed', expect.objectContaining({ domain: 'acme.com' }));
    warnSpy.mockRestore();
  });

  it('warns when the onboard response is not ok', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAppFetch.mockResolvedValue({ ok: false, status: 500 });
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));
    await act(async () => { await Promise.resolve(); });
    expect(warnSpy).toHaveBeenCalledWith('dkim.auto-onboard.failed', expect.objectContaining({ status: 500 }));
    warnSpy.mockRestore();
  });
});
