/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdSenseSettings, AdSenseSettingsInput } from '@airo/shared/adsense';
import { act, screen, waitFor } from '@testing-library/react';
import Growl from '@ux/growl';

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

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => {
      ['initial', 'animate', 'exit', 'transition', 'className', 'style', 'custom'].forEach((key) => delete rest[key]);
      return <div {...rest}>{children}</div>;
    },
  },
  useReducedMotion: () => false,
}));

vi.mock('@ux/toggle-button', () => ({
  default: ({
    active,
    disabled,
    onClick,
    ...rest
  }: {
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    />
  ),
}));

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

function getAdSenseToggle() {
  return screen.getByRole('switch', { name: 'Enable Google AdSense' });
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

  it('renders a compact empty form until Google AdSense is enabled', () => {
    renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByRole('heading', { name: 'Google AdSense' })).toBeInTheDocument();
    expect(getAdSenseToggle()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText('AdSense script snippet')).not.toBeInTheDocument();
    expect(screen.queryByText('Need an AdSense account?')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Enable ads.txt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Enable app-ads.txt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByText('To see changes live, publish now.')).not.toBeInTheDocument();
  });

  it('hides the Google AdSense setup link after a script snippet is configured', () => {
    mockHook({ settings: populatedSettings });

    renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.queryByText('Need an AdSense account?')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Get started with Google AdSense/ })).not.toBeInTheDocument();
  });

  it('reveals script, text-file, and save sections when Google AdSense is enabled', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());

    expect(screen.getByLabelText('AdSense script snippet')).toBeInTheDocument();
    expect(screen.getByText('Need an AdSense account?')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable ads.txt' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable app-ads.txt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('saves a valid snippet and text-file settings', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());
    await user.type(screen.getByLabelText('AdSense script snippet'), canonicalSnippet);
    await user.click(screen.getByRole('switch', { name: 'Enable ads.txt' }));
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

    await user.click(getAdSenseToggle());
    await user.type(screen.getByLabelText('AdSense script snippet'), '<script src="https://example.com/ads.js"></script>');
    await user.click(screen.getByRole('switch', { name: 'Enable ads.txt' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('AdSense script must load from pagead2.googlesyndication.com.')).toBeInTheDocument();
    expect(screen.getByText('ads.txt content is required when enabled.')).toBeInTheDocument();
    expect(screen.getByText("Couldn't save. Check the highlighted fields.")).toBeInTheDocument();
    expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        children: 'AdSense script must load from pagead2.googlesyndication.com.',
        emphasis: 'critical',
      }),
    );
  });

  it('hides text-file textareas until their toggle is enabled', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());

    expect(screen.queryByRole('heading', { name: 'ads.txt' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ads.txt content')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('app-ads.txt content')).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Enable ads.txt' }));

    expect(screen.getByRole('heading', { name: 'ads.txt' })).toBeInTheDocument();
    expect(screen.getByLabelText('ads.txt content')).toBeInTheDocument();
    expect(screen.queryByLabelText('app-ads.txt content')).not.toBeInTheDocument();
  });

  it('keeps disabled text section content in the save payload', async () => {
    mockHook({ settings: populatedSettings });

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(screen.getByRole('switch', { name: 'Enable ads.txt' }));

    expect(screen.queryByLabelText('ads.txt content')).not.toBeInTheDocument();

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

  it('hides text-file sections when Google AdSense is disabled while preserving values', async () => {
    mockHook({ settings: populatedSettings });

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByRole('switch', { name: 'Enable ads.txt' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('ads.txt content')).toHaveValue('google.com, pub-123, DIRECT, f08c47fec0942fa0');

    await user.click(getAdSenseToggle());

    expect(getAdSenseToggle()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText('AdSense script snippet')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Enable ads.txt' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ads.txt content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    await user.click(getAdSenseToggle());

    expect(screen.getByRole('switch', { name: 'Enable ads.txt' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('ads.txt content')).toHaveValue('google.com, pub-123, DIRECT, f08c47fec0942fa0');

    await user.click(screen.getByRole('switch', { name: 'Enable ads.txt' }));
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

  it('shows Saved! in the Save button after disabling Google AdSense and saving', async () => {
    mockHook({ settings: populatedSettings });
    mockSaveSettings.mockResolvedValue({
      ...populatedSettings,
      enabled: false,
    });

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Saved!' })).toBeInTheDocument();
    expect(Growl.addGrowlMessage).not.toHaveBeenCalled();
  });

  it('reveals collapsed sections and growls when a field error targets hidden controls', async () => {
    mockHook({ settings: populatedSettings });
    mockSaveSettings.mockRejectedValue(
      new AdSenseSettingsError('Invalid AdSense settings', {
        adsTxt: 'ads.txt content is required when enabled.',
      }),
    );

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(screen.getByRole('switch', { name: 'Enable ads.txt' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('ads.txt content is required when enabled.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable ads.txt' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText("Couldn't save. Check the highlighted fields.")).toBeInTheDocument();
    expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        children: 'ads.txt content is required when enabled.',
        emphasis: 'critical',
      }),
    );
  });

  it('reveals hidden script section when a script field error occurs', async () => {
    mockHook({ settings: populatedSettings });
    mockSaveSettings.mockRejectedValue(
      new AdSenseSettingsError('Invalid AdSense settings', {
        scriptSnippet: 'AdSense script must load from pagead2.googlesyndication.com.',
      }),
    );

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());

    expect(screen.queryByLabelText('AdSense script snippet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByLabelText('AdSense script snippet')).toBeInTheDocument();
    expect(screen.getByText('AdSense script must load from pagead2.googlesyndication.com.')).toBeInTheDocument();
    expect(screen.getByText("Couldn't save. Check the highlighted fields.")).toBeInTheDocument();
    expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        children: 'AdSense script must load from pagead2.googlesyndication.com.',
        emphasis: 'critical',
      }),
    );
  });

  it('shows Saved! in the Save button after a fast save', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());
    await user.type(screen.getByLabelText('AdSense script snippet'), canonicalSnippet);
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).not.toBeDisabled();

    await user.click(saveButton);

    const savedButton = await screen.findByRole('button', { name: 'Saved!' });
    expect(savedButton).not.toBeDisabled();
    expect(savedButton).toHaveClass('!bg-intents-ux-feedbackSuccess-feedbackColor');
    expect(savedButton).toHaveClass('!text-intents-ux-feedbackSuccess-onFeedbackColor');
    expect(Growl.addGrowlMessage).not.toHaveBeenCalled();
  });

  it('resets the Save button after 1.5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

      await user.click(getAdSenseToggle());
      await user.type(screen.getByLabelText('AdSense script snippet'), canonicalSnippet);
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('button', { name: 'Saved!' })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows Saved! in the Save button after a slow save', async () => {
    let resolveSave!: (value: AdSenseSettings) => void;
    mockSaveSettings.mockImplementation(
      () => new Promise<AdSenseSettings>((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());
    await user.type(screen.getByLabelText('AdSense script snippet'), canonicalSnippet);
    const savePromise = user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled();
    });

    resolveSave({ ...populatedSettings, scriptSnippet: canonicalSnippet });
    await savePromise;

    expect(await screen.findByRole('button', { name: 'Saved!' })).toBeInTheDocument();
    expect(Growl.addGrowlMessage).not.toHaveBeenCalled();
  });

  it('keeps dirty local edits when settings refresh in the background', async () => {
    const refetchedSettings: AdSenseSettings = {
      ...populatedSettings,
      scriptSnippet: '<script src="https://example.com/refetched.js"></script>',
      adsTxt: { enabled: false, content: 'server refetched ads.txt' },
    };
    const { rerender, user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());
    await user.type(screen.getByLabelText('AdSense script snippet'), 'locally edited snippet');
    await user.click(screen.getByRole('switch', { name: 'Enable ads.txt' }));
    await user.type(screen.getByLabelText('ads.txt content'), 'local ads.txt draft');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    mockHook({ settings: refetchedSettings });
    rerender(<DisplayAdsPanel appId={appId} />);

    expect(screen.getByLabelText('AdSense script snippet')).toHaveValue('locally edited snippet');
    expect(getAdSenseToggle()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Enable ads.txt' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('ads.txt content')).toHaveValue('local ads.txt draft');
    expect(saveButton).not.toBeDisabled();
  });

  it('shows publish helper text under Save when AdSense is enabled', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId={appId} />);

    await user.click(getAdSenseToggle());

    expect(screen.getByText('To see changes live, publish now.')).toBeInTheDocument();
  });
});
