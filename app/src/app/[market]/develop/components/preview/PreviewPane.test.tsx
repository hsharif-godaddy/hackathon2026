/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore';
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
  }: any) => (
    <div data-testid="preview-error">
      <h1>{title}</h1>
      <p>{error}</p>
      <button onClick={buttonOnClick}>
        {buttonText}
      </button>
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

vi.mock('@/app/[market]/develop/components/preview/inbox/Inbox', () => ({
  default: () => (
    <div data-testid="inbox-iframe">Inbox</div>
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

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: vi.fn(),
  }),
}));

const mockSwitchboardResults: Record<string, boolean> = {};
const mockSwitchboardValues: Record<string, string> = {};
const EDITING_CHIP_FLAG = 'appbuilder-preview-enhanced-overlays';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => mockSwitchboardResults[feature] ?? false,
  getSwitchboardFlag: (feature: string) => mockSwitchboardResults[feature] ?? false,
  getSwitchboardValue: (feature: string) => mockSwitchboardValues[feature],
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
  logClickEvent: vi.fn(() => () => {}),
  logActionEvent: vi.fn(() => () => {}),
  logImpressionEvent: vi.fn(() => () => {}),
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
    for (const key of Object.keys(mockSwitchboardValues)) {
      delete mockSwitchboardValues[key];
    }
    mockUseImpression.mockReset();
    mockUseLatestNBAs.mockReset();
    mockUseLatestNBAs.mockReturnValue(null);
    mockIsInitialBuildFunnelActive.mockReturnValue(true);
    mockIsInitialBuildComplete.mockReturnValue(false);
    mockInitialAgentCohort.current = undefined;
    useStreamingConversationStore.setState({ activeStream: null, messages: [] });
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

  it('preview-iframe has permission allow= with required features and no payment', async () => {
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    const iframe = await screen.findByTestId('preview-iframe');
    const allow = iframe.getAttribute('allow') ?? '';
    expect(allow).toContain('camera');
    expect(allow).toContain('microphone');
    expect(allow).toContain('geolocation');
    expect(allow).toContain('clipboard-read');
    expect(allow).toContain('fullscreen');
    expect(allow).not.toContain('payment');
    expect(allow).not.toContain('clipboard-write');
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

  it('should render desktop status chip with Working label when processing and not mutating', async () => {
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
    const editingChip = screen.getByTestId('preview-editing-chip');
    expect(within(editingChip).getByRole('status', { name: 'Working' })).toBeInTheDocument();
    expect(within(editingChip).queryByRole('status', { name: 'Updating your project' })).not.toBeInTheDocument();
  });

  it('should render desktop status chip with Updating your project label when mutating', async () => {
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
    const editingChip = screen.getByTestId('preview-editing-chip');
    expect(within(editingChip).getByRole('status', { name: 'Updating your project' })).toBeInTheDocument();
    expect(within(editingChip).queryByRole('status', { name: 'Working' })).not.toBeInTheDocument();
  });

  it('should render desktop status chip with summarized label when a tool is running', async () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'grepSearch',
            input: { query: 'hero' },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    });

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
    const editingChip = screen.getByTestId('preview-editing-chip');
    expect(within(editingChip).getByRole('status', { name: 'Checking your project' })).toBeInTheDocument();
    expect(screen.queryByText('builder_tools_active_grep_search')).not.toBeInTheDocument();
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

  it('should keep mobile Thinker with builder_agent_thinking when enhanced overlays flag is off', () => {
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

  it('should show mobile status pill with Working label when enhanced overlays flag is on and not mutating', () => {
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
    expect(mobileStatusPill).toHaveAccessibleName('Working');
  });

  it('should show mobile status pill with Updating your project label when enhanced overlays flag is on and mutating', () => {
    mockSwitchboardResults[EDITING_CHIP_FLAG] = true;
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'fileEdit',
            input: { path: 'src/pages/index.tsx' },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    });

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
    expect(mobileStatusPill).toHaveAccessibleName('Updating your project');
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

  it('should show mobile status pill with Updating your project label when mutating without processing', () => {
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
    expect(mobileStatusPill).toHaveAccessibleName('Updating your project');
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

  // Browser-specific cookieVerified=false behavior (WebKit storage-access vs the
  // non-WebKit error UI) is covered in the "Storage Access fallback gating" suite.

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

  // The Brand Book is mounted as a persistent overlay by the develop page (a stable
  // parent), NOT by PreviewPane — so it survives PreviewPane's readiness branch
  // switches mid-generation. PreviewPane's only brand responsibility is to keep the
  // preview/code mounted-but-inert underneath when BRAND is active.
  it('keeps preview + code mounted underneath (and does not own the brand book) in BRAND mode when ready', () => {
    mockDevelopPageStore.viewMode = ViewMode.BRAND;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByTestId('brand-book')).not.toBeInTheDocument();
    expect(screen.getByTestId('preview-iframe')).toBeInTheDocument();
    expect(screen.getByTestId('preview-code')).toBeInTheDocument();
  });

  it('shows the loading state (no brand, no preview) in BRAND mode when server is NOT ready', () => {
    mockDevelopPageStore.viewMode = ViewMode.BRAND;
    mockServerPollingStore.getServerState = vi.fn(function () { return { isReady: false, url: null }; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByTestId('brand-book')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-code')).not.toBeInTheDocument();
  });

  it('never renders the brand book itself (it is owned by the page) — e.g. in PREVIEW mode', () => {
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
    it('should render INBOX when resumeFailed and viewMode is INBOX', () => {
      mockSwitchboardResults['app-builder-inbox-button'] = true;
      mockDevelopPageStore.viewMode = ViewMode.INBOX;
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

    // PreviewError mock renders buttonText directly (defaults resolve via IntlProvider).
    // Use getByRole (sync) — findByText polls on real timers and would
    // hang under vi.useFakeTimers(). State has flushed via the act()
    // above, so the DOM is current.
    const retryButton = screen.getByRole('button', { name: /Fix this/i });
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

describe('PreviewPane — Storage Access fallback gating', () => {
  const IFRAME_BOOTSTRAP_RETRY_MS = 3000;
  const MAX_IFRAME_BOOTSTRAP_RETRIES = 3;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
    mockDevelopPageStore.publishStates = { 'test-app-123': { isPublishing: false } };
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: true,
      url: 'http://localhost:3000',
    }; });
    mockServerPollingStore.isPollingServer = vi.fn(function () { return false; });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubWebKit(): void {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
  }

  function stubChrome(): void {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  }

  async function exhaustBootstrapRetries(): Promise<void> {
    for (let i = 0; i < MAX_IFRAME_BOOTSTRAP_RETRIES + 1; i++) {
      await vi.advanceTimersByTimeAsync(IFRAME_BOOTSTRAP_RETRY_MS + 1);
    }
  }

  it('renders the storage-access bootstrap in-pane on WebKit when cookieVerified is false', () => {
    stubWebKit();
    mockServerPollingStore.getServerState = vi.fn(function () {
      return {
        isReady: false,
        url: 'https://app.preview.c4.test-airoapp.ai/?airoShareToken=tok',
        healthCheckPassed: true,
        cookieVerified: false,
      };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Under Safari ITP the cookie is partitioned (cookieVerified=false). Instead of
    // the dead-end "Try Again" UI, the pane should host the /airo/storage-access
    // bootstrap so the user can grant access and load the preview in place.
    const container = screen.getByTestId('preview-cookie-blocked-storage-access');
    expect(container).toBeInTheDocument();
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('/airo/storage-access');
    expect(iframe?.getAttribute('src')).toContain('redirect=');
    expect(screen.queryByTestId('preview-cookie-blocked')).not.toBeInTheDocument();
  });

  it('keeps the cookie-blocked error UI on non-WebKit when cookieVerified is false', () => {
    stubChrome();
    mockServerPollingStore.getServerState = vi.fn(function () {
      return {
        isReady: false,
        url: 'http://localhost:3000',
        healthCheckPassed: true,
        cookieVerified: false,
      };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.getByTestId('preview-cookie-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-cookie-blocked-storage-access')).not.toBeInTheDocument();
    // Retry button + open-in-new-tab link (defaultMessage used since messages={})
    expect(screen.getByText('builder_common_try_again')).toBeInTheDocument();
    const link = screen.getByText('Open preview in new tab');
    expect(link).toHaveAttribute('href', 'http://localhost:3000');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('does NOT remount the in-pane Storage Access bootstrap (no IFRAME_READY churn)', async () => {
    // Regression for the "Enable preview coming again and again" loop. When the
    // cross-site cookie is ITP-blocked the store reports isReady=true AND
    // cookieVerified=false, and PreviewPane renders the dev-supervisor
    // /airo/storage-access bootstrap in-pane. That page never posts IFRAME_READY
    // by design, so bootstrap-race recovery used to mistake it for a failed
    // preview boot and remount it every IFRAME_BOOTSTRAP_RETRY_MS — reloading the
    // "Enable preview" prompt and stomping the one-tap requestStorageAccess()
    // gesture. Recovery must be suppressed while the bootstrap owns the iframe.
    //
    // isReady:true is load-bearing here — with isReady:false the recovery
    // effect's existing `!serverState.isReady` guard would mask the cookie
    // guard and the test would pass even without the fix.
    stubWebKit();
    mockServerPollingStore.getServerState = vi.fn(function () {
      return {
        isReady: true,
        url: 'https://app.preview.c4.test-airoapp.ai/?airoShareToken=tok',
        healthCheckPassed: true,
        cookieVerified: false,
      };
    });
    const { logger } = await import('@/lib/request-context');
    const warn = logger.warn as ReturnType<typeof vi.fn>;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // The Storage Access bootstrap is shown in-pane.
    const container = screen.getByTestId('preview-cookie-blocked-storage-access');
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('/airo/storage-access');

    // Advancing well past the remount budget must produce NO bootstrap-timeout
    // remount (pre-fix this fired MAX_IFRAME_BOOTSTRAP_RETRIES times).
    await exhaustBootstrapRetries();

    const bootstrapTimeoutWarns = warn.mock.calls.filter(
      ([event]) => event === 'preview-pane.iframe.bootstrap-timeout',
    );
    expect(bootstrapTimeoutWarns).toHaveLength(0);
    // …and the bootstrap is still in place (not remounted away).
    expect(screen.getByTestId('preview-cookie-blocked-storage-access')).toBeInTheDocument();
  });

  it('redirects iframe to storage-access bootstrap when WebKit + auth probe gets 401', async () => {
    stubWebKit();
    // dev-supervisor rejects with a direct 401 (CORS-readable) when the
    // partitioned cookie fails JWT validation — the probe must treat that as
    // auth-blocked and switch the iframe to the storage-access bootstrap.
    const fetchMock = vi.fn().mockResolvedValue({ type: 'cors', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();
    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    const iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('/airo/storage-access');
  });

  it('redirects iframe to storage-access bootstrap when WebKit + auth probe gets 403', async () => {
    stubWebKit();
    const fetchMock = vi.fn().mockResolvedValue({ type: 'cors', status: 403 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();
    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    const iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('/airo/storage-access');
  });

  it('probes auth-check with redirect:manual and never mode:no-cors (WebKit rejects the combo)', async () => {
    stubWebKit();
    const fetchMock = vi.fn().mockResolvedValue({ type: 'cors', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();
    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/airo/auth-check'),
      expect.objectContaining({ method: 'HEAD', credentials: 'include', redirect: 'manual' }),
    );
    // Regression guard: `mode: 'no-cors'` + `redirect: 'manual'` is illegal per
    // the Fetch spec and throws in WebKit ("No-Cors mode requires follow
    // redirect mode"), which made this probe always return false on Safari and
    // suppressed the Storage Access fallback. Never set no-cors here.
    const opts = (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
    expect(opts.mode).not.toBe('no-cors');
  });

  it('does NOT redirect to storage-access when auth probe returns 200 (authed, no 307/401/403)', async () => {
    stubWebKit();
    const fetchMock = vi.fn().mockResolvedValue({ type: 'cors', status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();

    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    const iframe = document.querySelector('iframe');
    expect(iframe?.src).not.toContain('/airo/storage-access');
  });

  it('redirects to storage-access when WebKit + auth probe detects a 401 login page (post-#4578)', async () => {
    // dev-supervisor (#4578) now serves a 401 login page instead of a 307 on
    // auth failure, so the probe must treat 401 as "blocked", not only 307.
    stubWebKit();
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();

    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    const iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('/airo/storage-access');
  });

  it('does NOT redirect to storage-access on Chrome even if retries exhausted', async () => {
    stubChrome();
    const fetchMock = vi.fn().mockResolvedValue({ type: 'cors', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();

    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    const iframe = document.querySelector('iframe');
    expect(iframe?.src).not.toContain('/airo/storage-access');
    // Auth probe should not run on non-WebKit (config fetch from useAuth is OK)
    expect(
      fetchMock.mock.calls.some(
        ([url]) => typeof url === 'string' && url.includes('/airo/auth-check'),
      ),
    ).toBe(false);
  });

  it('does NOT redirect when probe fetch throws (network error)', async () => {
    stubWebKit();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();

    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    const iframe = document.querySelector('iframe');
    expect(iframe?.src).not.toContain('/airo/storage-access');
  });

  it('resets isAuthBlocked when previewUrl changes', async () => {
    stubWebKit();
    const fetchMock = vi.fn().mockResolvedValue({ type: 'cors', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await exhaustBootstrapRetries();

    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    // Confirm it's in storage-access mode
    let iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('/airo/storage-access');

    // URL changes — should reset
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: true,
      url: 'http://localhost:4000',
    }; });
    fetchMock.mockResolvedValue({ type: 'opaque' });
    rerender(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });

    iframe = document.querySelector('iframe');
    expect(iframe?.src).not.toContain('/airo/storage-access');
  });
});

describe('PreviewPane — evidence-based recovery (appbuilder-preview-evidence-recovery)', () => {
  const EVIDENCE_FLAG = 'appbuilder-preview-evidence-recovery';
  const PROBE_DELAY_MS = 8000;
  const REFRESH_DEBOUNCE_MS = 500;

  let mockLoggerWarn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
    mockDevelopPageStore.publishStates = { 'test-app-123': { isPublishing: false } };
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000' };
    });
    mockServerPollingStore.isPollingServer = vi.fn(function () { return false; });
    mockSwitchboardResults[EVIDENCE_FLAG] = true;
    const { logger } = await import('@/lib/request-context');
    mockLoggerWarn = logger.warn as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete mockSwitchboardResults[EVIDENCE_FLAG];
  });

  function bootstrapTimeoutWarns() {
    return mockLoggerWarn.mock.calls.filter(
      ([event]) => event === 'preview-pane.iframe.bootstrap-timeout',
    );
  }

  async function settle() {
    await vi.advanceTimersByTimeAsync(0);
    await act(async () => { await Promise.resolve(); });
  }

  it('does NOT remount a slow-but-healthy iframe (auth probe returns no 307)', async () => {
    // The core fix: a healthy preview that is merely slow to signal
    // IFRAME_READY must never be force-remounted.
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque' });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Advance through several probe windows.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(PROBE_DELAY_MS + 1);
      await settle();
    }

    expect(bootstrapTimeoutWarns()).toHaveLength(0);
    const iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('localhost:3000');
    expect(iframe?.src).not.toContain('/airo/storage-access');
  });

  it('remounts only when the auth probe confirms a 401/403 auth block', async () => {
    // dev-supervisor now serves 401/403 instead of the old 307 redirect (#4578).
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await vi.advanceTimersByTimeAsync(PROBE_DELAY_MS + 1);
    await settle();

    const warns = bootstrapTimeoutWarns();
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns[0][1]).toMatchObject({ appId: 'test-app-123', reason: 'auth-redirect', attempt: 1 });
  });

  it('does NOT remount or probe after receiving IFRAME_BOOTING', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(50);

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();

    // App posts its early booting beacon — proves the app JS is executing,
    // so the iframe is NOT auth-blocked and must not be remounted.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'IFRAME_BOOTING' },
          source: iframe!.contentWindow,
        }),
      );
    });

    await vi.advanceTimersByTimeAsync(PROBE_DELAY_MS * 2);
    await settle();

    expect(bootstrapTimeoutWarns()).toHaveLength(0);
    const authCheckCalled = fetchMock.mock.calls.some(
      ([url]) => typeof url === 'string' && url.includes('/airo/auth-check'),
    );
    expect(authCheckCalled).toBe(false);
  });

  it('manual preview-refresh reloads via a single remount (new iframe node)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque' });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(10);
    await act(async () => { await Promise.resolve(); });

    const before = container.querySelector('iframe');
    expect(before).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'preview-refresh' },
          origin: window.location.origin,
          source: window,
        }),
      );
    });

    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS + 1);
    await act(async () => { await Promise.resolve(); });

    const after = container.querySelector('iframe');
    // Single key-tracked remount, not an in-place src reassignment.
    expect(after).not.toBe(before);
  });

  it('does NOT probe or remount when cookieVerified is false (Storage Access bootstrap owns the iframe)', async () => {
    // Issue: evidence effect was missing the cookieVerified===false guard that
    // the legacy effect has. Without it, the probe fires every 8s, returns
    // 401/403 (because the cookie isn't sent), fires bootstrap-timeout warns,
    // burns the retry budget, and leaves no recovery budget for when the user
    // actually grants access.
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', cookieVerified: false };
    });
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Advance through several probe windows.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(PROBE_DELAY_MS + 1);
      await settle();
    }

    // Probe must NOT fire — Storage Access bootstrap owns the iframe.
    const authCheckCalled = fetchMock.mock.calls.some(
      ([url]) => typeof url === 'string' && url.includes('/airo/auth-check'),
    );
    expect(authCheckCalled).toBe(false);
    expect(bootstrapTimeoutWarns()).toHaveLength(0);
  });

  it('stops probing after MAX_IFRAME_BOOTSTRAP_RETRIES clean probes (slot consumption bounded)', async () => {
    // The else branch consumes a retry slot even on a clean probe so probing
    // stays bounded. After MAX slots the effect exits early.
    const MAX = 3;
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque', status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    // Advance MAX+1 probe windows.
    for (let i = 0; i < MAX + 1; i++) {
      await vi.advanceTimersByTimeAsync(PROBE_DELAY_MS + 1);
      await settle();
    }

    // No remounts (all probes were clean).
    expect(bootstrapTimeoutWarns()).toHaveLength(0);

    // Probing is bounded to at most MAX+1 probes (MAX slots consumed during
    // the loop windows, plus at most one from the initial mount). The guard
    // `bootstrapRetryCount >= MAX` prevents any further probes after that.
    const probeCount = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/airo/auth-check'),
    ).length;
    expect(probeCount).toBeGreaterThanOrEqual(MAX);
    expect(probeCount).toBeLessThanOrEqual(MAX + 1);
  });

  it('ignores IFRAME_BOOTING from a non-preview-iframe source', async () => {
    // IFRAME_BOOTING must be validated against the iframe contentWindow —
    // a message from window itself (or any other source) must not suppress
    // probing.
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(50);

    // Post IFRAME_BOOTING from the wrong source (window, not the iframe).
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'IFRAME_BOOTING' },
        source: window, // wrong source — not the preview iframe
        origin: window.location.origin,
      }));
    });

    // Timer should still fire (iframeBooting must NOT have been set).
    await vi.advanceTimersByTimeAsync(PROBE_DELAY_MS + 1);
    await settle();

    expect(bootstrapTimeoutWarns().length).toBeGreaterThanOrEqual(1);
  });

  it('probe request includes cache:no-store to avoid stale auth-check responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaque', status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(PROBE_DELAY_MS + 1);
    await settle();

    const probeCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/airo/auth-check'),
    );
    expect(probeCall).toBeTruthy();
    expect(probeCall![1]).toMatchObject({ cache: 'no-store' });
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
    for (const key of Object.keys(mockSwitchboardValues)) {
      delete mockSwitchboardValues[key];
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

describe('PreviewPane — Fix this button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
  });

  it('calls onPreviewFix with server context when failureKind is crash-loop', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'failed',
      failureKind: 'crash-loop',
      error: undefined,
    }; });
    const onPreviewFix = vi.fn();
    const { user } = renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} onPreviewFix={onPreviewFix} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Fix this/i }));
    expect(onPreviewFix).toHaveBeenCalledOnce();
    expect(onPreviewFix).toHaveBeenCalledWith({
      source: 'server',
      status: 'failed',
      failureKind: 'crash-loop',
    });
  });

  it('calls onPreviewFix with server context on status=error', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'error',
      error: 'Network error',
    }; });
    const onPreviewFix = vi.fn();
    const { user } = renderWithProviders(
      <PreviewPane onPreviewRefresh={vi.fn()} onPreviewFix={onPreviewFix} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Fix this/i }));
    expect(onPreviewFix).toHaveBeenCalledOnce();
    expect(onPreviewFix).toHaveBeenCalledWith({
      source: 'server',
      status: 'error',
      failureKind: undefined,
    });
  });

  it('does not call onPreviewFix when prop is not provided', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'failed',
      failureKind: 'crash-loop',
    }; });
    const { user } = renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Fix this/i }));
    expect(mockServerPollingStore.startPollingForServer).toHaveBeenCalled();
  });

  it('still calls onPreviewFix while agent is processing', async () => {
    mockServerPollingStore.getServerState = vi.fn(function () { return {
      isReady: false,
      url: null,
      status: 'failed',
      failureKind: 'crash-loop',
    }; });
    const onPreviewFix = vi.fn();
    const { user } = renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        onPreviewFix={onPreviewFix}
        isProcessing={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Fix this/i }));
    expect(onPreviewFix).toHaveBeenCalledOnce();
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
      expect(screen.getByText('Building your App')).toBeInTheDocument();
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
    for (const key of Object.keys(mockSwitchboardValues)) {
      delete mockSwitchboardValues[key];
    }
    mockUseLatestNBAs.mockReturnValue(null);
    mockInitialAgentCohort.current = undefined;
  });

  it('shows the pill on the overlay (server ready) during the first build', () => {
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '5');
    expect(mockMarkBuildEstimateShown).toHaveBeenCalled();
  });

  it('shows the pill on the loading state (no serverState) during the first build', () => {
    mockServerPollingStore.getServerState = vi.fn(function () {
      return undefined;
    });
    mockServerPollingStore.isPollingServer = vi.fn(function () { return true; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '5');
    expect(mockMarkBuildEstimateShown).toHaveBeenCalled();
  });

  it('does not show the pill on a normal (non-build) load', () => {
    // The pill is gated on the first-build screen (showBuildingOverlay), not just
    // reaching the preview, so the showBuildingOverlay term in isFirstBuildScreen
    // can't be dropped.
    mockServerPollingStore.getServerState = vi.fn(function () {
      return undefined;
    });
    mockServerPollingStore.isPollingServer = vi.fn(function () { return true; });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay={false} />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '');
    expect(mockMarkBuildEstimateShown).not.toHaveBeenCalled();
  });

  it('does not show the pill on the ask-question overlay', () => {
    mockUseLatestNBAs.mockReturnValue({ source: 'askQuestion', question: 'Pick a color', suggestions: [] });
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '');
    expect(mockMarkBuildEstimateShown).not.toHaveBeenCalled();
  });

  it('does not fire the impression on the resume early-return', () => {
    // Regression: the impression must reflect a pill the user actually saw. The
    // resume early-return renders a PreviewLoadingState WITHOUT the pill, so even
    // though the first-build screen gate is satisfied, nothing fires.
    mockServerPollingStore.getServerState = vi.fn(function () {
      return { isReady: true, url: 'http://localhost:3000', status: 'running' };
    });

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} showBuildingOverlay isResuming />);

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '');
    expect(mockMarkBuildEstimateShown).not.toHaveBeenCalled();
  });
});
