/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import VersionHistory from './VersionHistory';

// Mock UXCore Tooltip to verify it renders with correct props and ARIA attributes
vi.mock('@ux/tooltip', () => ({
  default: ({ children, id }: { children: ReactNode; id?: string; anchorRef?: any; portalElem?: any }) => (
    <div data-testid="tooltip" id={id} role="tooltip">{children}</div>
  ),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

let selectedCommitHash: string | null = null;
let mockAppId = 'app-123'
let mockActiveChatTab = 'history'
let mockIsHistoryDisabled = false
let mockIsPublishing = false

const mockGitStore = {
  getSelectedCommitHash: vi.fn(),
  isSelectingCommit: false,
  commitSelectionError: null,
  selectCommit: vi.fn(),
  setSelectedCommitHash: vi.fn(),
  setCommitSelectionError: vi.fn(),
};

const mockUpdateCommitMessageMutation = {
  isPending: false,
  mutateAsync: vi.fn(),
};

const mockRestoreMutation = {
  mutate: vi.fn(),
  isPending: false,
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
  useSwitchboard: () => (true),
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({ activeChatTab: mockActiveChatTab }),
}));

vi.mock('@/hooks/useRestoreCommitMutation', () => ({
  useRestoreCommitMutation: () => mockRestoreMutation,
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

vi.mock('@/hooks/useUpdateCommitMessageMutation', () => ({
  useUpdateCommitMessageMutation: () => mockUpdateCommitMessageMutation,
}));

vi.mock('@/hooks/useIsHistoryDisabled', () => ({
  useIsHistoryDisabled: (_appId: string, _isRestoring?: boolean) => ({
    isDisabled: mockIsHistoryDisabled,
    isPublishing: mockIsPublishing,
  }),
}));

describe('VersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGitStore.isSelectingCommit = false;
    mockGitStore.commitSelectionError = null;
    selectedCommitHash = null;
    mockAppId = 'app-123'
    mockActiveChatTab = 'history'
    mockIsHistoryDisabled = false
    mockIsPublishing = false
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

    mockGitStore.getSelectedCommitHash.mockImplementation(function () { return selectedCommitHash; });
    mockGitStore.setSelectedCommitHash.mockImplementation(function (_appId: string, hash: string) {
      selectedCommitHash = hash;
    });
    mockUpdateCommitMessageMutation.isPending = false;
    mockUpdateCommitMessageMutation.mutateAsync.mockResolvedValue({
      success: true,
      newCommitHash: 'updated-hash',
    });
    mockRestoreMutation.isPending = false;
    mockRestoreMutation.mutate.mockClear();
  });

  it('renders hex then color swatch after hex in commit messages', async () => {
    mockHistory = {
      commits: [
        {
          hash: 'color-hash',
          message: 'Update p color to #bcc12f in index.tsx',
          author: 'A',
          date: '2024-01-01',
        },
      ],
      currentCommit: 'color-hash',
      hasMore: false,
    };

    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(screen.getByTestId('commit-message-hex-swatch')).toBeInTheDocument();
      expect(screen.getByText('#BCC12F')).toBeInTheDocument();
    });

    const hex = screen.getByText('#BCC12F');
    const swatch = screen.getByTestId('commit-message-hex-swatch');
    expect(hex.compareDocumentPosition(swatch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render hex swatches when commit message has no hex color', async () => {
    mockHistory = {
      commits: [
        { hash: 'plain-hash', message: 'Update h2 fontSize to text-5xl', author: 'A', date: '2024-01-01' },
      ],
      currentCommit: 'plain-hash',
      hasMore: false,
    };

    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(screen.getByText('Update h2 fontSize to text-5xl')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('commit-message-hex-swatch')).not.toBeInTheDocument();
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

  it('shows i18n switch error copy instead of technical commitSelectionError', async function switchErrorCopy() {
    mockGitStore.commitSelectionError = 'Failed to return to latest version: 400';

    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(screen.getByText('builder_version_history_switch_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_version_history_switch_error_description')).toBeInTheDocument();
    });
    expect(screen.queryByText(mockGitStore.commitSelectionError!)).not.toBeInTheDocument();
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

  it('allows editing only the latest commit message and saves on Enter', async () => {
    mockHistory = {
      ...mockHistory,
      currentCommit: 'new-hash',
    }

    const { user } = renderWithProviders(<VersionHistory />);

    const editButtons = screen.getAllByRole('button', { name: 'builder_common_edit' });
    expect(editButtons).toHaveLength(1);

    await user.click(editButtons[0]);

    const input = screen.getByDisplayValue('New commit');
    await user.clear(input);
    await user.type(input, 'Renamed latest commit{enter}');

    await waitFor(() => {
      expect(mockUpdateCommitMessageMutation.mutateAsync).toHaveBeenCalledWith({
        appId: 'app-123',
        message: 'Renamed latest commit',
        expectedHash: 'new-hash',
      });
    });
  });

  it('does not show edit action when latest commit is not current commit', async () => {
    mockHistory = {
      ...mockHistory,
      currentCommit: 'old-hash',
    }

    renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'builder_common_edit' })).not.toBeInTheDocument()
    })
  })

  it('cancels edit on blur without saving', async () => {
    mockHistory = {
      ...mockHistory,
      currentCommit: 'new-hash',
    }

    const { user } = renderWithProviders(<VersionHistory />);
    const editButton = screen.getByRole('button', { name: 'builder_common_edit' })
    await user.click(editButton)

    const input = screen.getByDisplayValue('New commit')
    await user.clear(input)
    await user.type(input, 'Blur should not save')
    await user.tab()

    await waitFor(() => {
      expect(mockUpdateCommitMessageMutation.mutateAsync).not.toHaveBeenCalled()
      expect(screen.queryByDisplayValue('Blur should not save')).not.toBeInTheDocument()
    })
  })

  it('shows edit error and stays in edit mode when save fails', async () => {
    mockHistory = {
      ...mockHistory,
      currentCommit: 'new-hash',
    }
    mockUpdateCommitMessageMutation.mutateAsync.mockRejectedValue(new Error('Commit amend failed'))

    const { user } = renderWithProviders(<VersionHistory />);
    await user.click(screen.getByRole('button', { name: 'builder_common_edit' }))

    const input = screen.getByDisplayValue('New commit')
    await user.clear(input)
    await user.type(input, 'Will fail{enter}')

    await waitFor(() => {
      expect(screen.getByText('builder_version_history_edit_error')).toBeInTheDocument()
      expect(screen.getByText('Commit amend failed')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Will fail')).toBeInTheDocument()
    })
  })

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

  describe('when history is disabled', () => {
    beforeEach(() => {
      mockIsHistoryDisabled = true
      mockIsPublishing = true
      selectedCommitHash = 'old-hash'
    })

    it('does not select commit when clicking on commit row', async () => {
      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        expect(screen.getByText('New commit')).toBeInTheDocument()
      })

      const commitButtons = screen.getAllByTestId('commit-selection-button')
      expect(commitButtons[0]).toBeDisabled()

      await user.click(commitButtons[0])

      expect(mockGitStore.selectCommit).not.toHaveBeenCalled()
    })

    it('disables edit button on latest commit', async () => {
      mockHistory = {
        ...mockHistory,
        currentCommit: 'new-hash',
      }

      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        const editButton = screen.getByRole('button', { name: 'builder_common_edit' })
        expect(editButton).toBeDisabled()
      })

      const editButton = screen.getByRole('button', { name: 'builder_common_edit' })
      await user.click(editButton)

      // Should not enter edit mode
      expect(screen.queryByDisplayValue('New commit')).not.toBeInTheDocument()
    })

    it('disables load more button', async () => {
      mockHistory = {
        ...mockHistory,
        hasMore: true,
      }

      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'builder_version_history_load_more' })).toBeInTheDocument()
      })

      const loadMoreButton = screen.getByRole('button', { name: 'builder_version_history_load_more' })
      expect(loadMoreButton).toBeDisabled()

      await user.click(loadMoreButton)

      // Should not trigger pagination
      expect(screen.getAllByText(/commit/i)).toHaveLength(2)
    })

    it('disables date group collapse buttons', async () => {
      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        expect(screen.getByText('New commit')).toBeInTheDocument()
      })

      const dateGroupButtons = screen.getAllByTestId('date-group-toggle')
      expect(dateGroupButtons.length).toBeGreaterThan(0)

      const dateGroupButton = dateGroupButtons[0]
      expect(dateGroupButton).toBeDisabled()

      // Get initial state - should show commits
      const commitsBefore = screen.getAllByText(/commit/i)
      expect(commitsBefore.length).toBeGreaterThan(0)

      await user.click(dateGroupButton)

      // Commits should still be visible (not collapsed)
      const commitsAfter = screen.getAllByText(/commit/i)
      expect(commitsAfter.length).toBe(commitsBefore.length)
    })

    it('disables restore button for non-latest commits', async () => {
      mockHistory = {
        commits: [
          { hash: 'latest-hash', message: 'Latest', author: 'A', date: '2024-01-02' },
          { hash: 'old-hash', message: 'Old commit', author: 'B', date: '2024-01-01' },
        ],
        currentCommit: 'latest-hash',
        hasMore: false,
      }
      selectedCommitHash = 'old-hash'

      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        expect(screen.getByText('builder_preview_error_restore')).toBeInTheDocument()
      })

      const restoreButton = screen.getByRole('button', { name: 'builder_preview_error_restore' })
      expect(restoreButton).toBeDisabled()

      await user.click(restoreButton)

      // Should not trigger restore
      await waitFor(() => {
        expect(restoreButton).toHaveTextContent('builder_preview_error_restore')
      })
    })

    it('disables all history interactions while a restore is in progress', async () => {
      mockHistory = {
        commits: [
          { hash: 'latest-hash', message: 'Latest', author: 'A', date: '2024-01-02' },
          { hash: 'old-hash', message: 'Old commit', author: 'B', date: '2024-01-01' },
        ],
        currentCommit: 'latest-hash',
        hasMore: false,
      }
      selectedCommitHash = 'old-hash'
      mockRestoreMutation.isPending = true
      mockIsHistoryDisabled = true

      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        expect(screen.getByText('Latest')).toBeInTheDocument()
      })

      // All commit buttons should be disabled
      const commitButtons = screen.getAllByTestId('commit-selection-button')
      commitButtons.forEach(btn => {
        expect(btn).toBeDisabled()
      })

      // Try clicking on a commit
      await user.click(commitButtons[0])
      expect(mockGitStore.selectCommit).not.toHaveBeenCalled()

      // Restore button should be disabled
      const restoreButton = screen.getByRole('button', { name: 'builder_preview_error_restore' })
      expect(restoreButton).toBeDisabled()
    })

    it('shows tooltip on hover over disabled commit and links it via aria-describedby', async () => {
      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        expect(screen.getByText('New commit')).toBeInTheDocument()
      })

      // Get the commit container by its test id
      const commitContainers = screen.getAllByTestId('commit-item-container')
      const commitContainer = commitContainers[0]
      expect(commitContainer).toBeInTheDocument()

      // Tooltip should not be visible initially
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      // Hover over the disabled commit container
      await user.hover(commitContainer)

      // Tooltip should appear
      await waitFor(() => {
        const tooltip = screen.getByRole('tooltip')
        expect(tooltip).toBeInTheDocument()

        // Verify ARIA linkage: aria-describedby should point to tooltip's id
        const tooltipId = tooltip.getAttribute('id')
        expect(tooltipId).toBeTruthy()
        expect(commitContainer).toHaveAttribute('aria-describedby', tooltipId)

        // Verify tooltip content for publish state
        expect(tooltip).toHaveTextContent('builder_version_history_disabled_during_publish')
      })

      // Unhover
      await user.unhover(commitContainer)

      // Tooltip should disappear
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      })
    })

    it('shows correct tooltip message during restore operation', async () => {
      mockRestoreMutation.isPending = true

      const { user } = renderWithProviders(<VersionHistory />);

      await waitFor(() => {
        expect(screen.getByText('New commit')).toBeInTheDocument()
      })

      // Get the commit container by its test id
      const commitContainer = screen.getAllByTestId('commit-item-container')[0]

      // Hover over the disabled commit
      await user.hover(commitContainer)

      // Tooltip should show restore message
      await waitFor(() => {
        const tooltip = screen.getByRole('tooltip')
        expect(tooltip).toHaveTextContent('builder_version_history_disabled_during_restore')
      })
    })
  })

  it('triggers restore mutation when restore button is clicked', async () => {
    mockHistory = {
      commits: [
        { hash: 'latest-hash', message: 'Latest', author: 'A', date: '2024-01-02' },
        { hash: 'old-hash', message: 'Old commit', author: 'B', date: '2024-01-01' },
      ],
      currentCommit: 'latest-hash',
      hasMore: false,
    }
    selectedCommitHash = 'old-hash'

    const { user } = renderWithProviders(<VersionHistory />);

    await waitFor(() => {
      expect(screen.getByText('builder_preview_error_restore')).toBeInTheDocument()
    })

    const restoreButton = screen.getByRole('button', { name: 'builder_preview_error_restore' })
    await user.click(restoreButton)

    // Should trigger the restore mutation
    expect(mockRestoreMutation.mutate).toHaveBeenCalledWith(
      { appId: 'app-123', commitHash: 'old-hash' },
      expect.any(Object)
    )
  })
});
