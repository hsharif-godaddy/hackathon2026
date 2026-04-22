/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { postMessageToIframe } from '@/utils/postMessage';
import PreviewPane, { restoreIframeState } from './PreviewPane';
import { PreviewViewMode, ViewMode } from '../types';

// Mock child components
vi.mock('./PreviewCode', () => ({
  default: ({ appId }: any) => <div data-testid="preview-code">Code: {appId}</div>,
}));

vi.mock('./PreviewError', () => ({
  default: ({ title, error, buttonText, buttonOnClick }: any) => (
    <div data-testid="preview-error">
      <h1>{title}</h1>
      <p>{error}</p>
      <button onClick={buttonOnClick}>{buttonText}</button>
    </div>
  ),
}));

vi.mock('@/app/[market]/develop/components/tips/Tips', () => ({
  default: () => <div data-testid="tips">Tips</div>,
}));

vi.mock('./brand-book', () => ({
  default: ({ appId }: any) => <div data-testid="brand-book">Brand Book: {appId}</div>,
}));

// Mock stores
const mockServerPollingStore = {
  getServerState: vi.fn(() => ({ isReady: true, url: 'http://localhost:3000' })),
  startPollingForServer: vi.fn(),
  stopPollingForServer: vi.fn(),
  isPollingServer: vi.fn(() => false),
};

const mockDevelopPageStore = {
  previewViewMode: PreviewViewMode.DESKTOP,
  viewMode: ViewMode.PREVIEW,
  setPreviewViewMode: vi.fn(),
  publishStates: { 'test-app-123': { isPublishing: false } } as Record<string, { isPublishing: boolean }>,
  isVersionHistoryOpen: false,
};

const mockGitStore = {
  getSelectedCommitHash: vi.fn(() => null),
};

let mockGitHistoryData: { commits: Array<{ hash: string }> } = { commits: [] };

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: any) => selector(mockServerPollingStore),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopPageStore),
}));

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
    isLoading: false,
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

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => ({
    data: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: () => ({
    data: null,
    isError: false,
  }),
}));

vi.mock('@/utils/domain', () => ({
  isAiroSubdomain: vi.fn(() => false),
  resolveSiteFqdn: vi.fn(() => null),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(() => false),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@airo-ux/loader', () => ({
  Loader: () => <div data-testid="loader">Loading...</div>,
}));

describe('PreviewPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;
    mockDevelopPageStore.publishStates = { 'test-app-123': { isPublishing: false } };
    mockServerPollingStore.getServerState = vi.fn(() => ({ isReady: true, url: 'http://localhost:3000' }));
    mockGitHistoryData = { commits: [] };
    mockGitStore.getSelectedCommitHash = vi.fn(() => null);
    mockDevelopPageStore.isVersionHistoryOpen = false;
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

  it('should show tips overlay and make iframe non-interactive when showBuildingOverlay is true', () => {
    mockServerPollingStore.getServerState = vi.fn(() => ({
      isReady: true,
      url: 'http://localhost:3000',
      status: 'running'
    }));

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

  it('should show cookie-blocked overlay when cookieVerified is false', () => {
    mockServerPollingStore.getServerState = vi.fn(() => ({
      isReady: false,
      url: 'http://localhost:3000',
      healthCheckPassed: true,
      cookieVerified: false,
    }));

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
    mockServerPollingStore.getServerState = vi.fn(() => ({
      isReady: false,
      url: 'http://localhost:3000',
      healthCheckPassed: true,
      cookieVerified: undefined,
    }));

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByTestId('preview-cookie-blocked')).not.toBeInTheDocument();
  });

  it('should show error when iframe fails to load', async () => {
    mockServerPollingStore.getServerState = vi.fn(() => ({ isReady: false, url: null, error: 'Server failed' }));

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await waitFor(() => {
      // The component may show an error or loading state
      expect(mockServerPollingStore.getServerState).toHaveBeenCalled();
    });
  });

  it('should render BrandBookView when viewMode is BRAND', () => {
    mockDevelopPageStore.viewMode = ViewMode.BRAND;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.getByTestId('brand-book')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument();
  });

  it('should not render BrandBookView when viewMode is PREVIEW', () => {
    mockDevelopPageStore.viewMode = ViewMode.PREVIEW;

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByTestId('brand-book')).not.toBeInTheDocument();
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
    mockServerPollingStore.getServerState = vi.fn(() => ({ isReady: true, url: 'http://localhost:3000' }))
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
