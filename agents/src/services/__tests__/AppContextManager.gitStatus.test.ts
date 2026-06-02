import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn()
}));

vi.mock('../../tools/directory-listing.js', () => ({
  DirectoryListingTool: vi.fn().mockImplementation(function () { return {
    listDirectory: vi.fn().mockResolvedValue('')
  }; })
}));

vi.mock('../../tools/app-plan-tool.js', () => ({
  appPlanTool: { execute: vi.fn().mockResolvedValue({ success: false }) }
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }; })
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../logging/events/index.js', () => ({
  appContextEvents: {
    generateBegin: vi.fn(),
    generateSuccess: vi.fn(),
    generateFailure: vi.fn(),
    packageBegin: vi.fn(),
    packageSuccess: vi.fn(),
    packageFailure: vi.fn()
  }
}));

vi.mock('../../tools/secrets-management-tool.js', () => ({
  SecretsManagementTool: vi.fn()
}));

vi.mock('../MediaManifestService.js', () => ({
  mediaManifestService: { getManifest: vi.fn().mockResolvedValue({ success: false }) }
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn().mockReturnValue(null)
  }; })
}));

import { AppContextManager } from '../AppContextManager.js';
import { createForWorkspace } from '../../workspace/index.js';
import { makeRunCommandResult } from '../../workspace/__tests__/mock-helpers.js';

const TEST_APP_ID = 'test-app-gitstatus';

type GitInvocation = (command: string) => ReturnType<typeof makeRunCommandResult> | null;

function workspaceWithGit(invocation: GitInvocation) {
  return {
    tasks: {
      runCommandSync: vi.fn(async function ({ command }: { command: string }) {
        const result = invocation(command);
        if (!result) {
          return makeRunCommandResult({ exitCode: 1, stderr: 'failed' });
        }
        return result;
      }),
    },
  };
}

describe('AppContextManager - git status', () => {
  let manager: AppContextManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AppContextManager();
  });

  describe('formatGitStatusSection', () => {
    it('returns null when gitInfo is null', () => {
      const result = (manager as any).formatGitStatusSection(null);
      expect(result).toBeNull();
    });

    it('formats branch, clean status, and last commit', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: 0,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'feat: initial commit'
      });
      expect(result).toBe(
        '## Git Status\n- Branch: main\n- Uncommitted changes: 0\n- Last commit: abc1234 feat: initial commit'
      );
    });

    it('formats with uncommitted changes count', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'feature/test',
        uncommittedCount: 5,
        lastCommitHash: 'def5678',
        lastCommitMessage: 'wip'
      });
      expect(result).toContain('- Uncommitted changes: 5');
      expect(result).toContain('- Branch: feature/test');
    });

    it('formats detached HEAD state', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'detached:abc1234',
        uncommittedCount: 0,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'some commit'
      });
      expect(result).toContain('- Branch: detached:abc1234');
    });

    it('omits branch line when branch is null', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: null,
        uncommittedCount: 0,
        lastCommitHash: null,
        lastCommitMessage: null
      });
      expect(result).toBe('## Git Status\n- Uncommitted changes: 0');
      expect(result).not.toContain('Branch:');
      expect(result).not.toContain('Last commit:');
    });

    it('omits uncommitted changes line when uncommittedCount is null', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: null,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'feat: initial commit'
      });
      expect(result).not.toContain('Uncommitted changes');
      expect(result).toContain('- Branch: main');
      expect(result).toContain('- Last commit: abc1234 feat: initial commit');
    });

    it('omits last commit line when no commits exist', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: 0,
        lastCommitHash: null,
        lastCommitMessage: null
      });
      expect(result).not.toContain('Last commit:');
    });

    it('formats last commit without trailing space when message is null', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: 0,
        lastCommitHash: 'abc1234',
        lastCommitMessage: null
      });
      expect(result).toContain('- Last commit: abc1234');
      expect(result).not.toMatch(/abc1234 $/m);
      expect(result).not.toMatch(/abc1234 \n/);
    });
  });

  describe('getGitStatusInfo', () => {
    it('returns null when workspace is unavailable', async () => {
      vi.mocked(createForWorkspace).mockReturnValue(null);
      const result = await (manager as any).getGitStatusInfo(TEST_APP_ID);
      expect(result).toBeNull();
    });

    it('returns git status when repo exists with commits', async () => {
      const workspace = workspaceWithGit((command) => {
        if (command.includes('--abbrev-ref')) return makeRunCommandResult({ stdout: 'main\n' });
        if (command.includes('--porcelain')) return makeRunCommandResult({ stdout: ' M file1.ts\n M file2.ts\n' });
        if (command.includes('--format=%h %s')) return makeRunCommandResult({ stdout: 'abc1234 feat: add feature\n' });
        return makeRunCommandResult();
      });
      vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

      const result = await (manager as any).getGitStatusInfo(TEST_APP_ID);
      expect(result).toEqual({
        branch: 'main',
        uncommittedCount: 2,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'feat: add feature'
      });
    });

    it('handles detached HEAD state', async () => {
      const workspace = workspaceWithGit((command) => {
        if (command.includes('--abbrev-ref')) return makeRunCommandResult({ stdout: 'HEAD\n' });
        if (command.includes('--short')) return makeRunCommandResult({ stdout: 'def5678\n' });
        if (command.includes('--porcelain')) return makeRunCommandResult({ stdout: '' });
        if (command.includes('--format=%h %s')) return makeRunCommandResult({ stdout: 'def5678 some commit\n' });
        return makeRunCommandResult();
      });
      vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

      const result = await (manager as any).getGitStatusInfo(TEST_APP_ID);
      expect(result?.branch).toBe('detached:def5678');
    });

    it('handles repo with no commits yet', async () => {
      const workspace = workspaceWithGit((command) => {
        if (command.includes('--abbrev-ref')) return null;
        if (command.includes('--format=%h %s')) return null;
        if (command.includes('--porcelain')) return makeRunCommandResult({ stdout: '?? newfile.ts\n' });
        return null;
      });
      vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

      const result = await (manager as any).getGitStatusInfo(TEST_APP_ID);
      expect(result).toEqual({
        branch: null,
        uncommittedCount: 1,
        lastCommitHash: null,
        lastCommitMessage: null
      });
    });

    it('returns null when all git commands fail', async () => {
      const workspace = workspaceWithGit(() => null);
      vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

      const result = await (manager as any).getGitStatusInfo(TEST_APP_ID);
      expect(result).toBeNull();
    });

    it('returns null uncommittedCount when status fails but branch/log succeed', async () => {
      const workspace = workspaceWithGit((command) => {
        if (command.includes('--abbrev-ref')) return makeRunCommandResult({ stdout: 'main\n' });
        if (command.includes('--porcelain')) return null;
        if (command.includes('--format=%h %s')) return makeRunCommandResult({ stdout: 'abc1234 some commit\n' });
        return makeRunCommandResult();
      });
      vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

      const result = await (manager as any).getGitStatusInfo(TEST_APP_ID);
      expect(result).toEqual({
        branch: 'main',
        uncommittedCount: null,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'some commit'
      });
    });

    it('handles clean repo with no uncommitted changes', async () => {
      const workspace = workspaceWithGit((command) => {
        if (command.includes('--abbrev-ref')) return makeRunCommandResult({ stdout: 'main\n' });
        if (command.includes('--porcelain')) return makeRunCommandResult({ stdout: '' });
        if (command.includes('--format=%h %s')) return makeRunCommandResult({ stdout: 'abc1234 initial commit\n' });
        return makeRunCommandResult();
      });
      vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

      const result = await (manager as any).getGitStatusInfo(TEST_APP_ID);
      expect(result?.uncommittedCount).toBe(0);
    });

    // Supervisor failure is not a recoverable state — it must propagate so
    // the outer context-generation path can fail loudly. Silently returning
    // null here would hide a real outage behind "no git repo".
    it('propagates exceptions when runCommandSync rejects', async () => {
      const workspace = {
        tasks: {
          runCommandSync: vi.fn().mockRejectedValue(new Error('supervisor unreachable')),
        },
      };
      vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

      await expect((manager as any).getGitStatusInfo(TEST_APP_ID))
        .rejects.toThrow('supervisor unreachable');
    });
  });
});
