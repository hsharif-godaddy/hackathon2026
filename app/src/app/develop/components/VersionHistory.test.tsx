/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import VersionHistory from './VersionHistory';

let selectedCommitHash: string | null = null;
let mockAppId = 'app-123'
let mockActiveChatTab = 'history'

const mockGitStore = {
  getSelectedCommitHash: vi.fn(),
  isSelectingCommit: false,
  commitSelectionError: null,
  selectCommit: vi.fn(),
  setSelectedCommitHash: vi.fn(),
  setCommitSelectionError: vi.fn(),
};

let mockHistory = {
  commits: [
    { hash: 'new-hash', message: 'New commit', author: 'A', date: '2024-01-01' },
    { hash: 'old-hash', message: 'Old commit', author: 'B', date: '2023-12-01' },
  ],
  currentCommit: 'old-hash',
  hasMore: false,
};

const pageData: Record<string, typeof mockHistory> = {}

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: (selector: any) => selector(mockGitStore),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: any) => selector({ getSite: () => ({ agent_url: 'http://agent' }) }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => ({ data: true }),
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({ activeChatTab: mockActiveChatTab }),
}));

vi.mock('@/hooks/useRestoreCommitMutation', () => ({
  useRestoreCommitMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/useDeploymentsQuery', () => ({
  useDeploymentsQuery: () => ({ data: [] }),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: ({ appId, offset }: { appId: string; offset?: number }) => ({
    data: pageData[`${appId}:${offset ?? 0}`] ?? mockHistory,
    isLoading: false,
    error: null,
    isFetching: false,
  }),
}));

vi.mock('./utils', () => ({
  useAppIdFromParams: () => mockAppId,
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('VersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGitStore.isSelectingCommit = false;
    mockGitStore.commitSelectionError = null;
    selectedCommitHash = null;
    mockAppId = 'app-123'
    mockActiveChatTab = 'history'
    mockHistory = {
      commits: [
        { hash: 'new-hash', message: 'New commit', author: 'A', date: '2024-01-01' },
        { hash: 'old-hash', message: 'Old commit', author: 'B', date: '2023-12-01' },
      ],
      currentCommit: 'old-hash',
      hasMore: false,
    };
    Object.keys(pageData).forEach((key) => {
      delete pageData[key]
    })

    mockGitStore.getSelectedCommitHash.mockImplementation(() => selectedCommitHash);
    mockGitStore.setSelectedCommitHash.mockImplementation((_appId: string, hash: string) => {
      selectedCommitHash = hash;
    });
  });

  it('auto-selects currentCommit on initial load', async () => {
    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).toHaveBeenCalledWith('app-123', 'old-hash');
    });
  });

  it('auto-selects when currentCommit changes and selection has not moved', async () => {
    const { rerender } = renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).toHaveBeenCalledWith('app-123', 'old-hash');
    });

    mockHistory = {
      ...mockHistory,
      currentCommit: 'new-hash',
    };

    rerender(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).toHaveBeenCalledWith('app-123', 'new-hash');
    });
  });

  it('does not overwrite a newer selected commit with stale currentCommit', async () => {
    selectedCommitHash = 'new-hash';

    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).not.toHaveBeenCalled();
    });
  });

  it('does not override manual selection of an older commit', async () => {
    mockHistory = {
      ...mockHistory,
      currentCommit: 'new-hash',
    };

    const { rerender } = renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).toHaveBeenCalledWith('app-123', 'new-hash');
    });

    selectedCommitHash = 'old-hash';
    mockGitStore.setSelectedCommitHash.mockClear();

    rerender(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).not.toHaveBeenCalled();
    });
  });

  it('skips auto-select when selection is in progress or error is present', async () => {
    mockGitStore.isSelectingCommit = true;

    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).not.toHaveBeenCalled();
    });

    mockGitStore.isSelectingCommit = false;
    mockGitStore.commitSelectionError = 'error';

    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).not.toHaveBeenCalled();
    });
  });

  it('does not trigger auto-select on re-render when commits array has same data', async () => {
    // Set up initial state where auto-select has already run
    mockGitStore.getSelectedCommitHash.mockReturnValue('new-hash');
    selectedCommitHash = 'new-hash';

    const { rerender } = renderWithProviders(<VersionHistory />);

    // Wait for initial render
    await waitFor(() => {
      expect(mockGitStore.setSelectedCommitHash).not.toHaveBeenCalled();
    });

    // Clear any previous calls
    mockGitStore.setSelectedCommitHash.mockClear();

    // Force re-render (simulating what happens during resize)
    // The commits data is the same, so auto-select should NOT run again
    rerender(<VersionHistory />);

    await waitFor(() => {
      // setSelectedCommitHash should NOT be called because commits haven't changed
      expect(mockGitStore.setSelectedCommitHash).not.toHaveBeenCalled();
    });
  });

  it('loads next page and appends without duplicates', async () => {
    pageData['app-123:0'] = {
      commits: [
        { hash: 'hash-1', message: 'Commit 1', author: 'A', date: '2024-01-01' },
        { hash: 'hash-2', message: 'Commit 2', author: 'A', date: '2024-01-01' },
      ],
      currentCommit: 'hash-1',
      hasMore: true,
    }
    pageData['app-123:30'] = {
      commits: [
        { hash: 'hash-2', message: 'Commit 2', author: 'A', date: '2024-01-01' },
        { hash: 'hash-3', message: 'Commit 3', author: 'A', date: '2024-01-01' },
      ],
      currentCommit: 'hash-1',
      hasMore: false,
    }

    const { user } = renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(screen.getByText('Commit 1')).toBeInTheDocument()
      expect(screen.getByText('Commit 2')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'builder_version_history_load_more' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'builder_version_history_load_more' }))

    await waitFor(() => {
      expect(screen.getByText('Commit 3')).toBeInTheDocument()
      expect(screen.getAllByText('Commit 2')).toHaveLength(1)
      expect(screen.queryByRole('button', { name: 'builder_version_history_load_more' })).not.toBeInTheDocument()
    })
  })

  it('resets pagination when app changes', async () => {
    pageData['app-123:0'] = {
      commits: [
        { hash: 'a1', message: 'A1', author: 'A', date: '2024-01-01' },
      ],
      currentCommit: 'a1',
      hasMore: true,
    }
    pageData['app-123:30'] = {
      commits: [
        { hash: 'a2', message: 'A2', author: 'A', date: '2024-01-01' },
      ],
      currentCommit: 'a1',
      hasMore: false,
    }
    pageData['app-456:0'] = {
      commits: [
        { hash: 'b1', message: 'B1', author: 'B', date: '2024-01-01' },
      ],
      currentCommit: 'b1',
      hasMore: false,
    }

    const { rerender, user } = renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(screen.getByText('A1')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'builder_version_history_load_more' }))

    await waitFor(() => {
      expect(screen.getByText('A2')).toBeInTheDocument()
    })

    mockAppId = 'app-456'
    rerender(<VersionHistory />)

    await waitFor(() => {
      expect(screen.getByText('B1')).toBeInTheDocument()
      expect(screen.queryByText('A2')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'builder_version_history_load_more' })).not.toBeInTheDocument()
    })
  })
});
