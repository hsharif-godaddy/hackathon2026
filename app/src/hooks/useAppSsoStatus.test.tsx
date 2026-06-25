/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAppSsoStatus } from './useAppSsoStatus';

// Mock the develop-page store with a controllable site value. The hook
// reads `state.site` for `ssoRequired` + `ssoConfigId`, so each test
// scenario sets the mocked state before rendering.
const mockSite: { ssoRequired?: boolean; ssoConfigId?: string } = {};
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: { site: typeof mockSite | null }) => unknown) => {
    return selector({ site: { ...mockSite } });
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  delete mockSite.ssoRequired;
  delete mockSite.ssoConfigId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAppSsoStatus', function useAppSsoStatusTests() {
  it('short-circuits to defaults when ssoRequired is false (non-ent)', () => {
    mockSite.ssoRequired = false;
    const { result } = renderHook(() => useAppSsoStatus('app-1'));
    expect(result.current.ssoRequired).toBe(false);
    expect(result.current.ssoConfigId).toBeNull();
    expect(result.current.ssoConfigured).toBe(false);
    expect(result.current.isLoading).toBe(false);
    // No status fetch should fire when ssoRequired is false — the hook
    // skips the network call entirely to keep non-ent flows quiet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ssoConfigured: true when /sso-config/status returns configured', async () => {
    mockSite.ssoRequired = true;
    mockSite.ssoConfigId = 'cfg-godaddy-shopper';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true }),
    });

    const { result } = renderHook(() => useAppSsoStatus('app-1'));

    expect(result.current.ssoRequired).toBe(true);
    expect(result.current.ssoConfigId).toBe('cfg-godaddy-shopper');
    await waitFor(() => {
      expect(result.current.ssoConfigured).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/apps/app-1/sso-config/status',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns ssoConfigured: false when /sso-config/status returns not configured', async () => {
    mockSite.ssoRequired = true;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    });

    const { result } = renderHook(() => useAppSsoStatus('app-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.ssoConfigured).toBe(false);
    });
  });

  it('fail-safes to ssoConfigured: false on fetch error', async () => {
    // Important defense-in-depth: if the BFF can't reach hosting (mTLS down,
    // network blip, whatever), the hook treats it as "not configured" so
    // the publish guard stays blocked. Better than falsely unlocking.
    mockSite.ssoRequired = true;
    fetchMock.mockRejectedValue(new Error('network failed'));

    const { result } = renderHook(() => useAppSsoStatus('app-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.ssoConfigured).toBe(false);
    });
  });

  it('fail-safes to ssoConfigured: false on non-2xx response', async () => {
    mockSite.ssoRequired = true;
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });

    const { result } = renderHook(() => useAppSsoStatus('app-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.ssoConfigured).toBe(false);
    });
  });

  it('does not fetch when appId is null/undefined', () => {
    mockSite.ssoRequired = true;
    const { result } = renderHook(() => useAppSsoStatus(null));
    expect(result.current.ssoConfigured).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces ssoOverrideAllowed + ssoRequiredOverride for Phase-2 toggle UI', () => {
    // Admin tier is 'optional' (capability flag true) and the customer
    // hasn't enabled the override yet (raw value null). Resolved
    // ssoRequired is therefore false. SsoPanel uses these to render the
    // checkbox in its OFF state.
    mockSite.ssoRequired = false;
    mockSite.ssoOverrideAllowed = true;
    mockSite.ssoRequiredOverride = null;
    const { result } = renderHook(() => useAppSsoStatus('app-1'));
    expect(result.current.ssoOverrideAllowed).toBe(true);
    expect(result.current.ssoRequiredOverride).toBeNull();
    expect(result.current.ssoRequired).toBe(false);
  });

  it('defaults Phase-2 fields to safe values when missing from site', () => {
    // Pre-Phase-2 site shape (or non-ent app): both fields absent should
    // collapse to false/null so SsoPanel renders the locked indicator
    // rather than the toggle. `ssoRequired: false` so no fetch fires.
    mockSite.ssoRequired = false;
    mockSite.ssoOverrideAllowed = undefined;
    mockSite.ssoRequiredOverride = undefined;
    const { result } = renderHook(() => useAppSsoStatus('app-1'));
    expect(result.current.ssoOverrideAllowed).toBe(false);
    expect(result.current.ssoRequiredOverride).toBeNull();
  });

  it('refresh() re-fetches the status (used after Save)', async () => {
    mockSite.ssoRequired = true;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ configured: false }) })
             .mockResolvedValueOnce({ ok: true, json: async () => ({ configured: true }) });

    const { result } = renderHook(() => useAppSsoStatus('app-1'));

    await waitFor(() => expect(result.current.ssoConfigured).toBe(false));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.ssoConfigured).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
