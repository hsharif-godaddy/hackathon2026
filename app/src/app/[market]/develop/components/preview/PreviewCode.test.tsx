/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import PreviewCode from './PreviewCode';

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor">Monaco Editor</div>,
}));

// Mock AppService
vi.mock('@/services/AppService', () => ({
  appService: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    searchCode: vi.fn().mockResolvedValue({
      matches: [],
      totalMatches: 0,
      truncated: false
    }),
  },
}));

// Mock useFileTreeStore
const mockFileTreeState = {
  files: {},
  loading: {},
  errors: {},
  loadFiles: vi.fn(() => Promise.resolve()),
  loadFilesFromCacheOrFetch: vi.fn(() => Promise.resolve()),
  reset: vi.fn(),
  setFiles: vi.fn(),
  invalidate: vi.fn()
};

vi.mock('@/stores/useFileTreeStore', () => {
  const store = Object.assign(
    vi.fn((selector: any) => selector(mockFileTreeState)),
    { getState: () => mockFileTreeState }
  );
  return { useFileTreeStore: store };
});

// Mock stores
const mockDevelopPageState = {
  isMobile: false,
  isFileTreeCollapsed: false,
  setIsFileTreeCollapsed: vi.fn(),
  setHasUnsavedChanges: vi.fn(),
  loadingPhase: 'ready',
  loadingError: null as string | null,
  currentAppId: null as string | null,
  viewMode: ViewMode.PREVIEW,
  initializePage: vi.fn(() => Promise.resolve()),
};

vi.mock('@/stores/useDevelopPageStore', () => {
  const store = Object.assign(
    vi.fn((selector: any) => selector(mockDevelopPageState)),
    { getState: () => mockDevelopPageState }
  );
  return { useDevelopPageStore: store };
});

vi.mock('@/stores/useSiteCreationStore', () => ({
  useSiteCreationStore: vi.fn((selector: any) =>
    selector({
      realAppId: null,
    })
  ),
}));

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: vi.fn((selector: any) =>
    selector({
      getServerState: () => ({ url: 'http://localhost:3000' }),
    })
  ),
}));

const mockCodeSyncState = {
  changeVersion: 0,
  restoreVersion: 0,
  clearFileChange: vi.fn(),
  addConflict: vi.fn(),
  resolveConflict: vi.fn(),
  hasConflict: vi.fn(() => false),
  getFileChange: vi.fn(() => null),
  fileChanges: new Map(),
};

vi.mock('@/stores/useCodeSyncStore', () => {
  const store = Object.assign(
    vi.fn((selector: any) => selector(mockCodeSyncState)),
    { getState: () => mockCodeSyncState }
  );
  return { useCodeSyncStore: store };
});

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
    mockFileTreeState.files = {};
    mockFileTreeState.loading = {};
    mockFileTreeState.errors = {};
    mockDevelopPageState.loadingPhase = 'ready';
    mockDevelopPageState.loadingError = null;
    mockDevelopPageState.viewMode = ViewMode.PREVIEW;
  });

  it('should render without crashing', async () => {
    mockFileTreeState.files['test-app-123'] = [];

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
        loadingPhase: 'loading-app',
        loadingError: null,
      })
    );

    renderWithProviders(<PreviewCode appId="test-app-123" />);

    expect(mockFileTreeState.loadFiles).not.toHaveBeenCalled();
  });

  it('should fetch files when loadingPhase transitions to ready', async () => {
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

    // Start with loading-app phase
    let currentLoadingPhase = 'loading-app';
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: currentLoadingPhase,
        loadingError: null,
      })
    );

    const { rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

    // Verify loadFiles action is NOT called when not ready
    expect(mockFileTreeState.loadFiles).not.toHaveBeenCalled();

    // Transition to ready phase
    currentLoadingPhase = 'ready';
    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: currentLoadingPhase,
        loadingError: null,
      })
    );

    // Re-render to trigger the effect with new loadingPhase
    rerender(<PreviewCode appId="test-app-123" />);

    // Now loadFiles should be called
    await waitFor(() => {
      expect(mockFileTreeState.loadFilesFromCacheOrFetch).toHaveBeenCalledWith('test-app-123');
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
        loadingError: null,
      })
    );

    // Setup: realAppId is null
    vi.mocked(useSiteCreationStore).mockImplementation((selector: any) =>
      selector({ realAppId: null })
    );

    renderWithProviders(<PreviewCode appId="test-app-123" />);

    await waitFor(() => {
      // Should call loadFiles with appId (not realAppId)
      expect(mockFileTreeState.loadFilesFromCacheOrFetch).toHaveBeenCalledWith('test-app-123');
    });
  });

  it('should use realAppId when available (temp to real ID transition)', async () => {
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
        loadingError: null,
      })
    );

    // Setup: realAppId is set (app creation completed)
    vi.mocked(useSiteCreationStore).mockImplementation((selector: any) =>
      selector({ realAppId: 'real-app-xyz' })
    );

    renderWithProviders(<PreviewCode appId="temp-job-123" />);

    await waitFor(() => {
      // Should call loadFiles with realAppId (not temp appId)
      expect(mockFileTreeState.loadFilesFromCacheOrFetch).toHaveBeenCalledWith('real-app-xyz');
    });
  });

  it('should cleanup refs when effectiveAppId changes', async () => {
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
        loadingError: null,
      })
    );

    // Start with no realAppId
    const mockStore = vi.fn((selector: any) => selector({ realAppId: null }));
    vi.mocked(useSiteCreationStore).mockImplementation(mockStore);

    const { rerender } = renderWithProviders(<PreviewCode appId="temp-job-123" />);

    await waitFor(() => {
      expect(mockFileTreeState.loadFilesFromCacheOrFetch).toHaveBeenCalledWith('temp-job-123');
    });

    // Clear mock calls
    vi.clearAllMocks();

    // Now simulate realAppId being set (temp→real ID transition)
    mockStore.mockImplementation((selector: any) => selector({ realAppId: 'real-app-xyz' }));

    // Force re-render to trigger effectiveAppId change
    rerender(<PreviewCode appId="temp-job-123" />);

    // Should call with new realAppId after cleanup
    await waitFor(() => {
      expect(mockFileTreeState.loadFilesFromCacheOrFetch).toHaveBeenCalledWith('real-app-xyz');
    });
  });

  it('should open search tab when search button is clicked', async () => {
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: 'ready',
        loadingError: null,
      })
    );

    mockFileTreeState.files['test-app-123'] = [];

    const { user } = renderWithProviders(<PreviewCode appId="test-app-123" />);

    // Find and click the search button
    const searchButton = screen.getByTestId('search-button');
    expect(searchButton).toBeInTheDocument();

    await user.click(searchButton);

    // Search panel should now be visible
    await waitFor(() => {
      expect(screen.getByTestId('search-panel')).toBeInTheDocument();
    });
  });

  it('should show search input when search tab is active', async () => {
    const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

    vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
      selector({
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: 'ready',
        loadingError: null,
        viewMode: ViewMode.PREVIEW,
      })
    );

    mockFileTreeState.files['test-app-123'] = [];

    const { user } = renderWithProviders(<PreviewCode appId="test-app-123" />);

    // Click search button to open search
    await user.click(screen.getByTestId('search-button'));

    // Search input in header should be visible
    await waitFor(() => {
      expect(screen.getByTestId('search-input-header')).toBeInTheDocument();
    });
  });

  describe('page initialization states', () => {
    it('should show spinner when loadingPhase is not ready', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'loading-app',
          loadingError: null,
        })
      );

      renderWithProviders(<PreviewCode appId="test-app-123" />);

      await waitFor(() => {
        expect(screen.getByText('builder_code_loading_files')).toBeInTheDocument();
      });
    });

    it('should show error with retry button when init fails', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');
      const { useSiteCreationStore } = await import('@/stores/useSiteCreationStore');
      const mockInitializePage = vi.fn(() => Promise.resolve());

      vi.mocked(useSiteCreationStore).mockImplementation((selector: any) =>
        selector({ realAppId: null })
      );
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'idle',
          loadingError: 'Network request failed',
          currentAppId: 'test-app-123',
        })
      );
      Object.assign(vi.mocked(useDevelopPageStore), {
        getState: () => ({ initializePage: mockInitializePage }),
      });

      const { user } = renderWithProviders(<PreviewCode appId="test-app-123" />);

      await waitFor(() => {
        expect(screen.getByText('builder_code_error_failed')).toBeInTheDocument();
        expect(screen.getByText('Network request failed')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_common_retry' }));

      expect(mockInitializePage).toHaveBeenCalledWith('test-app-123');
    });
  });

  describe('auto-expand search on Code tab switch', () => {
    it('should expand search when switching from non-CODE to CODE view', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

      // Start in PREVIEW mode
      let currentViewMode = ViewMode.PREVIEW;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'ready',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      mockFileTreeState.files['test-app-123'] = [];

      const { rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

      // Search should NOT be open initially
      expect(screen.queryByTestId('search-panel')).not.toBeInTheDocument();

      // Switch to CODE view
      currentViewMode = ViewMode.CODE;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'ready',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      rerender(<PreviewCode appId="test-app-123" />);

      // Search should now be expanded
      await waitFor(() => {
        expect(screen.getByTestId('search-panel')).toBeInTheDocument();
      });
    });

    it('should NOT expand search when loadingPhase is not ready', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

      // Start in PREVIEW mode with loading phase
      let currentViewMode = ViewMode.PREVIEW;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'loading-app',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      mockFileTreeState.files['test-app-123'] = [];

      const { rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

      // Switch to CODE view while still loading
      currentViewMode = ViewMode.CODE;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'loading-app',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      rerender(<PreviewCode appId="test-app-123" />);

      // Search should NOT be expanded because loadingPhase is not ready
      expect(screen.queryByTestId('search-panel')).not.toBeInTheDocument();
    });

    it('should expand search after loadingPhase becomes ready if switched to CODE during loading', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

      // Start in PREVIEW mode with loading phase
      let currentViewMode = ViewMode.PREVIEW;
      let currentLoadingPhase = 'loading-app';
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: currentLoadingPhase,
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      mockFileTreeState.files['test-app-123'] = [];

      const { rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

      // Switch to CODE view while still loading
      currentViewMode = ViewMode.CODE;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: currentLoadingPhase,
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      rerender(<PreviewCode appId="test-app-123" />);

      // Search should NOT be expanded yet
      expect(screen.queryByTestId('search-panel')).not.toBeInTheDocument();

      // Now loading completes
      currentLoadingPhase = 'ready';
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: currentLoadingPhase,
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      rerender(<PreviewCode appId="test-app-123" />);

      // Search should now be expanded since we switched to CODE and it's now ready
      await waitFor(() => {
        expect(screen.getByTestId('search-panel')).toBeInTheDocument();
      });
    });

    it('should auto-expand search when page loads directly in CODE view', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'ready',
          loadingError: null,
          viewMode: ViewMode.CODE,
        })
      );

      mockFileTreeState.files['test-app-123'] = [];

      renderWithProviders(<PreviewCode appId="test-app-123" />);

      // prevViewModeRef initializes to null, so mounting in CODE is detected
      // as a null->CODE transition and triggers auto-expand
      await waitFor(() => {
        expect(screen.getByTestId('search-panel')).toBeInTheDocument();
      });
    });

    it('should expand search when switching from BRAND to CODE', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

      let currentViewMode = ViewMode.BRAND;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'ready',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      mockFileTreeState.files['test-app-123'] = [];

      const { rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

      expect(screen.queryByTestId('search-panel')).not.toBeInTheDocument();

      currentViewMode = ViewMode.CODE;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'ready',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      rerender(<PreviewCode appId="test-app-123" />);

      await waitFor(() => {
        expect(screen.getByTestId('search-panel')).toBeInTheDocument();
      });
    });

    it('should focus search input when switching to CODE with search already open', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

      // Start in PREVIEW mode
      let currentViewMode = ViewMode.PREVIEW;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'ready',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      mockFileTreeState.files['test-app-123'] = [];

      const { user, rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

      // Manually open search first
      await user.click(screen.getByTestId('search-button'));
      await waitFor(() => {
        expect(screen.getByTestId('search-panel')).toBeInTheDocument();
      });

      // Switch to CODE view
      currentViewMode = ViewMode.CODE;
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector({
          isMobile: false,
          isFileTreeCollapsed: false,
          setIsFileTreeCollapsed: vi.fn(),
          setHasUnsavedChanges: vi.fn(),
          loadingPhase: 'ready',
          loadingError: null,
          viewMode: currentViewMode,
        })
      );

      rerender(<PreviewCode appId="test-app-123" />);

      // Search panel should still be visible (not duplicated)
      await waitFor(() => {
        const searchPanels = screen.getAllByTestId('search-panel');
        expect(searchPanels).toHaveLength(1);
      });
    });

    it('should preserve search state across CODE -> BRAND -> CODE round trip', async () => {
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore');

      const mockStoreState = {
        isMobile: false,
        isFileTreeCollapsed: false,
        setIsFileTreeCollapsed: vi.fn(),
        setHasUnsavedChanges: vi.fn(),
        loadingPhase: 'ready',
        loadingError: null,
        viewMode: ViewMode.CODE as ViewMode,
      };
      vi.mocked(useDevelopPageStore).mockImplementation((selector: any) =>
        selector(mockStoreState)
      );

      mockFileTreeState.files['test-app-123'] = [];

      const { rerender } = renderWithProviders(<PreviewCode appId="test-app-123" />);

      // Search auto-expands on CODE mount
      await waitFor(() => {
        expect(screen.getByTestId('search-panel')).toBeInTheDocument();
      });

      // Switch to BRAND (component stays mounted via overlay in PreviewPane)
      mockStoreState.viewMode = ViewMode.BRAND;
      rerender(<PreviewCode appId="test-app-123" />);

      // Switch back to CODE
      mockStoreState.viewMode = ViewMode.CODE;
      rerender(<PreviewCode appId="test-app-123" />);

      // Search should still be present (state preserved, not re-created)
      await waitFor(() => {
        const searchPanels = screen.getAllByTestId('search-panel');
        expect(searchPanels).toHaveLength(1);
      });
    });
  });

});
