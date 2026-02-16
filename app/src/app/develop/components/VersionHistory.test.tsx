import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import VersionHistory from './VersionHistory';

let selectedCommitHash: string | null = null;

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
};

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: (selector: any) => selector(mockGitStore),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: any) => selector({ getSite: () => ({ agent_url: 'http://agent' }) }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => ({ data: true }),
}));

vi.mock('@/hooks/useDeploymentsQuery', () => ({
  useDeploymentsQuery: () => ({ data: [] }),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({
    data: mockHistory,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('./utils', () => ({
  useAppIdFromParams: () => 'app-123',
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
    mockHistory = {
      commits: [
        { hash: 'new-hash', message: 'New commit', author: 'A', date: '2024-01-01' },
        { hash: 'old-hash', message: 'Old commit', author: 'B', date: '2023-12-01' },
      ],
      currentCommit: 'old-hash',
    };

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
});
