/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdSenseSettings, AdSenseSettingsInput } from '@airo/shared/adsense';
import { QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';

import { useAdSenseSettingsForm } from '@/app/[market]/develop/components/settings/DisplayAds/useAdSenseSettingsForm';
import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { renderHookWithProviders } from '@/tests/test-utils';
import { useAdSenseSettings } from './useAdSenseSettings';

vi.mock('@/config/dynamic-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/dynamic-api')>();
  return {
    ...actual,
    buildDynamicApiUrl: vi.fn(),
  };
});

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}));

const appId = 'app-123';
const apiUrl = 'https://agent.example/apps/app-123/adsense';
const canonicalSnippet = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>';

const emptySettings: AdSenseSettings = {
  enabled: false,
  publisherId: null,
  scriptSnippet: '',
  adsTxt: { enabled: false, content: '' },
  appAdsTxt: { enabled: false, content: '' },
  updatedAt: null,
};

const savedSettings: AdSenseSettings = {
  enabled: true,
  publisherId: 'ca-pub-1234567890123456',
  scriptSnippet: canonicalSnippet,
  adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
  appAdsTxt: { enabled: false, content: 'draft app ads' },
  updatedAt: '2026-06-04T12:00:00.000Z',
};

function response(json: unknown, init: Partial<Response> = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as Response;
}

describe('useAdSenseSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildDynamicApiUrl).mockResolvedValue(apiUrl);
  });

  it('loads direct AdSenseSettings JSON through the agents API', async () => {
    vi.mocked(agentFetch).mockResolvedValue(response(savedSettings));

    const { result } = renderHookWithProviders(() => useAdSenseSettings(appId));

    await waitFor(() => {
      expect(result.current.settings).toEqual(savedSettings);
    });

    expect(buildDynamicApiUrl).toHaveBeenCalledWith('adsense', appId);
    expect(agentFetch).toHaveBeenCalledWith(apiUrl, {
      siteId: appId,
      method: 'GET',
    });
    expect(result.current.settings?.publisherId).toBe('ca-pub-1234567890123456');
    expect((result.current.settings as any).settings).toBeUndefined();
  });

  it('saves direct AdSenseSettings JSON with PUT and invalidates the app query', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(agentFetch)
      .mockResolvedValueOnce(response(emptySettings))
      .mockResolvedValueOnce(response(savedSettings));

    const { result } = renderHookWithProviders(() => useAdSenseSettings(appId), { queryClient });

    await waitFor(() => {
      expect(result.current.settings).toEqual(emptySettings);
    });

    const input: AdSenseSettingsInput = {
      enabled: true,
      scriptSnippet: canonicalSnippet,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: 'draft app ads' },
    };

    let mutationResult: AdSenseSettings | undefined;
    await act(async () => {
      mutationResult = await result.current.saveSettings(input);
    });

    expect(mutationResult).toEqual(savedSettings);
    expect(agentFetch).toHaveBeenCalledWith(apiUrl, {
      siteId: appId,
      method: 'PUT',
      body: JSON.stringify(input),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['adsense-settings', appId] });
  });
});

describe('useAdSenseSettingsForm', () => {
  it('tracks dirty state from the current baseline', () => {
    const { result } = renderHookWithProviders(() => useAdSenseSettingsForm(emptySettings));

    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.updateEnabled(true);
      result.current.updateScriptSnippet(canonicalSnippet);
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.toInput()).toEqual({
      enabled: true,
      scriptSnippet: canonicalSnippet,
      adsTxt: { enabled: false, content: '' },
      appAdsTxt: { enabled: false, content: '' },
    });
  });

  it('preserves disabled text file content in form state and save input', () => {
    const initial: AdSenseSettings = {
      ...emptySettings,
      enabled: true,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
    };

    const { result } = renderHookWithProviders(() => useAdSenseSettingsForm(initial));

    act(() => {
      result.current.updateTextFileEnabled('adsTxt', false);
    });

    expect(result.current.values.adsTxt).toEqual({
      enabled: false,
      content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0',
    });
    expect(result.current.toInput().adsTxt).toEqual({
      enabled: false,
      content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0',
    });
  });

  it('preserves configured values when global Display Ads are disabled', () => {
    const initial: AdSenseSettings = {
      ...savedSettings,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    };

    const { result } = renderHookWithProviders(() => useAdSenseSettingsForm(initial));

    act(() => {
      result.current.updateEnabled(false);
    });

    expect(result.current.values).toEqual({
      enabled: false,
      scriptSnippet: canonicalSnippet,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    });
    expect(result.current.toInput()).toEqual({
      enabled: false,
      scriptSnippet: canonicalSnippet,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    });
  });

  it('maps server field errors to controls and clears each field error on edit', () => {
    const { result } = renderHookWithProviders(() => useAdSenseSettingsForm(emptySettings));

    act(() => {
      result.current.setServerErrors({
        scriptSnippet: 'AdSense script must load from pagead2.googlesyndication.com.',
        adsTxt: 'ads.txt content is required when enabled.',
      });
    });

    expect(result.current.fieldErrors.scriptSnippet).toBe('AdSense script must load from pagead2.googlesyndication.com.');
    expect(result.current.fieldErrors.adsTxt).toBe('ads.txt content is required when enabled.');

    act(() => {
      result.current.updateScriptSnippet(canonicalSnippet);
    });

    expect(result.current.fieldErrors.scriptSnippet).toBeUndefined();
    expect(result.current.fieldErrors.adsTxt).toBe('ads.txt content is required when enabled.');

    act(() => {
      result.current.updateTextFileContent('adsTxt', 'google.com, pub-123, DIRECT, f08c47fec0942fa0');
    });

    expect(result.current.fieldErrors.adsTxt).toBeUndefined();
  });
});
