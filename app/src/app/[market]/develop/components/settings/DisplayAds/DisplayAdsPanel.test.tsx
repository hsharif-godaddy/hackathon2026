/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdSenseSettings, AdSenseSettingsInput } from '@airo/shared/adsense';
import { screen, waitFor } from '@testing-library/react';

import { AdSenseSettingsError, useAdSenseSettings } from '@/hooks/useAdSenseSettings';
import { renderWithProviders } from '@/tests/test-utils';
import { DisplayAdsPanel } from './DisplayAdsPanel';

vi.mock('@/hooks/useAdSenseSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAdSenseSettings')>();
  return {
    ...actual,
    useAdSenseSettings: vi.fn(),
  };
});

const appId = 'app-123';
const canonicalSnippet = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>';

const emptySettings: AdSenseSettings = {
  enabled: false,
  publisherId: null,
  scriptSnippet: '',
  adsTxt: { enabled: false, content: '' },
  appAdsTxt: { enabled: false, content: '' },
  updatedAt: null,
};

const populatedSettings: AdSenseSettings = {
  enabled: true,
  publisherId: 'ca-pub-1234567890123456',
  scriptSnippet: canonicalSnippet,
  adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
  appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
  updatedAt: '2026-06-04T12:00:00.000Z',
};

const mockSaveSettings = vi.fn<(_: AdSenseSettingsInput) => Promise<AdSenseSettings>>();
const mockRefetch = vi.fn();

function mockHook(overrides: Partial<ReturnType<typeof useAdSenseSettings>> = {}) {
  vi.mocked(useAdSenseSettings).mockReturnValue({
    settings: emptySettings,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
    saveSettings: mockSaveSettings,
    isSaving: false,
    saveError: null,
    ...overrides,
  });
}

describe('DisplayAdsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveSettings.mockResolvedValue(populatedSettings);
    mockHook();
  });

  it('shows loading state while settings are loading', () => {
    mockHook({ settings: null, isLoading: true });

    renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByText('Loading Display Ads settings')).toBeInTheDocument();
  });

  it('shows load error state with retry action', async () => {
    mockHook({ settings: null, error: new Error('load failed') });

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByText('Unable to load Display Ads settings')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(mockRefetch).toHaveBeenCalled();
  });

  it('renders an empty disabled form until Google AdSense is enabled', () => {
    renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByRole('heading', { name: 'Google AdSense' })).toBeInTheDocument();
    expect(screen.getByText('Need an AdSense account?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get started with Google AdSense/ })).toHaveAttribute(
      'href',
      'https://adsense.google.com/start/',
    );
    expect(screen.getByLabelText('Google AdSense')).not.toBeChecked();
    expect(screen.getByLabelText('AdSense script snippet')).toHaveValue('');
    expect(screen.getByLabelText('AdSense script snippet')).toBeDisabled();
    expect(screen.getByLabelText('Enable ads.txt')).not.toBeChecked();
    expect(screen.getByLabelText('Enable ads.txt')).toBeDisabled();
    expect(screen.getByLabelText('Enable app-ads.txt')).not.toBeChecked();
    expect(screen.getByLabelText('Enable app-ads.txt')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('hides the Google AdSense setup link after a script snippet is configured', () => {
    mockHook({ settings: populatedSettings });

    renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.queryByText('Need an AdSense account?')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Get started with Google AdSense/ })).not.toBeInTheDocument();
  });

  it('saves a valid snippet and text-file settings', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(screen.getByLabelText('Google AdSense'));
    await user.type(screen.getByLabelText('AdSense script snippet'), canonicalSnippet);
    await user.click(screen.getByLabelText('Enable ads.txt'));
    await user.type(screen.getByLabelText('ads.txt content'), 'google.com, pub-123, DIRECT, f08c47fec0942fa0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        enabled: true,
        scriptSnippet: canonicalSnippet,
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: false, content: '' },
      });
    });
  });

  it('maps server field errors to the corresponding controls', async () => {
    mockSaveSettings.mockRejectedValue(
      new AdSenseSettingsError('Invalid AdSense settings', {
        scriptSnippet: 'AdSense script must load from pagead2.googlesyndication.com.',
        adsTxt: 'ads.txt content is required when enabled.',
      }),
    );

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(screen.getByLabelText('Google AdSense'));
    await user.type(screen.getByLabelText('AdSense script snippet'), '<script src="https://example.com/ads.js"></script>');
    await user.click(screen.getByLabelText('Enable ads.txt'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('AdSense script must load from pagead2.googlesyndication.com.')).toBeInTheDocument();
    expect(screen.getByText('ads.txt content is required when enabled.')).toBeInTheDocument();
  });

  it('keeps disabled text section content in the save payload', async () => {
    mockHook({ settings: populatedSettings });

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(screen.getByLabelText('Enable ads.txt'));

    expect(screen.getByLabelText('ads.txt content')).toHaveValue('google.com, pub-123, DIRECT, f08c47fec0942fa0');
    expect(screen.getByLabelText('ads.txt content')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        enabled: true,
        scriptSnippet: canonicalSnippet,
        adsTxt: { enabled: false, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
      });
    });
  });

  it('disables all AdSense publishing controls while preserving values when Google AdSense is disabled', async () => {
    mockHook({ settings: populatedSettings });

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(screen.getByLabelText('Google AdSense'));

    expect(screen.getByLabelText('Google AdSense')).not.toBeChecked();
    expect(screen.getByLabelText('AdSense script snippet')).toHaveValue(canonicalSnippet);
    expect(screen.getByLabelText('AdSense script snippet')).toBeDisabled();
    expect(screen.getByLabelText('Enable ads.txt')).toBeChecked();
    expect(screen.getByLabelText('Enable ads.txt')).toBeDisabled();
    expect(screen.getByLabelText('ads.txt content')).toHaveValue('google.com, pub-123, DIRECT, f08c47fec0942fa0');
    expect(screen.getByLabelText('ads.txt content')).toBeDisabled();
    expect(screen.getByLabelText('Enable app-ads.txt')).toBeChecked();
    expect(screen.getByLabelText('Enable app-ads.txt')).toBeDisabled();
    expect(screen.getByLabelText('app-ads.txt content')).toHaveValue('app.example.com, pub-123, DIRECT');
    expect(screen.getByLabelText('app-ads.txt content')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        enabled: false,
        scriptSnippet: canonicalSnippet,
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
      });
    });
  });

  it('resets the dirty baseline after a successful save', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);
    const saveButton = screen.getByRole('button', { name: 'Save' });

    await user.click(screen.getByLabelText('Google AdSense'));
    await user.type(screen.getByLabelText('AdSense script snippet'), canonicalSnippet);
    expect(saveButton).not.toBeDisabled();

    await user.click(saveButton);

    expect(await screen.findByText('Display Ads settings saved')).toBeInTheDocument();
    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });
  });

  it('keeps dirty local edits when settings refresh in the background', async () => {
    const refetchedSettings: AdSenseSettings = {
      ...populatedSettings,
      scriptSnippet: '<script src="https://example.com/refetched.js"></script>',
      adsTxt: { enabled: false, content: 'server refetched ads.txt' },
    };
    const { rerender, user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);
    const saveButton = screen.getByRole('button', { name: 'Save' });

    await user.click(screen.getByLabelText('Google AdSense'));
    await user.type(screen.getByLabelText('AdSense script snippet'), 'locally edited snippet');
    await user.click(screen.getByLabelText('Enable ads.txt'));
    await user.type(screen.getByLabelText('ads.txt content'), 'local ads.txt draft');

    mockHook({ settings: refetchedSettings });
    rerender(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByLabelText('AdSense script snippet')).toHaveValue('locally edited snippet');
    expect(screen.getByLabelText('Google AdSense')).toBeChecked();
    expect(screen.getByLabelText('Enable ads.txt')).toBeChecked();
    expect(screen.getByLabelText('ads.txt content')).toHaveValue('local ads.txt draft');
    expect(saveButton).not.toBeDisabled();
  });

  it('explains that saved settings apply on the next publish', () => {
    renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByText('Changes apply on your next publish')).toBeInTheDocument();
  });
});
