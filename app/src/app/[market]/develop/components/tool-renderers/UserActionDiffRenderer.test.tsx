/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import GitRestoreDiffRenderer from './GitRestoreDiffRenderer.tsx';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_key: string, values?: Record<string, unknown>, fallback?: string) => {
    if (!fallback) return _key;
    if (!values) return fallback;
    // Lightweight ICU-style placeholder substitution so the tests can assert
    // user-visible output without pulling in the real i18n stack.
    return Object.entries(values).reduce<string>(
      (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
      fallback,
    );
  },
}));

vi.mock('@ux/modal', () => ({
  default: ({ children, title, onClose }: any) => (
    <div role="dialog" aria-label={title} data-testid="ux-modal">
      <button data-testid="ux-modal-close" onClick={onClose} type="button">close</button>
      {children}
    </div>
  ),
}));

vi.mock('@ux/tag', () => ({
  default: ({ children, emphasis }: any) => (
    <span data-testid="ux-tag" data-emphasis={emphasis}>{children}</span>
  ),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-id',
}));

const mockQueryReturn = vi.hoisted(() => ({
  current: {
    data: undefined as { diff: string | null; diffTruncated: boolean } | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@/hooks/useUserActionDiff', () => ({
  useUserActionDiffQuery: () => mockQueryReturn.current,
}));

const mockGitHistoryReturn = vi.hoisted(() => ({
  current: {
    data: undefined as { commits: Array<{ hash: string; message: string; author: string; date: string }>; currentCommit: string | null; hasMore: boolean } | undefined,
  },
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => mockGitHistoryReturn.current,
}));

function setGitHistoryCommits(commits: Array<{ hash: string; message: string }>) {
  mockGitHistoryReturn.current = {
    data: {
      commits: commits.map(c => ({ ...c, author: 'tester', date: '2026-05-20T00:00:00Z' })),
      currentCommit: null,
      hasMore: false,
    },
  };
}

function setQueryData(diff: string | null) {
  mockQueryReturn.current = {
    data: { diff, diffTruncated: false },
    isLoading: false,
    isError: false,
  };
}

function setQueryLoading() {
  mockQueryReturn.current = {
    data: undefined,
    isLoading: true,
    isError: false,
  };
}

function setQueryError() {
  mockQueryReturn.current = {
    data: undefined,
    isLoading: false,
    isError: true,
  };
}

const SINGLE_FILE_MODIFIED = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' const c = 4',
].join('\n');

const TWO_FILE_DIFF = [
  // File 1: modified
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,2 +1,2 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  // File 2: created
  'diff --git a/src/bar.ts b/src/bar.ts',
  'new file mode 100644',
  'index 0000000..abcdef0',
  '--- /dev/null',
  '+++ b/src/bar.ts',
  '@@ -0,0 +1,2 @@',
  '+export const bar = 1',
  '+export const baz = 2',
].join('\n');

const DELETED_FILE_DIFF = [
  'diff --git a/src/old.ts b/src/old.ts',
  'deleted file mode 100644',
  'index abcdef0..0000000',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-const x = 1',
  '-const y = 2',
].join('\n');

const RENAMED_FILE_DIFF = [
  'diff --git a/src/old.ts b/src/new.ts',
  'similarity index 100%',
  'rename from src/old.ts',
  'rename to src/new.ts',
].join('\n');

function openModal(headerNamePattern: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: headerNamePattern }));
}

describe('UserActionDiffRenderer', () => {
  beforeEach(() => {
    setQueryData(null);
    mockGitHistoryReturn.current = { data: undefined };
  });

  describe('per-file cards', () => {
    it('renders one card per file with a change-type tag and the file path', () => {
      setQueryData(TWO_FILE_DIFF);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{
            action: 'undo',
            stashHash: 'fedcba9876543210',
          }}
        />,
      );

      openModal(/Restored/);

      const cards = screen.getAllByTestId('user-action-file-card');
      expect(cards).toHaveLength(2);

      expect(cards[0]).toHaveAttribute('data-change-type', 'modified');
      expect(within(cards[0]).getByTestId('user-action-file-path')).toHaveTextContent('src/foo.ts');

      expect(cards[1]).toHaveAttribute('data-change-type', 'added');
      expect(within(cards[1]).getByTestId('user-action-file-path')).toHaveTextContent('src/bar.ts');
    });

    it('omits diff/index/+++ /--- headers from the rendered body — only hunks remain', () => {
      setQueryData(SINGLE_FILE_MODIFIED);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{
            action: 'undo',
            stashHash: 'fedcba9876543210',
          }}
        />,
      );

      openModal(/Restored/);

      const card = screen.getByTestId('user-action-file-card');
      const body = within(card).getByTestId('user-action-file-diff');
      const text = body.textContent ?? '';

      expect(text).not.toContain('diff --git');
      expect(text).not.toContain('index 1234567');
      expect(text).not.toContain('--- a/src/foo.ts');
      expect(text).not.toContain('+++ b/src/foo.ts');
      // Hunk headers (`@@ -... +... @@`) are also stripped — the per-file
      // card communicates which file changed; the line numbers are not
      // useful at this density.
      expect(text).not.toContain('@@');
      expect(text).toContain('-const b = 2');
      expect(text).toContain('+const b = 3');
    });

    it('tags created files with success emphasis', () => {
      setQueryData(TWO_FILE_DIFF);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{ action: 'undo', stashHash: 'abc' }}
        />,
      );

      openModal(/Restored/);
      const cards = screen.getAllByTestId('user-action-file-card');
      const createdCard = cards.find((c) => c.getAttribute('data-change-type') === 'added')!;
      const tag = within(createdCard).getByTestId('ux-tag');
      expect(tag).toHaveAttribute('data-emphasis', 'success');
      expect(tag).toHaveTextContent('Created');
    });

    it('tags deleted files with critical emphasis', () => {
      setQueryData(DELETED_FILE_DIFF);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{ action: 'undo', stashHash: 'abc' }}
        />,
      );

      openModal(/Restored/);
      const card = screen.getByTestId('user-action-file-card');
      expect(card).toHaveAttribute('data-change-type', 'deleted');
      const tag = within(card).getByTestId('ux-tag');
      expect(tag).toHaveAttribute('data-emphasis', 'critical');
      expect(tag).toHaveTextContent('Deleted');
    });

    it('tags renames with both old and new paths and no body when content is unchanged', () => {
      setQueryData(RENAMED_FILE_DIFF);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{ action: 'undo', stashHash: 'abc' }}
        />,
      );

      openModal(/Restored/);
      const card = screen.getByTestId('user-action-file-card');
      expect(card).toHaveAttribute('data-change-type', 'renamed');
      expect(within(card).getByTestId('user-action-file-path')).toHaveTextContent('src/old.ts → src/new.ts');
      // Pure rename has no hunks → body element shouldn't render at all.
      expect(within(card).queryByTestId('user-action-file-diff')).not.toBeInTheDocument();
    });

    it('shows per-file +/- counts in the card header', () => {
      setQueryData(SINGLE_FILE_MODIFIED);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{ action: 'undo', stashHash: 'abc' }}
        />,
      );

      openModal(/Restored/);
      const card = screen.getByTestId('user-action-file-card');
      expect(within(card).getByText('+1 / -1')).toBeInTheDocument();
    });
  });

  describe('summary', () => {
    it('aggregates files + line counts across all parsed sections', () => {
      setQueryData(TWO_FILE_DIFF);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{ action: 'undo', stashHash: 'abc' }}
        />,
      );

      openModal(/Restored/);
      // foo.ts: -1/+1; bar.ts: +2/-0  →  2 files, +3, -1
      expect(screen.getByTestId('user-action-summary')).toHaveTextContent('2 files · +3 / -1');
    });
  });

  describe('lazy fetch states', () => {
    it('shows the loading message while the diff is being fetched', () => {
      setQueryLoading();
      render(
        <GitRestoreDiffRenderer
          toolName="userRestore"
          toolStatus="completed"
          result={{ action: 'restore', commitHash: 'abc1234' }}
        />,
      );

      openModal(/Restored/);
      expect(screen.getByTestId('user-action-diff-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('user-action-file-card')).not.toBeInTheDocument();
    });

    it('shows an error message when the diff fetch fails', () => {
      setQueryError();
      render(
        <GitRestoreDiffRenderer
          toolName="userRestore"
          toolStatus="completed"
          result={{ action: 'restore', commitHash: 'abc1234' }}
        />,
      );

      openModal(/Restored/);
      expect(screen.getByTestId('user-action-diff-error')).toBeInTheDocument();
      expect(screen.queryByTestId('user-action-file-card')).not.toBeInTheDocument();
    });
  });

  describe('no diff captured', () => {
    it('shows the no-diff message for restore notices', () => {
      setQueryData(null);
      render(
        <GitRestoreDiffRenderer
          toolName="userRestore"
          toolStatus="completed"
          result={{ action: 'restore', commitHash: 'abc' }}
        />,
      );

      openModal(/Restored/);
      expect(screen.queryByTestId('user-action-file-card')).not.toBeInTheDocument();
      expect(screen.getByText(/No changes were detected/)).toBeInTheDocument();
    });

    it('shows the no-diff message for clean-tree undos', () => {
      setQueryData(null);
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{ action: 'undo', commitHash: 'abc', stashHash: null }}
        />,
      );

      openModal(/Restored/);
      expect(screen.queryByTestId('user-action-file-card')).not.toBeInTheDocument();
      expect(screen.getByText(/No changes were detected/)).toBeInTheDocument();
    });
  });

  describe('header text', () => {
    it('looks up the restored commit subject from cached git history', () => {
      setGitHistoryCommits([
        { hash: 'deadbee', message: 'Add login form' },
        { hash: 'cafef00', message: 'Unrelated commit' },
      ]);
      render(
        <GitRestoreDiffRenderer
          toolName="userRestore"
          toolStatus="completed"
          result={{ action: 'restore', commitHash: 'deadbee', restoredCommitHash: 'deadbee' }}
        />,
      );

      expect(screen.getByText('Restored to: "Add login form"')).toBeInTheDocument();
    });

    it('falls back to the generic header on a stash-only undo (no restoredCommitHash)', () => {
      render(
        <GitRestoreDiffRenderer
          toolName="userUndo"
          toolStatus="completed"
          result={{ action: 'undo', commitHash: null, stashHash: null }}
        />,
      );

      expect(screen.getByText('Restored recent changes')).toBeInTheDocument();
    });

    it('falls back to the generic header when the target commit is outside the loaded history window', () => {
      // History loaded but target hash isn't among the returned commits — e.g.
      // the user restored to a commit older than the 30-commit page.
      setGitHistoryCommits([
        { hash: 'cafef00', message: 'Some other commit' },
      ]);
      render(
        <GitRestoreDiffRenderer
          toolName="userRestore"
          toolStatus="completed"
          result={{ action: 'restore', commitHash: 'deadbee', restoredCommitHash: 'deadbee' }}
        />,
      );

      expect(screen.getByText('Restored recent changes')).toBeInTheDocument();
    });

    it('falls back to the generic header while git history is still loading', () => {
      // mockGitHistoryReturn defaults to { data: undefined } in beforeEach.
      render(
        <GitRestoreDiffRenderer
          toolName="userRestore"
          toolStatus="completed"
          result={{ action: 'restore', commitHash: 'deadbee', restoredCommitHash: 'deadbee' }}
        />,
      );

      expect(screen.getByText('Restored recent changes')).toBeInTheDocument();
    });

    it('falls back to the generic header when the resolved commit subject is whitespace only', () => {
      setGitHistoryCommits([
        { hash: 'deadbee', message: '   ' },
      ]);
      render(
        <GitRestoreDiffRenderer
          toolName="userRestore"
          toolStatus="completed"
          result={{ action: 'restore', commitHash: 'deadbee', restoredCommitHash: 'deadbee' }}
        />,
      );

      expect(screen.getByText('Restored recent changes')).toBeInTheDocument();
    });
  });
});
