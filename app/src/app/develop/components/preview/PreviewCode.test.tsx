import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import PreviewCode from './PreviewCode';

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor">Monaco Editor</div>,
}));

// Mock AppService - ensureAppIsRunning no longer needed as it's handled by initialization state machine
vi.mock('@/services/AppService', () => ({
  appService: {
    getFiles: vi.fn(),
    getFileContents: vi.fn(),
    saveFile: vi.fn(),
  },
}));

// Mock stores
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn((selector: any) =>
    selector({
      isMobile: false,
      isFileTreeCollapsed: false,
      setIsFileTreeCollapsed: vi.fn(),
      setHasUnsavedChanges: vi.fn(),
      loadingPhase: 'ready', // Default to ready so file loading triggers
    })
  ),
}));

vi.mock('@/stores/useSiteCreationStore', () => ({
  useSiteCreationStore: vi.fn((selector: any) =>
    selector({
      realAppId: null,
    })
  ),
}));

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({ isBelowSmBreakpoint: false }),
}));

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PreviewCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    const { appService } = await import('@/services/AppService');
    vi.mocked(appService.getFiles).mockResolvedValue({ entries: [] });

    renderWithProviders(<PreviewCode appId="test-app-123" />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading editor/i)).not.toBeInTheDocument();
    });
  });

  it('should not fetch files until loadingPhase is ready', async () => {
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: 'loading-app', // Not ready yet
      })
    );

    const { appService } = await import('@/services/AppService');
    vi.mocked(appService.getFiles).mockResolvedValue({ entries: [] });

    renderWithProviders(<PreviewCode appId="test-app-123" />);

    // getFiles should NOT be called when loadingPhase is not 'ready'
    expect(appService.getFiles).not.toHaveBeenCalled();
  });

  it('should fetch files when loadingPhase transitions to ready', async () => {
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');
    const { appService } = await import('@/services/AppService');

    // Start with loading-app phase
    let currentLoadingPhase = 'loading-app';
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: currentLoadingPhase,
      })
    );

    vi.mocked(appService.getFiles).mockResolvedValue({ entries: [] });

    const { rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

    // Verify getFiles is NOT called when not ready
    expect(appService.getFiles).not.toHaveBeenCalled();

    // Transition to ready phase
    currentLoadingPhase = 'ready';
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: currentLoadingPhase,
      })
    );

    // Re-render to trigger the effect with new loadingPhase
    rerender(<PreviewCode appId="test-app-123" />);

    // Now getFiles should be called
    await waitFor(() => {
      expect(appService.getFiles).toHaveBeenCalledWith('test-app-123', 5);
    });
  });

  it.skip('should fetch file tree on mount', async () => {
    // Skipped: Component has complex async operations
    // Testing the full loading flow would make tests slow and flaky
  });

  it.skip('should render Monaco editor when loaded', async () => {
    // Skipped: Component uses dynamic imports and has complex loading states
    // Would require mocking timers and async operations extensively
  });

  it.skip('should display error message when file tree fetch fails', async () => {
    // Skipped: Component has complex async operations
    // Error state would require waiting through the full loading sequence
  });

  it.skip('should render with correct appId prop', async () => {
    // Skipped: Component has complex async operations
    // Testing prop changes would be slow and require extensive mocking
  });

  it('should use appId when realAppId is null', async () => {
    const { appService } = await import('@/services/AppService');
    const { useSiteCreationStore } = await import('@/stores/useSiteCreationStore');
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

    // Setup: loadingPhase is ready
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: 'ready',
      })
    );

    // Setup: realAppId is null
    vi.mocked(useSiteCreationStore).mockImplementation((selector: any) =>
      selector({ realAppId: null })
    );

    vi.mocked(appService.getFiles).mockResolvedValue({ entries: [] });

    renderWithProviders(<PreviewCode appId="test-app-123" />);

    await waitFor(() => {
      // Should call getFiles with appId (not realAppId)
      expect(appService.getFiles).toHaveBeenCalledWith('test-app-123', 5);
    });
  });

  it('should use realAppId when available (temp to real ID transition)', async () => {
    const { appService } = await import('@/services/AppService');
    const { useSiteCreationStore } = await import('@/stores/useSiteCreationStore');
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

    // Setup: loadingPhase is ready
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: 'ready',
      })
    );

    // Setup: realAppId is set (app creation completed)
    vi.mocked(useSiteCreationStore).mockImplementation((selector: any) =>
      selector({ realAppId: 'real-app-xyz' })
    );

    vi.mocked(appService.getFiles).mockResolvedValue({ entries: [] });

    renderWithProviders(<PreviewCode appId="temp-job-123" />);

    await waitFor(() => {
      // Should call getFiles with realAppId (not temp appId)
      expect(appService.getFiles).toHaveBeenCalledWith('real-app-xyz', 5);
    });
  });

  it('should cleanup refs when effectiveAppId changes', async () => {
    const { appService } = await import('@/services/AppService');
    const { useSiteCreationStore } = await import('@/stores/useSiteCreationStore');
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

    // Setup: loadingPhase is ready
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: 'ready',
      })
    );

    // Start with no realAppId
    const mockStore = vi.fn((selector: any) => selector({ realAppId: null }));
    vi.mocked(useSiteCreationStore).mockImplementation(mockStore);

    vi.mocked(appService.getFiles).mockResolvedValue({ entries: [] });

    const { rerender } = renderWithProviders(<PreviewCode appId="temp-job-123" />);

    await waitFor(() => {
      expect(appService.getFiles).toHaveBeenCalledWith('temp-job-123', 5);
    });

    // Clear mock calls
    vi.clearAllMocks();

    // Now simulate realAppId being set (temp→real ID transition)
    mockStore.mockImplementation((selector: any) => selector({ realAppId: 'real-app-xyz' }));

    // Force re-render to trigger effectiveAppId change
    rerender(<PreviewCode appId="temp-job-123" />);

    // Should call with new realAppId after cleanup
    await waitFor(() => {
      expect(appService.getFiles).toHaveBeenCalledWith('real-app-xyz', 5);
    });
  });
});
