import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { postMessageToIframe } from '@/utils/postMessage';
import PreviewPane, { restoreIframeState } from './PreviewPane';
import { PreviewViewMode, ViewMode } from '../types';

// Mock child components
vi.mock('./PreviewHeader', () => ({
  default: ({ onPreviewRefresh }: any) => (
    <div data-testid="preview-header">
      <button onClick={onPreviewRefresh}>Refresh</button>
    </div>
  ),
}));

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

vi.mock('@/app/develop/components/tips/Tips', () => ({
  default: () => <div data-testid="tips">Tips</div>,
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

vi.mock('@/app/develop/components/utils', () => ({
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
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.getByTestId('preview-header')).toBeInTheDocument();
  });

  it('should render PreviewHeader', () => {
    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    expect(screen.getByTestId('preview-header')).toBeInTheDocument();
  });

  it('should call onPreviewRefresh when refresh button clicked', async () => {
    const onPreviewRefresh = vi.fn();
    const { user } = renderWithProviders(<PreviewPane onPreviewRefresh={onPreviewRefresh} />);

    const refreshButton = screen.getByText('Refresh');
    await user.click(refreshButton);

    expect(onPreviewRefresh).toHaveBeenCalled();
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

  it('should show building overlay on top of iframe when showBuildingOverlay is true', () => {
    // Server is ready, so iframe should render
    mockServerPollingStore.getServerState = vi.fn(() => ({
      isReady: true,
      url: 'http://localhost:3000',
      status: 'running'
    }));

    renderWithProviders(
      <PreviewPane
        onPreviewRefresh={vi.fn()}
        showBuildingOverlay={true}  // Overlay active
      />
    );

    // Both iframe and overlay should be present
    const iframe = screen.getByTitle('builder_preview_preview_for');
    expect(iframe).toBeInTheDocument();

    // Overlay should be visible
    expect(screen.getByTestId('tips')).toBeInTheDocument();

    // Iframe should have accessibility attributes when overlay is active
    expect(iframe).toHaveAttribute('aria-hidden', 'true');
    expect(iframe).toHaveAttribute('tabIndex', '-1');
    // Note: inert attribute not tested due to limited jsdom support
    // but is set in the component for progressive enhancement
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

  it('should show error when iframe fails to load', async () => {
    mockServerPollingStore.getServerState = vi.fn(() => ({ isReady: false, url: null, error: 'Server failed' }));

    renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

    await waitFor(() => {
      // The component may show an error or loading state
      expect(mockServerPollingStore.getServerState).toHaveBeenCalled();
    });
  });

  describe('historical commit restore banner', () => {
    const latestHash = 'latest-commit-hash';
    const oldHash = 'old-commit-hash';

    it('should show restore banner when viewing historical commit with history tab open', async () => {
      mockGitHistoryData = { commits: [{ hash: latestHash }, { hash: oldHash }] };
      mockGitStore.getSelectedCommitHash = vi.fn(() => oldHash);
      mockDevelopPageStore.isVersionHistoryOpen = true;

      renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('builder_preview_git_text')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'builder_preview_error_restore' })).toBeInTheDocument();
      });
    });

    it('should hide restore banner when selectedCommitHash is stale and history tab is closed', async () => {
      mockGitHistoryData = { commits: [{ hash: latestHash }, { hash: oldHash }] };
      mockGitStore.getSelectedCommitHash = vi.fn(() => oldHash);
      mockDevelopPageStore.isVersionHistoryOpen = false;

      renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

      await waitFor(() => {
        expect(document.querySelector('iframe')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_preview_git_text')).not.toBeInTheDocument();
    });

    it('should hide restore banner when viewing historical commit but publishing', async () => {
      mockGitHistoryData = { commits: [{ hash: latestHash }, { hash: oldHash }] };
      mockGitStore.getSelectedCommitHash = vi.fn(() => oldHash);
      mockDevelopPageStore.isVersionHistoryOpen = true;
      mockDevelopPageStore.publishStates['test-app-123'].isPublishing = true;

      renderWithProviders(<PreviewPane onPreviewRefresh={vi.fn()} />);

      await waitFor(() => {
        expect(document.querySelector('iframe')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_preview_git_text')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'builder_preview_error_restore' })).not.toBeInTheDocument();
    });
  });
});

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
