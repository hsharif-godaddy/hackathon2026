/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { postMessageToIframe } from '@/utils/postMessage';
import PreviewPane, { restoreIframeState } from './PreviewPane';
import { MobileMode, PreviewViewMode, ViewMode } from '../types';

// Mock child components
vi.mock('./PreviewCode', () => ({
  default: ({ appId }: any) => <div data-testid="preview-code">Code: {appId}</div>,
}));

vi.mock('./PreviewError', () => ({
  default: ({
    title,
    error,
    buttonText,
    buttonOnClick,
    secondaryButtonText,
    secondaryButtonOnClick,
    secondaryButtonDisabled,
  }: any) => (
    <div data-testid="preview-error">
      <h1>{title}</h1>
      <p>{error}</p>
      <button onClick={buttonOnClick}>{buttonText}</button>
      {secondaryButtonText && secondaryButtonOnClick && (
        <button
          data-testid="preview-error-secondary"
          onClick={secondaryButtonOnClick}
          disabled={secondaryButtonDisabled}
        >
          {secondaryButtonText}
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/app/[market]/develop/components/tips/Tips', () => ({
  default: ({
    buildingMessage,
    timeEstimateMinutes,
    onTimeEstimateShown,
  }: {
    buildingMessage?: string
    timeEstimateMinutes?: number | null
    onTimeEstimateShown?: () => void
  }) => {
    // Mirror the real Tips: onTimeEstimateShown fires only when the pill renders.
    if (timeEstimateMinutes != null) {
      onTimeEstimateShown?.();
    }
    return (
      <div data-testid="tips" data-time-estimate-minutes={timeEstimateMinutes ?? ''}>
        {buildingMessage ?? 'Tips'}
      </div>
    );
  },
}));

vi.mock('./brand-book', () => ({
  default: ({ appId }: any) => <div data-testid="brand-book">Brand Book: {appId}</div>,
}));

vi.mock('@/app/[market]/develop/components/settings/DomainPanel', () => ({
  default: () => <div data-testid="domain-panel">Domain Panel</div>,
}));

vi.mock('@/app/[market]/develop/components/preview/InboxIframe', () => ({
  default: ({ brandId }: { brandId: string }) => (
    <div data-testid="inbox-iframe">Inbox: {brandId}</div>
  ),
}));

// Mock stores
const mockServerPollingStore = {
  getServerState: vi.fn(function () { return { isReady: true, url: 'http://localhost:3000' }; }),
  startPollingForServer: vi.fn(),
  stopPollingForServer: vi.fn(),
  isPollingServer: vi.fn(function () { return false; }),
};

const mockDevelopPageStore = {
  previewViewMode: PreviewViewMode.DESKTOP,
  viewMode: ViewMode.PREVIEW,
  mobileMode: MobileMode.PREVIEW,
  handleMobileModeChange: vi.fn(),
  setPreviewViewMode: vi.fn(),
  publishStates: { 'test-app-123': { isPublishing: false } } as Record<string, { isPublishing: boolean }>,
  isVersionHistoryOpen: false,
  isMobileInlineEditActive: false,
  isEditModeEnabled: false,
};

const mockGitStore = {
  getSelectedCommitHash: vi.fn(function () { return null; }),
};

let mockGitHistoryData: { commits: Array<{ hash: string }> } = { commits: [] };

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: any) => selector(mockServerPollingStore),
}));

vi.mock('@/stores/useDevelopPageStore', () => {
  const store = (selector: any) => selector(mockDevelopPageStore);
  store.getState = () => mockDevelopPageStore;
  store.setState = (partial: any) =>
    Object.assign(mockDevelopPageStore, typeof partial === 'function' ? partial(mockDevelopPageStore) : partial);
  return { useDevelopPageStore: store };
});

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: (selector: any) => selector(mockGitStore),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-123',
}));

vi.mock('@/hooks/useRestoreCommitMutation', () => ({
  useRestoreCommitMutation: () => ({
    mutate: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({
    data: mockGitHistoryData,
  }),
}));

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    sendMessage: vi.fn(),
  }),
}));

const mockSwitchboardResults: Record<string, boolean> = {};
const EDITING_CHIP_FLAG = 'appbuilder-preview-enhanced-overlays';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => mockSwitchboardResults[feature] ?? false,
}));

vi.mock('next/dynamic', async () => {
  const ReactModule = await import('react');
  return {
    default: (loader: () => Promise<{ default: React.ComponentType }>) => {
      const LoadableComponent = (props: Record<string, unknown>) => {
        const [Component, setComponent] = ReactModule.useState<React.ComponentType | null>(null);
        ReactModule.useEffect(() => {
          let cancelled = false;
          loader().then((mod) => { if (!cancelled) setComponent(() => mod.default); });
          return () => { cancelled = true; };
        }, []);
        if (!Component) return null;
        return <Component {...props} />;
      };
      return LoadableComponent;
    },
  };
});

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: () => ({
    data: null,
    isError: false,
  }),
}));

vi.mock('@/utils/domain', () => ({
  isAiroSubdomain: vi.fn(function () { return false; }),
  resolveSiteFqdn: vi.fn(function () { return null; }),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(function () { return false; }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@airo-ux/loader', () => ({
  Loader: () => <div data-testid="loader">Loading...</div>,
}));

const mockUseImpression = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useImpression', () => ({
  useImpression: (...args: unknown[]) => mockUseImpression(...args),
}));

const mockUseLatestNBAs = vi.hoisted(() =>
  vi.fn(function () { return null as { source?: string; question?: string; suggestions?: unknown[] } | null; }),
);

vi.mock('@/app/[market]/develop/components/chat/useLatestNBAs', () => ({
  useLatestNBAs: () => mockUseLatestNBAs(),
}));

const mockIsInitialBuildFunnelActive = vi.hoisted(() => vi.fn(function () { return true; }));
const mockIsInitialBuildComplete = vi.hoisted(() => vi.fn(function () { return false; }));

const { mockInitialAgentCohort, mockMarkBuildEstimateShown } = vi.hoisted(() => ({
  mockInitialAgentCohort: { current: undefined as string | undefined },
  mockMarkBuildEstimateShown: vi.fn(),
}));

vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: () => ({ cohort: mockInitialAgentCohort.current, data: undefined, experiment: undefined }),
  useIsInCohort: (experimentId: string, cohortId: string) => mockInitialAgentCohort.current === cohortId,
  useExperimentCohorts: () => ({}),
}));

vi.mock('@/app/[market]/develop/hooks/useFirstBuildEstimateImpression', () => ({
  useFirstBuildEstimateImpression: () => mockMarkBuildEstimateShown,
}));

vi.mock('@/hooks/shared/initialBuildFunnel', () => ({
  isInitialBuildFunnelActive: () => mockIsInitialBuildFunnelActive(),
  isInitialBuildComplete: () => mockIsInitialBuildComplete(),
}));

describe('PreviewPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
    mockDevelopPageStore.mobileMode = MobileMode.PREVIEW;
    mockDevelopPageStore.publishStates = { 'test-app-123': { isPublishing: false } };
    mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: true, url: 'http://localhost:3000' }; });
    mockGitHistoryData = { commits: [] };
    mockGitStore.getSelectedCommitHash = vi.fn(function () { return null; });
    mockDevelopPageStore.isVersionHistoryOpen = false;
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key];
    }
    mockUseImpression.mockReset();
    mockUseLatestNBAs.mockReset();
    mockUseLatestNBAs.mockReturnValue(null);
    mockIsInitialBuildFunnelActive.mockReturnValue(true);
    mockIsInitialBuildComplete.mockReturnValue(false);
    mockInitialAgentCohort.current = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render without crashing', () => {
    const { container } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(container).toBeInTheDocument();
  });

  it('should render iframe when server is ready', async () => {
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await waitFor(() => {
      const iframe = document.querySelector('iframe');
      expect(iframe).toBeInTheDocument();
    });
  });

  it('should show code view when viewMode is CODE', () => {
    mockDevelopPageStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.getByTestId('preview-code')).toBeInTheDocument();
  });

  it('should disable code overlay pointer events in EDIT mode', () => {
    mockDevelopPageStore.viewMode = ViewMode.EDIT;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    const codeOverlay = screen.getByTestId('preview-code').parentElement;
    expect(codeOverlay).toHaveStyle({ pointerEvents: 'none' });
    expect(codeOverlay).toHaveAttribute('aria-hidden', 'true');
  });

  it('should not apply edit-mode ring on iframe wrapper', async () => {
    mockDevelopPageStore.isEditModeEnabled = true;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    const iframe = await screen.findByTestId('preview-iframe');
    expect(iframe.parentElement?.className).not.toContain('ring-ai');
  });

  it('should start polling for server on mount', () => {
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // PreviewPane manages its own server polling lifecycle
    expect(mockServerPollingStore.startPollingForServer).toHaveBeenCalledWith('test-app-123');
  });

  it('should stop polling for server on unmount', () => {
    const { unmount } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    unmount();

    expect(mockServerPollingStore.stopPollingForServer).toHaveBeenCalledWith('test-app-123');
  });

  it('should NOT start polling while isImageReloading is true', () => {
    // Regression guard for the on-demand-reload cutover bug: during the
    // 30-90s window when an old container is being torn down and a new
    // one is starting up, bootstrapping can hit the OLD container and
    // miss the cookie-setting code path. PreviewPane must NOT fire its
    // polling effect while useImageReadiness reports isImageUpdating=true
    // (passed through as isImageReloading prop).
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} isImageReloading={true} />);

    expect(mockServerPollingStore.startPollingForServer).not.toHaveBeenCalled();
  });

  it('should start polling once isImageReloading flips to false', () => {
    // After the image reload completes, isImageReloading flips false and
    // the gate releases. Polling should fire on the next render.
    const { rerender } = renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} isImageReloading={true} />
    );

    expect(mockServerPollingStore.startPollingForServer).not.toHaveBeenCalled();

    rerender(<PreviewPane onPreviewRefresh={vi.fn()} isImageReloading={false} />);

    expect(mockServerPollingStore.startPollingForServer).toHaveBeenCalledWith('test-app-123');
  });

  it('should show tips overlay and make iframe non-interactive when showBuildingOverlay is true', () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: true,
      url: 'http://localhost:3000',
      status: 'running'
    }; });

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        showBuildingOverlay={true}
      />
    );

    expect(screen.getByTestId('tips')).toBeInTheDocument();

    const iframe = screen.getByTestId('preview-iframe');
    expect(iframe).toHaveAttribute('aria-hidden', 'true');
    expect(iframe).toHaveAttribute('tabindex', '-1');
    expect(iframe).toHaveAttribute('inert');
  });

  it('should render desktop status chip with Thinking label when processing and not mutating', async () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isProcessing={true}
        isMutatingFiles={false}
        showBuildingOverlay={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-editing-chip')).toBeInTheDocument();
    });
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    expect(screen.queryByText('Editing…')).not.toBeInTheDocument();
  });

  it('should render desktop status chip with Editing label when mutating', async () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isProcessing={false}
        isMutatingFiles={true}
        showBuildingOverlay={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-editing-chip')).toBeInTheDocument();
    });
    expect(screen.getByText('Editing…')).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'processing and mutating are both false',
      setup: () => { mockSwitchboardResults[EDITING_CHIP_FLAG] = true; },
      props: { isProcessing: false, isMutatingFiles: false, showBuildingOverlay: false },
    },
    {
      name: 'building overlay is true',
      setup: () => { mockSwitchboardResults[EDITING_CHIP_FLAG] = true; },
      props: { isProcessing: true, isMutatingFiles: true, showBuildingOverlay: true },
    },
    {
      name: 'preview surface is not visible',
      setup: () => {
        mockSwitchboardResults[EDITING_CHIP_FLAG] = true;
        mockDevelopPageStore.viewMode = ViewMode.CODE;
      },
      props: { isProcessing: true, isMutatingFiles: true, showBuildingOverlay: false },
    },
  ])('should not render editing chip when $name', async ({ setup, props }) => {
    setup();
    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isProcessing={props.isProcessing}
        isMutatingFiles={props.isMutatingFiles}
        showBuildingOverlay={props.showBuildingOverlay}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('preview-editing-chip')).not.toBeInTheDocument();
    });
  });

  it('should keep desktop status chip visible on file-saved while still mutating', async () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isProcessing={true}
        isMutatingFiles={true}
        showBuildingOverlay={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-editing-chip')).toBeInTheDocument();
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'file-saved' },
      origin: window.location.origin,
      source: window,
    }));

    await waitFor(() => {
      expect(screen.getByTestId('preview-editing-chip')).toBeInTheDocument();
    });
  });

  it('should keep desktop status chip visible on preview-refresh while still mutating', async () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isProcessing={true}
        isMutatingFiles={true}
        showBuildingOverlay={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-editing-chip')).toBeInTheDocument();
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'preview-refresh' },
      origin: window.location.origin,
      source: window,
    }));

    await waitFor(() => {
      expect(screen.getByTestId('preview-editing-chip')).toBeInTheDocument();
    });
  });

  it('should set mobile preview mode when isMobile is true', () => {
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} isMobile={true} />);

    expect(mockDevelopPageStore.setPreviewViewMode).toHaveBeenCalledWith(PreviewViewMode.MOBILE);
  });

  it('should set desktop preview mode when isMobile changes from true to false', () => {
    const { rerender } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} isMobile={true} />);

    // First render should set MOBILE mode
    expect(mockDevelopPageStore.setPreviewViewMode).toHaveBeenCalledWith(PreviewViewMode.MOBILE);

    // Clear the mock to check next call
    mockDevelopPageStore.setPreviewViewMode.mockClear();

    // Simulate resize by changing isMobile prop
    rerender(<PreviewPane onPreviewRefresh={vi.fn()} isMobile={false} />);

    // Should now set DESKTOP mode
    expect(mockDevelopPageStore.setPreviewViewMode).toHaveBeenCalledWith(PreviewViewMode.DESKTOP);
  });

  it('should keep mobile Thinking label when processing and not mutating', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = false;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={true}
        isMutatingFiles={false}
        showBuildingOverlay={false}
      />
    );

    expect(screen.getByText('builder_agent_thinking')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-mobile-status-pill')).not.toBeInTheDocument();
  });

  it('should show mobile status pill with Thinking label when enhanced overlays flag is on and not mutating', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={true}
        isMutatingFiles={false}
        showBuildingOverlay={false}
      />
    );

    const mobileStatusPill = screen.getByTestId('preview-mobile-status-pill');

    expect(mobileStatusPill).toBeInTheDocument();
    expect(within(mobileStatusPill).getByText('Thinking…')).toBeInTheDocument();
  });

  it('should show mobile status pill with Editing label when enhanced overlays flag is on and mutating', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={true}
        isMutatingFiles={true}
        showBuildingOverlay={false}
      />
    );

    const mobileStatusPill = screen.getByTestId('preview-mobile-status-pill');

    expect(mobileStatusPill).toBeInTheDocument();
    expect(within(mobileStatusPill).getByText('Editing…')).toBeInTheDocument();
    expect(within(mobileStatusPill).queryByText('Thinking…')).not.toBeInTheDocument();
  });

  it('should open mobile tools when mobile status pill wrapper is clicked', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={true}
        isMutatingFiles={false}
        showBuildingOverlay={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'devtools_open' }));

    expect(mockDevelopPageStore.handleMobileModeChange).toHaveBeenCalledWith(MobileMode.TOOLS);
  });

  it('should not render desktop portal editing chip on mobile when enhanced overlays flag is on', async () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={true}
        isMutatingFiles={true}
        showBuildingOverlay={false}
      />
    );

    expect(screen.getByTestId('preview-mobile-status-pill')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId('preview-editing-chip')).not.toBeInTheDocument();
    });
  });

  it('should not show mobile status pill when not processing', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={false}
        isMutatingFiles={false}
        showBuildingOverlay={false}
      />
    );

    expect(screen.queryByTestId('preview-mobile-status-pill')).not.toBeInTheDocument();
  });

  it('should show mobile status pill with editing label when mutating without processing', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={false}
        isMutatingFiles={true}
        showBuildingOverlay={false}
      />
    );

    const mobileStatusPill = screen.getByTestId('preview-mobile-status-pill');

    expect(mobileStatusPill).toBeInTheDocument();
    expect(within(mobileStatusPill).getByText('Editing…')).toBeInTheDocument();
  });

  it('should not show mobile status pill during building overlay', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={true}
        isMutatingFiles={true}
        showBuildingOverlay={true}
      />
    );

    expect(screen.queryByTestId('preview-mobile-status-pill')).not.toBeInTheDocument();
  });

  it('should not show mobile status pill when mobile mode is not preview', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;
    mockDevelopPageStore.mobileMode = MobileMode.TOOLS;

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        isMobile={true}
        isProcessing={true}
        isMutatingFiles={true}
        showBuildingOverlay={false}
      />
    );

    expect(screen.queryByTestId('preview-mobile-status-pill')).not.toBeInTheDocument();
  });

  it('should show cookie-blocked overlay when cookieVerified is false', () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: 'http://localhost:3000',
      healthCheckPassed: true,
      cookieVerified: false,
    }; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    const overlay = screen.getByTestId('preview-cookie-blocked');
    expect(overlay).toBeInTheDocument();

    // Retry button present
    expect(screen.getByText('builder_common_try_again')).toBeInTheDocument();

    // Open-in-new-tab link with correct href (defaultMessage used since messages={})
    const link = screen.getByText('Open preview in new tab');
    expect(link).toHaveAttribute('href', 'http://localhost:3000');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('should not show cookie-blocked overlay when cookieVerified is undefined', () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: 'http://localhost:3000',
      healthCheckPassed: true,
      cookieVerified: undefined,
    }; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByTestId('preview-cookie-blocked')).not.toBeInTheDocument();
  });

  it('should show error when iframe fails to load', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null, error: 'Server failed' }; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await waitFor(() => {
      // The component may show an error or loading state
      expect(mockServerPollingStore.getServerState).toHaveBeenCalled();
    });
  });

  it('should render BrandBookView as overlay when viewMode is BRAND and server is ready', () => {
    mockDevelopPageStore.viewMode = ViewMode.BRAND;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.getByTestId('brand-book')).toBeInTheDocument();
    expect(screen.getByTestId('preview-iframe')).toBeInTheDocument();
    expect(screen.getByTestId('preview-code')).toBeInTheDocument();
  });

  it('should render BrandBookView alone when viewMode is BRAND and server is NOT ready', () => {
    mockDevelopPageStore.viewMode = ViewMode.BRAND;
    mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null }; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.getByTestId('brand-book')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-code')).not.toBeInTheDocument();
  });

  it('should not render BrandBookView when viewMode is PREVIEW', () => {
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByTestId('brand-book')).not.toBeInTheDocument();
  });

  it('renders the archive gate skeleton when archiveGatePending is true', () => {
    renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} archiveGatePending={true} />
    );

    expect(screen.getByTestId('develop-preview-archive-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('tips')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument();
  });

  it('renders the archive restoring loading state when showArchiveResumeMessage is true', () => {
    renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} showArchiveResumeMessage={true} />
    );

    expect(screen.getByTestId('develop-preview-archive-restoring')).toBeInTheDocument();
    expect(screen.getByTestId('tips')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument();
  });

  it('renders archive-restore-failed and invokes onRetryArchiveRestore when provided', () => {
    const onRetryArchiveRestore = vi.fn();
    const onPreviewRefresh = vi.fn();
    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={onPreviewRefresh}
        archiveResumeFailed={true}
        onRetryArchiveRestore={onRetryArchiveRestore}
      />
    );

    expect(screen.getByTestId('develop-preview-archive-restore-failed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('builder_common_try_again'));
    expect(onRetryArchiveRestore).toHaveBeenCalledTimes(1);
    expect(onPreviewRefresh).not.toHaveBeenCalled();
  });

  it('falls back to onPreviewRefresh when archive-restore-failed retry has no onRetryArchiveRestore', () => {
    const onPreviewRefresh = vi.fn();
    renderWithProviders(
      <PreviewPane onPreviewRefresh={onPreviewRefresh} archiveResumeFailed={true} />
    );

    expect(screen.getByTestId('develop-preview-archive-restore-failed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('builder_common_try_again'));
    expect(onPreviewRefresh).toHaveBeenCalledTimes(1);
  });

  it('should render DomainPanel when viewMode is DOMAIN and top-level flag enabled', async () => {
    mockDevelopPageStore.viewMode = ViewMode.DOMAIN;
    mockSwitchboardResults['appbuilder-domain-top-level'] = true;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('domain-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument();
  });

  it('should not render DomainPanel when viewMode is DOMAIN but top-level flag disabled', () => {
    mockDevelopPageStore.viewMode = ViewMode.DOMAIN;
    mockSwitchboardResults['appbuilder-domain-top-level'] = false;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByTestId('domain-panel')).not.toBeInTheDocument();
  });

  it('should not show PreviewError when resumeFailed and viewMode is DOMAIN', async () => {
    mockDevelopPageStore.viewMode = ViewMode.DOMAIN;
    mockSwitchboardResults['appbuilder-domain-top-level'] = true;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} resumeFailed={true} />);

    expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('domain-panel')).toBeInTheDocument();
    });
  });

  it('should not show loading state when isHibernated and viewMode is DOMAIN', async () => {
    mockDevelopPageStore.viewMode = ViewMode.DOMAIN;
    mockSwitchboardResults['appbuilder-domain-top-level'] = true;
    mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null }; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} isHibernated={true} />);

    expect(screen.queryByText('builder_preview_resuming_message')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('domain-panel')).toBeInTheDocument();
    });
  });

  describe('INBOX view accessibility during preview server issues', () => {
    const mockInboxBrandId = 'test-brand-123';

    it('should render INBOX when resumeFailed and viewMode is INBOX', () => {
      mockSwitchboardResults['app-builder-inbox-button'] = true;
      mockDevelopPageStore.viewMode = ViewMode.INBOX;
      (mockDevelopPageStore as any).inboxBrandId = mockInboxBrandId;
      // resumeFailed prop causes early-return guards to trigger, but INBOX should bypass them
      mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null }; });

      renderWithProviders(
        <PreviewPane
          onPreviewRefresh={vi.fn()}
          resumeFailed={true}
        />
      );

      expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument();
      expect(screen.getByTestId('inbox-iframe')).toBeInTheDocument();
    });

    it('should render INBOX when isHibernated and viewMode is INBOX', () => {
      mockSwitchboardResults['app-builder-inbox-button'] = true;
      mockDevelopPageStore.viewMode = ViewMode.INBOX;
      (mockDevelopPageStore as any).inboxBrandId = mockInboxBrandId;
      mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null }; });

      renderWithProviders(
        <PreviewPane
          onPreviewRefresh={vi.fn()}
          isHibernated={true}
        />
      );

      expect(screen.queryByText('builder_preview_resuming_message')).not.toBeInTheDocument();
      expect(screen.getByTestId('inbox-iframe')).toBeInTheDocument();
    });

    it('should render INBOX when isResuming and viewMode is INBOX', () => {
      mockSwitchboardResults['app-builder-inbox-button'] = true;
      mockDevelopPageStore.viewMode = ViewMode.INBOX;
      (mockDevelopPageStore as any).inboxBrandId = mockInboxBrandId;
      mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null }; });

      renderWithProviders(
        <PreviewPane
          onPreviewRefresh={vi.fn()}
          isResuming={true}
        />
      );

      expect(screen.queryByText('builder_preview_resuming_message')).not.toBeInTheDocument();
      expect(screen.getByTestId('inbox-iframe')).toBeInTheDocument();
    });

    it('should render INBOX when imageReloadFailed and viewMode is INBOX', () => {
      mockSwitchboardResults['app-builder-inbox-button'] = true;
      mockDevelopPageStore.viewMode = ViewMode.INBOX;
      (mockDevelopPageStore as any).inboxBrandId = mockInboxBrandId;

      renderWithProviders(
        <PreviewPane
          onPreviewRefresh={vi.fn()}
          imageReloadFailed={true}
        />
      );

      expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument();
      expect(screen.getByTestId('inbox-iframe')).toBeInTheDocument();
    });

    it('should render INBOX when isImageReloading and viewMode is INBOX', () => {
      mockSwitchboardResults['app-builder-inbox-button'] = true;
      mockDevelopPageStore.viewMode = ViewMode.INBOX;
      (mockDevelopPageStore as any).inboxBrandId = mockInboxBrandId;

      renderWithProviders(
        <PreviewPane
          onPreviewRefresh={vi.fn()}
          isImageReloading={true}
        />
      );

      expect(screen.queryByText('builder_preview_image_reloading_message')).not.toBeInTheDocument();
      expect(screen.getByTestId('inbox-iframe')).toBeInTheDocument();
    });

    it('should show error when resumeFailed and viewMode is PREVIEW (not INBOX)', () => {
      mockDevelopPageStore.viewMode = ViewMode.PREVIEW;

      renderWithProviders(
        <PreviewPane
          onPreviewRefresh={vi.fn()}
          resumeFailed={true}
        />
      );

      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    it('should show loading when isHibernated and viewMode is PREVIEW (not INBOX)', () => {
      mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
      mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null }; });

      renderWithProviders(
        <PreviewPane
          onPreviewRefresh={vi.fn()}
          isHibernated={true}
        />
      );

      expect(screen.getByText('builder_preview_resuming_message')).toBeInTheDocument();
    });
  });

});

describe('PreviewPane — iframe bootstrap-timeout auto-remount', () => {
  // Pin the auto-recovery behaviour against future regressions. Constants
  // mirror PreviewPane.tsx: IFRAME_BOOTSTRAP_RETRY_MS=3000, MAX_IFRAME_BOOTSTRAP_RETRIES=3.
  const IFRAME_BOOTSTRAP_RETRY_MS = 3000;
  const MAX_IFRAME_BOOTSTRAP_RETRIES = 3;

  // Pull the mocked logger handle so we can assert on warn calls — that's
  // the observable signal of the timeout firing (no easy way to read
  // iframeKey state directly).
  let mockLoggerWarn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
    mockDevelopPageStore.publishStates = { 'test-app-123': { isPublishing: false } };
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: true,
      url: 'http://localhost:3000',
    }; });
    mockServerPollingStore.isPollingServer = vi.fn(function () { return false; });
    const { logger } = await import('@/lib/request-context');
    mockLoggerWarn = logger.warn as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function bootstrapTimeoutWarns() {
    return mockLoggerWarn.mock.calls.filter(
      ([event]) => event === 'preview-pane.iframe.bootstrap-timeout',
    );
  }

  it('fires the bootstrap-timeout warn after IFRAME_BOOTSTRAP_RETRY_MS when no IFRAME_READY arrives', async () => {
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(bootstrapTimeoutWarns()).toHaveLength(0);

    // Just under the threshold — still no warn.
    await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS - 1);
    expect(bootstrapTimeoutWarns()).toHaveLength(0);

    // Cross the threshold — first auto-retry fires.
    await vi.advanceTimersByTimeAsync(2);
    expect(bootstrapTimeoutWarns()).toHaveLength(1);
    expect(bootstrapTimeoutWarns()[0][1]).toMatchObject({
      appId: 'test-app-123',
      attempt: 1,
    });
  });

  it('stops firing after MAX_IFRAME_BOOTSTRAP_RETRIES', async () => {
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Advance 4 timeout windows. The 4th should NOT trigger another warn —
    // we cap retries to MAX_IFRAME_BOOTSTRAP_RETRIES (3). Use the async
    // variant so React state updates from each setIframeKey flush before
    // the next advance — without it, the re-mount effect doesn't register
    // the next timer and only one warn fires.
    for (let i = 0; i < MAX_IFRAME_BOOTSTRAP_RETRIES + 1; i++) {
      await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS + 1);
    }

    expect(bootstrapTimeoutWarns()).toHaveLength(MAX_IFRAME_BOOTSTRAP_RETRIES);
    // Each warn carries an incrementing attempt counter.
    expect(bootstrapTimeoutWarns().map((c) => c[1].attempt)).toEqual([1, 2, 3]);
  });

  it('does not fire if IFRAME_READY arrives before the timeout', async () => {
    const { container } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Wait briefly to allow effects (timer registration + iframe mount) to
    // settle. Use async-flush to let React commit before we dispatch.
    await vi.advanceTimersByTimeAsync(50);

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();

    // Simulate the preview app posting IFRAME_READY shortly after mount.
    // The component listens via the 'message' event; dispatch one whose
    // source matches the iframe element so the 'fromPreviewIframe' check
    // passes inside the handler. Wrap in act() so the resulting setState
    // flushes (and the bootstrap-retry effect re-runs to cancel the
    // pending timer) BEFORE we advance time past the timeout.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'IFRAME_READY' },
          source: iframe!.contentWindow,
        }),
      );
    });

    // Advance past the timeout — must NOT fire because we already
    // bootstrapped (the timer was cleared by the effect cleanup).
    await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS + 1);
    expect(bootstrapTimeoutWarns()).toHaveLength(0);
  });

  it('does NOT fire when serverState.isReady is false', async () => {
    // Negative-path guard: the bootstrap-timeout effect short-circuits
    // on `!serverState?.isReady`. Without this guard, a still-provisioning
    // app would spin auto-retries while the preview iframe isn't even
    // rendered yet.
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: 'http://localhost:3000',
    }; });
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Advance well past the timeout — must NOT fire.
    await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS * 2);
    expect(bootstrapTimeoutWarns()).toHaveLength(0);
  });

  it('does NOT fire when previewUrl is null', async () => {
    // Negative-path guard: same effect short-circuits on !previewUrl.
    // serverState ready but URL not yet resolved — keep the iframe
    // gated and the retry timer dormant.
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: true,
      url: null,
    }; });
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS * 2);
    expect(bootstrapTimeoutWarns()).toHaveLength(0);
  });

  it('resets the auto-retry budget when handleManualRetry is invoked', async () => {
    // Comment at PreviewPane.tsx ~174 says bootstrapRetryCount is kept
    // separate from iframeKey specifically so manual retries (the user
    // clicking "try again" after an error) get a fresh budget. Pin
    // that behaviour: exhaust auto-retries → trigger iframe error →
    // click retry button → assert next timeout fires with attempt: 1.
    const { container } = renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} />,
    );

    // Exhaust the auto-retry budget.
    for (let i = 0; i < MAX_IFRAME_BOOTSTRAP_RETRIES + 1; i++) {
      await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS + 1);
    }
    expect(bootstrapTimeoutWarns()).toHaveLength(MAX_IFRAME_BOOTSTRAP_RETRIES);

    // Trigger the iframe-error path so the PreviewError UI (with the
    // retry button) renders. The iframe has `onError={handleIframeError}`
    // (PreviewPane.tsx ~988) which sets iframeError=true. fireEvent.error
    // doesn't reliably fire React's onError on iframes in JSDOM (the
    // native error event semantics differ from production). Reach into
    // React's stored props instead and invoke the handler directly —
    // this is the same code path React would invoke on a real error.
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    const reactPropsKey = Object.keys(iframe!).find((k) => k.startsWith('__reactProps$'));
    expect(reactPropsKey).toBeTruthy();
    const onError = (iframe as unknown as Record<string, { onError?: (e: Event) => void }>)[
      reactPropsKey!
    ].onError;
    expect(onError).toBeTruthy();
    await act(async () => {
      onError!(new Event('error'));
      await Promise.resolve();
    });

    // PreviewError mock renders a button with the i18n key as text.
    // Use getByText (sync) — findByText polls on real timers and would
    // hang under vi.useFakeTimers(). State has flushed via the act()
    // above, so the DOM is current.
    const retryButton = screen.getByText('builder_preview_error_button');
    await act(async () => {
      fireEvent.click(retryButton);
      await Promise.resolve();
    });

    // Iframe is back (iframeError reset), counter is 0. Advance one
    // timeout window — must fire with attempt: 1, proving the reset.
    await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS + 1);

    expect(bootstrapTimeoutWarns()).toHaveLength(MAX_IFRAME_BOOTSTRAP_RETRIES + 1);
    expect(bootstrapTimeoutWarns().slice(-1)[0][1]).toMatchObject({
      appId: 'test-app-123',
      attempt: 1, // reset, NOT 4 — proves manual-retry-counter-reset works
    });
  });

  it('resets the auto-retry budget when previewUrl changes', async () => {
    const { rerender } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Exhaust the auto-retry budget on URL #1.
    for (let i = 0; i < MAX_IFRAME_BOOTSTRAP_RETRIES + 1; i++) {
      await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS + 1);
    }
    expect(bootstrapTimeoutWarns()).toHaveLength(MAX_IFRAME_BOOTSTRAP_RETRIES);

    // Server hands out a new allocation URL — counter must reset so the
    // user gets a fresh budget on the new URL. Without this, exhausted
    // state from the old URL would skip auto-recovery on the new one.
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: true,
      url: 'http://localhost:4000', // different URL
    }; });
    rerender(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // First post-URL-change timeout fires the warn — proof the counter reset.
    await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS + 1);
    expect(bootstrapTimeoutWarns()).toHaveLength(MAX_IFRAME_BOOTSTRAP_RETRIES + 1);
    expect(bootstrapTimeoutWarns().slice(-1)[0][1]).toMatchObject({
      appId: 'test-app-123',
      attempt: 1, // reset, not 4
    });
  });
});

describe('publish-snapshot-request handling', function publishSnapshotHandlingTests() {
  const publishDetail = {
    appId: 'test-app-123',
    deploymentId: 'deploy-abc',
    commitHash: 'abc1234',
  }

  function dispatchPublishRequest() {
    window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: publishDetail }))
  }

  function simulateIframeResponse(screenshot = 'data:image/png;base64,xx') {
    const iframe = document.querySelector('iframe')
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'VIEWPORT_SCREENSHOT_RESPONSE', screenshot },
      source: iframe?.contentWindow ?? window,
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW
    mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: true, url: 'http://localhost:3000' }; })
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key];
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends REQUEST_VIEWPORT_SCREENSHOT after 2s delay', async () => {
    const onPublishSnapshot = vi.fn()
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} onPublishSnapshot={onPublishSnapshot} />)

    dispatchPublishRequest()
    expect(vi.mocked(postMessageToIframe)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'REQUEST_VIEWPORT_SCREENSHOT' })
    )

    vi.advanceTimersByTime(2000)
    expect(vi.mocked(postMessageToIframe)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'REQUEST_VIEWPORT_SCREENSHOT' })
    )
  })

  it('calls onPublishSnapshot when VIEWPORT_SCREENSHOT_RESPONSE arrives', async () => {
    const onPublishSnapshot = vi.fn()
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} onPublishSnapshot={onPublishSnapshot} />)

    dispatchPublishRequest()
    vi.advanceTimersByTime(2000)
    simulateIframeResponse()

    expect(onPublishSnapshot).toHaveBeenCalledWith('data:image/png;base64,xx', publishDetail)
  })

  it('re-sends REQUEST_VIEWPORT_SCREENSHOT via fallback timer when no response arrives', () => {
    const onPublishSnapshot = vi.fn()
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} onPublishSnapshot={onPublishSnapshot} />)

    dispatchPublishRequest()
    vi.advanceTimersByTime(2000)
    vi.mocked(postMessageToIframe).mockClear()

    // Advance past the 8s fallback
    vi.advanceTimersByTime(8000)
    expect(vi.mocked(postMessageToIframe)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'REQUEST_VIEWPORT_SCREENSHOT' })
    )
  })

})

describe('restoreIframeState', function restoreTests() {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send postMessage with url and scrollPosition', function postMessageWithBoth() {
    const mockIframe = {
      contentWindow: { postMessage: vi.fn() }
    } as unknown as HTMLIFrameElement;

    restoreIframeState(mockIframe, {
      url: '/menu',
      scrollPosition: { x: 0, y: 300 }
    });

    expect(postMessageToIframe).toHaveBeenCalledWith(mockIframe, {
      type: 'RESTORE_STATE_AFTER_REFRESH',
      url: '/menu',
      scrollPosition: { x: 0, y: 300 }
    });
  });

  it('should send postMessage with scrollPosition only when url is absent', function scrollOnly() {
    const mockIframe = {
      contentWindow: { postMessage: vi.fn() }
    } as unknown as HTMLIFrameElement;

    restoreIframeState(mockIframe, { scrollPosition: { x: 10, y: 800 } });

    expect(postMessageToIframe).toHaveBeenCalledWith(mockIframe, {
      type: 'RESTORE_STATE_AFTER_REFRESH',
      url: undefined,
      scrollPosition: { x: 10, y: 800 }
    });
  });

  it('should send postMessage with url only when scrollPosition is absent', function urlOnly() {
    const mockIframe = {
      contentWindow: { postMessage: vi.fn() }
    } as unknown as HTMLIFrameElement;

    restoreIframeState(mockIframe, { url: '/about' });

    expect(postMessageToIframe).toHaveBeenCalledWith(mockIframe, {
      type: 'RESTORE_STATE_AFTER_REFRESH',
      url: '/about',
      scrollPosition: undefined
    });
  });

  it('should not send postMessage when both url and scrollPosition are absent', function noOpEmptyState() {
    const mockIframe = {
      contentWindow: { postMessage: vi.fn() }
    } as unknown as HTMLIFrameElement;

    restoreIframeState(mockIframe, {});

    expect(postMessageToIframe).not.toHaveBeenCalled();
  });

  it('should preserve url with query params in postMessage', function queryParams() {
    const mockIframe = {
      contentWindow: { postMessage: vi.fn() }
    } as unknown as HTMLIFrameElement;

    restoreIframeState(mockIframe, {
      url: '/products?category=bakery&sort=price',
      scrollPosition: { x: 0, y: 200 }
    });

    expect(postMessageToIframe).toHaveBeenCalledWith(mockIframe, {
      type: 'RESTORE_STATE_AFTER_REFRESH',
      url: '/products?category=bakery&sort=price',
      scrollPosition: { x: 0, y: 200 }
    });
  });
});

describe('PreviewPane — Ask Airo to fix button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
  });

  it('shows "Ask Airo to fix" alongside Try Again when failureKind is crash-loop', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'failed',
      failureKind: 'crash-loop',
      error: undefined,
    }; });
    const onAskAiroToFix = vi.fn();
    const { user } = renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} onAskAiroToFix={onAskAiroToFix} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    const secondary = screen.getByTestId('preview-error-secondary');
    expect(secondary).toBeInTheDocument();

    await user.click(secondary);
    expect(onAskAiroToFix).toHaveBeenCalledOnce();
  });

  it('shows "Ask Airo to fix" on any status=error|failed (incl. BFF/network failures)', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'error',
      error: 'Network error',
    }; });
    const onAskAiroToFix = vi.fn();
    const { user } = renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} onAskAiroToFix={onAskAiroToFix} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    const secondary = screen.getByTestId('preview-error-secondary');
    expect(secondary).toBeInTheDocument();

    await user.click(secondary);
    expect(onAskAiroToFix).toHaveBeenCalledOnce();
  });

  it('does NOT show "Ask Airo to fix" when onAskAiroToFix prop is not provided', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'failed',
      failureKind: 'crash-loop',
    }; });
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('preview-error-secondary')).not.toBeInTheDocument();
  });

  it('disables "Ask Airo to fix" button while agent is processing', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'failed',
      failureKind: 'crash-loop',
    }; });
    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        onAskAiroToFix={vi.fn()}
        isProcessing={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    const secondary = screen.getByTestId('preview-error-secondary');
    expect(secondary).toBeDisabled();
  });

  describe('build overlay askQuestion behavior', () => {
    beforeEach(() => {
      mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: true, url: 'http://localhost:3000' }; });
    });

    it('shows question overlay when askQuestion is pending during build', () => {
      mockUseLatestNBAs.mockReturnValue({ source: 'askQuestion', question: 'Pick a color', suggestions: [] });

      renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

      expect(screen.getByText('Action needed to continue')).toBeInTheDocument();
    });

    it('shows default building overlay when no askQuestion is pending', () => {
      mockUseLatestNBAs.mockReturnValue(undefined);
      mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: '' }; });
      mockServerPollingStore.isPollingServer = vi.fn(function () { return true; });

      renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

      expect(screen.queryByText('Action needed to continue')).not.toBeInTheDocument();
      expect(screen.getByText('builder_preview_building_app')).toBeInTheDocument();
    });
  });
});

describe('first-build time-estimate pill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
    mockDevelopPageStore.mobileMode = MobileMode.PREVIEW;
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key];
    }
    mockUseLatestNBAs.mockReturnValue(null);
    mockInitialAgentCohort.current = undefined;
  });

  it('shows the pill on the overlay (server ready) when in the initial_agent_v3 cohort', () => {
    mockInitialAgentCohort.current = 'initial_agent_v3';
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '5');
    expect(mockMarkBuildEstimateShown).toHaveBeenCalled();
  });

  it('shows the pill on the loading state (no serverState) when in the initial_agent_v3 cohort', () => {
    mockInitialAgentCohort.current = 'initial_agent_v3';
    mockServerPollingStore.getServerState = vi.fn(function () {
      return undefined;
    });
    mockServerPollingStore.isPollingServer = vi.fn(function () { return true; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '5');
    expect(mockMarkBuildEstimateShown).toHaveBeenCalled();
  });

  it('does not show the pill when not in v3 and the flag is off', () => {
    mockInitialAgentCohort.current = 'initial_agent_v1';
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '');
    expect(mockMarkBuildEstimateShown).not.toHaveBeenCalled();
  });

  it('does not show the pill on a normal (non-build) load even in the v3 cohort', () => {
    // The pill is gated on the first-build screen (showBuildingOverlay), not just
    // the cohort. A normal (non-build) load in the v3 cohort must keep it off,
    // so the showBuildingOverlay term in isFirstBuildScreen can't be dropped.
    mockInitialAgentCohort.current = 'initial_agent_v3';
    mockServerPollingStore.getServerState = vi.fn(function () {
      return undefined;
    });
    mockServerPollingStore.isPollingServer = vi.fn(function () { return true; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay={false} />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '');
    expect(mockMarkBuildEstimateShown).not.toHaveBeenCalled();
  });

  it('shows the pill via the Switchboard flag even when not in v3', () => {
    mockInitialAgentCohort.current = 'initial_agent_v1';
    mockSwitchboardResults['appbuilder-build-time-estimate'] = true;
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '5');
    expect(mockMarkBuildEstimateShown).toHaveBeenCalled();
  });

  it('does not show the pill on the ask-question overlay even in the v3 cohort', () => {
    mockInitialAgentCohort.current = 'initial_agent_v3';
    mockUseLatestNBAs.mockReturnValue({ source: 'askQuestion', question: 'Pick a color', suggestions: [] });
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '');
    expect(mockMarkBuildEstimateShown).not.toHaveBeenCalled();
  });

  it('does not fire the impression on the resume early-return even when gating is enabled', () => {
    // Regression: the impression must reflect a pill the user actually saw. The
    // resume early-return renders a PreviewLoadingState WITHOUT the pill, so even
    // though gating (v3 cohort + first-build screen) is satisfied, nothing fires.
    mockInitialAgentCohort.current = 'initial_agent_v3';
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay isResuming />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '');
    expect(mockMarkBuildEstimateShown).not.toHaveBeenCalled();
  });
});
