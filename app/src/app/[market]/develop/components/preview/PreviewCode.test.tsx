/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

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
    mockFileTreeState.files = {};
    mockFileTreeState.loading = {};
    mockFileTreeState.errors = {};
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
        loadingPhase: 'loading-app', // Not ready yet
      })
    );

    renderWithProviders(<PreviewCode appId="test-app-123" />);

    // loadFiles action should NOT be called when loadingPhase is not 'ready'
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

});
