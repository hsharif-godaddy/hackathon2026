/**
 * Git Utils Unit Tests
 *
 * Tests for GitUtils class methods, particularly the pull method
 * with allowUnrelatedHistories parameter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitUtils } from '../git.js';

// Mock WorkspaceTasks
const createMockTasks = () => ({
  runCommandSync: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: 'Already up to date.',
    stderr: '',
    timedOut: false,
    executionTimeMs: 100,
    taskId: 'test-task-1',
  })
});

describe('GitUtils', () => {
  let gitUtils: GitUtils;
  let mockTasks: ReturnType<typeof createMockTasks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTasks = createMockTasks();
    gitUtils = new GitUtils(mockTasks as any);
  });

  describe('pull', () => {
    it('should execute git pull with -X when merge strategy specified', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs');

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).not.toContain('--allow-unrelated-histories');
      expect(callArgs.command).not.toContain('--no-rebase');
    });

    it('should execute git pull with --no-rebase when noRebase is true', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', false, true);

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('--no-rebase');
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
    });

    it('should execute git pull with --allow-unrelated-histories when set to true', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', true);

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });

    it('should execute git pull without --allow-unrelated-histories when set to false', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', false);

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).not.toContain('--allow-unrelated-histories');
    });

    it('should execute git pull without merge strategy when not specified', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {});

      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.stringContaining("git 'pull' 'origin' 'main'")
        })
      );

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).not.toContain('-X');
      expect(callArgs.command).not.toContain('--no-rebase');
    });

    it('should execute git pull with all options: noRebase, mergeStrategy, and allowUnrelatedHistories', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', true, true);

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('--no-rebase');
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });

    it('should execute git pull with allowUnrelatedHistories but without merge strategy', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, undefined, true);

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).not.toContain('-X');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });
  });

  describe('commitTree', () => {
    it('should create orphan commit when no parent specified', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123def456\n',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await gitUtils.commitTree('/app', 'tree-hash-123', 'test message');

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('commit-tree');
      expect(callArgs.command).toContain('tree-hash-123');
      expect(callArgs.command).toContain('test message');
      expect(callArgs.command).not.toContain('-p');
    });

    it('should create commit with parent when parentHash specified', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123def456\n',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await gitUtils.commitTree('/app', 'tree-hash-123', 'test message', { parentHash: 'parent-hash-456' });

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('commit-tree');
      expect(callArgs.command).toContain('tree-hash-123');
      expect(callArgs.command).toContain('-p');
      expect(callArgs.command).toContain('parent-hash-456');
      expect(callArgs.command).toContain('test message');
    });

    it('should return failure result when commit-tree fails', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: not a valid tree object',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      const result = await gitUtils.commitTree('/app', 'bad-tree', 'test message');

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not a valid tree object');
    });
  });

  describe('restoreFromCommit', () => {
    it('should invoke git restore with --source, --staged, --worktree and the current dir', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      const result = await gitUtils.restoreFromCommit('/app', 'abcdef1');

      expect(result.success).toBe(true);
      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('restore');
      expect(callArgs.command).toContain('--source=abcdef1');
      expect(callArgs.command).toContain('--staged');
      expect(callArgs.command).toContain('--worktree');
      expect(callArgs.command).toContain("'.'");
    });

    it('should surface git failure when the commit does not exist', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 128,
        stdout: '',
        stderr: "fatal: bad revision 'deadbeef'",
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      const result = await gitUtils.restoreFromCommit('/app', 'deadbeef');

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('bad revision');
    });
  });

  describe('getTreeHash', () => {
    it('should resolve tree hash for a ref', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'tree-hash-abc123\n',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      const result = await gitUtils.getTreeHash('/app', 'HEAD');

      expect(result).toBe('tree-hash-abc123');
      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('rev-parse');
      expect(callArgs.command).toContain('HEAD^{tree}');
    });

    it('should throw when ref cannot be resolved', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: not a valid object name',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await expect(gitUtils.getTreeHash('/app', 'nonexistent')).rejects.toThrow(
        "Failed to get tree hash for 'nonexistent'"
      );
    });
  });

  describe('updateRef', () => {
    it('should update a ref to point to a commit', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await gitUtils.updateRef('/app', 'refs/heads/main', 'commit-hash-789');

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('update-ref');
      expect(callArgs.command).toContain('refs/heads/main');
      expect(callArgs.command).toContain('commit-hash-789');
    });

    it('should include old value for compare-and-swap when provided', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await gitUtils.updateRef('/app', 'refs/heads/main', 'new-hash', 'old-hash');

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('update-ref');
      expect(callArgs.command).toContain('refs/heads/main');
      expect(callArgs.command).toContain('new-hash');
      expect(callArgs.command).toContain('old-hash');
    });

    it('should throw when update-ref fails', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: update_ref failed',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await expect(
        gitUtils.updateRef('/app', 'refs/heads/main', 'commit-hash-789')
      ).rejects.toThrow("Failed to update ref 'refs/heads/main'");
    });
  });

  describe('addFiles', () => {
    it('should use 60 second default timeout for large repos', async () => {
      await gitUtils.addFiles('/app', ['.']);

      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutSeconds: 60
        })
      );
    });

    it('should respect custom timeout when provided', async () => {
      await gitUtils.addFiles('/app', ['.'], { timeout: 180000 });

      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutSeconds: 180
        })
      );
    });

    it('should add specified files', async () => {
      await gitUtils.addFiles('/app', ['file1.txt', 'file2.txt']);

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('git');
      expect(callArgs.command).toContain('add');
      expect(callArgs.command).toContain('file1.txt');
      expect(callArgs.command).toContain('file2.txt');
    });

    it('should add all files by default', async () => {
      await gitUtils.addFiles('/app');

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('git');
      expect(callArgs.command).toContain('add');
      expect(callArgs.command).toContain("'.'");
    });
  });

  describe('createArchive', () => {
    it('should throw error when workspace is not available', async () => {
      const gitUtilsUnavailable = new GitUtils(undefined);

      await expect(
        gitUtilsUnavailable.createArchive('/app', 'abc1234')
      ).rejects.toThrow('Archive creation requires a workspace connection for command execution.');
    });

    it('should throw error when commit hash format is invalid', async () => {
      await expect(
        gitUtils.createArchive('/app', 'invalid!hash')
      ).rejects.toThrow('Invalid commit hash format');

      await expect(
        gitUtils.createArchive('/app', '123') // too short (< 7 chars)
      ).rejects.toThrow('Invalid commit hash format');

      await expect(
        gitUtils.createArchive('/app', 'a'.repeat(41)) // too long (> 40 chars)
      ).rejects.toThrow('Invalid commit hash format');
    });

    it('should throw error when dist/ folder does not exist for dist-only archives', async () => {
      // Mock dist/ check to fail
      // Note: With includeSource: false, the dist/ check runs immediately
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('dist/ folder not found - application must be built before publishing');

      // Verify the dist/ check was called
      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.stringContaining('test'),
        })
      );
    });

    it('should succeed when dist/ folder does not exist for full-source archives (PaaS flow)', async () => {
      const commitHash = 'abc1234';

      // Flow: mkdir -> tar (no dist check for includeSource: true)
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      // Verify only 2 calls: mkdir and tar (no dist check).
      // The archive manifest listing is deferred via setImmediate and runs
      // on a later tick, so it's not observable from this synchronous assertion.
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(2);

      // Verify no dist check command was called
      const allCommands = mockTasks.runCommandSync.mock.calls.map(call => call[0].command);
      const hasDistCheck = allCommands.some(cmd => cmd.includes("test") && cmd.includes("dist"));
      expect(hasDistCheck).toBe(false);
    });

    it('should create archive when dist/ folder exists (no manifest)', async () => {
      const commitHash = 'abc1234';

      // Flow: dist check -> manifest check (not found) -> mkdir -> tar
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      // Verify 4 calls: dist check, manifest check, mkdir, tar
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(4);

      // Verify tar archives dist/
      const tarCallArgs = mockTasks.runCommandSync.mock.calls[3][0];
      expect(tarCallArgs.command).toContain('tar');
      expect(tarCallArgs.command).toContain('dist');
    });

    it('should copy airo-media.json into dist/ when it exists', async () => {
      const commitHash = 'abc1234';

      // Flow: dist check -> manifest check (found) -> copy manifest -> mkdir -> tar
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      // Verify 5 calls including the copy
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(5);

      // Verify manifest was copied to dist/
      const copyCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
      expect(copyCallArgs.command).toContain('cp');
      expect(copyCallArgs.command).toContain('airo-media.json');
      expect(copyCallArgs.command).toContain('dist/airo-media.json');

      // Verify final tar only archives dist/
      const tarCallArgs = mockTasks.runCommandSync.mock.calls[4][0];
      expect(tarCallArgs.command).toContain('tar');
      expect(tarCallArgs.command).toContain('dist');
    });

    it('should throw error when copying airo-media.json fails', async () => {
      // Flow: dist check -> manifest check (found) -> copy fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Permission denied', timedOut: false, executionTimeMs: 0, taskId: 't' }); // cp fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to copy airo-media.json to dist/');

      // Verify the copy command was attempted
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(3);
      const copyCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
      expect(copyCallArgs.command).toContain('cp');
      expect(copyCallArgs.command).toContain('airo-media.json');
    });

    it('should throw error when mkdir fails', async () => {
      // Flow: dist check -> manifest check (not found) -> mkdir fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Permission denied', timedOut: false, executionTimeMs: 0, taskId: 't' }); // mkdir fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to create output directory');
    });

    it('should throw error when tar command fails', async () => {
      // Flow: dist check -> manifest check (not found) -> mkdir -> tar fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir succeeds
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'No space left on device', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to create archive');
    });

    describe('includeSource option', () => {
      describe('auto-detect (when includeSource not specified)', () => {
        it('should auto-detect dist-only when dist/server.bundle.mjs exists', async () => {
          const commitHash = 'abc1234';

          // Flow: bundle check (exists) -> dist check -> manifest check -> mkdir -> tar (dist only)
          // Note: bundle check happens first (in shouldIncludeSource), then dist check for dist-only archives
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // bundle check (exists)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash);

          // Verify bundle check was called first
          const bundleCheckCall = mockTasks.runCommandSync.mock.calls[0][0];
          expect(bundleCheckCall.command).toContain('server.bundle.mjs');

          // Verify tar only archives dist/ (no exclusions)
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[4][0];
          expect(tarCallArgs.command).toContain('dist');
          expect(tarCallArgs.command).not.toContain('--exclude');
        });

        it('should auto-detect full-source when dist/server.bundle.mjs does not exist', async () => {
          const commitHash = 'abc1234';

          // Flow: bundle check (not exists) -> mkdir -> tar (full source with exclusions)
          // Note: No dist check because includeSource=true (auto-detected from missing bundle)
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // bundle check (not exists)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash);

          // Verify tar archives full source with exclusions
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
          expect(tarCallArgs.command).toContain('tar');
          expect(tarCallArgs.command).toContain('--exclude');
          expect(tarCallArgs.command).toContain('node_modules');
          expect(tarCallArgs.command).toContain("'.'");
        });

        it('should succeed for PaaS auto-detect when dist/ folder is missing', async () => {
          // This test explicitly verifies the PaaS scenario:
          // - No dist/server.bundle.mjs (triggers full-source auto-detect)
          // - No dist/ folder exists
          // - Archive should still succeed because full-source archives don't require dist/
          const commitHash = 'abc1234';

          // Flow: bundle check (not exists) -> mkdir -> tar
          // Note: dist/ check is intentionally NOT mocked because it should NOT be called
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // bundle check (not exists)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          const result = await gitUtils.createArchive('/app', commitHash);

          expect(result).toEqual({
            path: expect.stringContaining(`${commitHash}.tar.gz`),
            commitHash
          });

          // Verify exactly 3 calls: bundle check, mkdir, tar (no dist check).
          // Archive manifest is deferred via setImmediate — not observable here.
          expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(3);

          // Explicitly verify no dist check command was called
          const allCommands = mockTasks.runCommandSync.mock.calls.map(call => call[0].command);
          const hasDistCheck = allCommands.some(cmd =>
            cmd.includes("test") && cmd.includes("'-d'") && cmd.includes("'dist'")
          );
          expect(hasDistCheck).toBe(false);
        });
      });

      describe('explicit override', () => {
        it('should use dist-only when includeSource is explicitly false (skip auto-detect)', async () => {
          const commitHash = 'abc1234';

          // Flow: dist check -> manifest check (not found) -> mkdir -> tar
          // Note: No bundle check because includeSource is explicit
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

          // Verify no bundle check was called (first call after dist check is manifest check)
          const secondCall = mockTasks.runCommandSync.mock.calls[1][0];
          expect(secondCall.command).not.toContain('server.bundle.mjs');

          // Verify tar only archives dist/
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[3][0];
          expect(tarCallArgs.command).toContain('dist');
          expect(tarCallArgs.command).not.toContain('--exclude');
        });

        it('should use full-source when includeSource is explicitly true (skip auto-detect)', async () => {
          const commitHash = 'abc1234';

          // Flow: mkdir -> tar (with exclusions)
          // Note: No bundle check because includeSource is explicit
          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          // Verify no bundle check or dist check was called
          // (2 = mkdir + tar; archive manifest deferred via setImmediate)
          expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(2);
          const allCommands = mockTasks.runCommandSync.mock.calls.map(call => call[0].command);
          const hasBundleCheck = allCommands.some(cmd => cmd.includes('server.bundle.mjs'));
          expect(hasBundleCheck).toBe(false);

          // Verify tar archives full source with exclusions
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[1][0];
          expect(tarCallArgs.command).toContain('--exclude');
          expect(tarCallArgs.command).toContain("'.'");
        });
      });

      describe('full source archive behavior', () => {
        it('should exclude node_modules and .git in full source archive', async () => {
          const commitHash = 'abc1234';

          // Flow: mkdir -> tar (with exclusions)
          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          const tarCallArgs = mockTasks.runCommandSync.mock.calls[1][0];
          expect(tarCallArgs.command).toMatch(/--exclude.*node_modules/);
          expect(tarCallArgs.command).toMatch(/--exclude.*\.git/);
          expect(tarCallArgs.command).not.toMatch(/--exclude.*\.env/);
        });

        it('should exclude .ssl in full source archive in local dev (NOMAD_ALLOC_DIR unset)', async () => {
          vi.stubEnv('NOMAD_ALLOC_DIR', '');
          try {
            const commitHash = 'abc1234';

            mockTasks.runCommandSync
              .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
              .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

            await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

            // .ssl is bind-mounted read-only into the local-control-plane publish container;
            // it must be excluded to prevent tar extraction from failing with "Read-only file system"
            const tarCallArgs = mockTasks.runCommandSync.mock.calls[1][0];
            expect(tarCallArgs.command).toMatch(/--exclude.*\.ssl/);
          } finally {
            vi.unstubAllEnvs();
          }
        });

        it('should NOT exclude .ssl in full source archive in Nomad/prod (NOMAD_ALLOC_DIR set)', async () => {
          vi.stubEnv('NOMAD_ALLOC_DIR', '/alloc');
          try {
            const commitHash = 'abc1234';

            mockTasks.runCommandSync
              .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
              .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

            await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

            // Nomad/production has no read-only .ssl bind-mount, so the exclusion is skipped
            // to keep archive contents identical to pre-fix behavior.
            const tarCallArgs = mockTasks.runCommandSync.mock.calls[1][0];
            expect(tarCallArgs.command).not.toMatch(/--exclude.*\.ssl/);
          } finally {
            vi.unstubAllEnvs();
          }
        });

        it('should exclude untracked files in full source archive when git reports them', async () => {
          const commitHash = 'abc1234';

          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'test.json\u0000tmp/cache.db\u0000', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // list untracked
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true });

          const tarCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
          expect(tarCallArgs.command).toContain('--exclude=test.json');
          expect(tarCallArgs.command).toContain('--exclude=tmp/cache.db');
        });

        it('should preserve leading and trailing spaces in untracked file names', async () => {
          const commitHash = 'abc1234';

          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: ' leading.txt\u0000trailing.txt \u0000', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // list untracked
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true });

          const tarCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
          expect(tarCallArgs.command).toContain('--exclude= leading.txt');
          expect(tarCallArgs.command).toContain('--exclude=trailing.txt ');
        });

        it('should filter out .env files from untracked exclusions to keep them in the archive', async () => {
          const commitHash = 'abc1234';

          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '.env\u0000.env.local\u0000.env.production\u0000subdir/.env\u0000config.json\u0000', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // list untracked
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true });

          const tarCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
          // .env files at the root (starting with .env) are filtered from the untracked exclusion list,
          // so they will NOT have --exclude flags and will be included in the publish archive
          expect(tarCallArgs.command).not.toContain('--exclude=.env');
          expect(tarCallArgs.command).not.toContain('--exclude=.env.local');
          expect(tarCallArgs.command).not.toContain('--exclude=.env.production');
          // subdir/.env does NOT start with .env, so it remains in the exclusion list
          expect(tarCallArgs.command).toContain('--exclude=subdir/.env');
          // Non-.env untracked files should still be excluded
          expect(tarCallArgs.command).toContain('--exclude=config.json');
        });

        it('should filter out .airo/ files from untracked exclusions to keep them in the archive', async () => {
          const commitHash = 'abc1234';

          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '.airo/config.json\u0000.airo\u0000.airo-other/foo.txt\u0000random.txt\u0000', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // list untracked
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true });

          const tarCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
          // .airo/ files and the .airo directory itself are filtered from the untracked exclusion list,
          // so they will NOT have --exclude flags and will be included in the publish archive
          expect(tarCallArgs.command).not.toContain('--exclude=.airo/config.json');
          // Check .airo directory is not excluded (use regex to avoid matching .airo-other)
          expect(tarCallArgs.command).not.toMatch(/--exclude=\.airo['"\s]/);
          // .airo-other/ has a different prefix (not .airo/), so it remains in the exclusion list
          expect(tarCallArgs.command).toContain('--exclude=.airo-other/foo.txt');
          // Non-.airo untracked files should still be excluded
          expect(tarCallArgs.command).toContain('--exclude=random.txt');
        });

        it('should continue archive creation when listing untracked files fails', async () => {
          const commitHash = 'abc1234';

          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // mkdir output dir
            .mockResolvedValueOnce({
              exitCode: 1,
              stdout: '',
              stderr: 'not a git repository',
              timedOut: false,
              executionTimeMs: 0,
              taskId: 't',
            }) // list untracked (fails)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await expect(
            gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true })
          ).resolves.toEqual({
            path: '/publish/dist/abc1234.tar.gz',
            commitHash: 'abc1234',
          });

          // 3 calls: mkdir, list-untracked (fails), tar.
          // Archive manifest is deferred via setImmediate — not observable here.
          expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(3);
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
          expect(tarCallArgs.command).not.toContain('--exclude=test.json');
          expect(tarCallArgs.command).not.toContain('--exclude=tmp/cache.db');
        });

        it('should skip airo-media.json copy when includeSource is true (included in full archive)', async () => {
          const commitHash = 'abc1234';

          // Flow: mkdir -> tar
          // Note: No manifest check or copy when includeSource is true
          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          // Should only have 2 calls: mkdir, tar
          // No manifest check or copy because full source includes everything
          // No dist check because includeSource: true skips it
          // Archive manifest event is deferred via setImmediate — not observable here.
          expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(2);

          // Verify no cp command was called
          const allCommands = mockTasks.runCommandSync.mock.calls.map(call => call[0].command);
          const hasCopy = allCommands.some(cmd => cmd.includes('cp') && cmd.includes('airo-media.json'));
          expect(hasCopy).toBe(false);
        });

        it('should archive from root directory when includeSource is true', async () => {
          const commitHash = 'abc1234';

          // Note: No dist check because includeSource: true skips it
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          // Verify tar uses '.' to archive from root
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[1][0];
          expect(tarCallArgs.command).toContain("'.'");
        });
      });
    });
  });

  describe('executeGitCommand - transport failure handling', () => {
    it('should not attempt recovery when runCommandSync throws (transport failure)', async () => {
      mockTasks.runCommandSync.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await gitUtils.commit('/app', 'test message');

      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toContain('ECONNREFUSED');
    });

    it('should not attempt recovery when runCommandSync throws a generic error', async () => {
      mockTasks.runCommandSync.mockRejectedValue(new Error('WebSocket closed unexpectedly'));

      const result = await gitUtils.addFiles('/app', ['.']);

      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.stderr).toContain('WebSocket closed unexpectedly');
    });
  });
});
