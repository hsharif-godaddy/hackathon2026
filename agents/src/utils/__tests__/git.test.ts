/**
 * Git Utils Unit Tests
 *
 * Tests for GitUtils class methods, particularly the pull method
 * with allowUnrelatedHistories parameter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitUtils } from '../git.js';
import { logger } from '../../logging/index.js';

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
    it('should commit only the provided pathspec when files are specified', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        executionTimeMs: 0,
        taskId: 't',
      });

      await gitUtils.commitFiles('/app', 'Update format overrides', ['format-overrides/pages/index.json']);

      const callArgs = mockTasks.runCommandSync.mock.calls[0][0];
      expect(callArgs.command).toContain('commit');
      expect(callArgs.command).toContain('Update format overrides');
      expect(callArgs.command).toContain('--');
      expect(callArgs.command).toContain('format-overrides/pages/index.json');
    });

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

  describe('commitFileIfChanged', () => {
    const ok = (stdout = '') => ({
      exitCode: 0,
      stdout,
      stderr: '',
      timedOut: false,
      executionTimeMs: 1,
      taskId: 't',
    });

    /** Route by git subcommand so add / status / commit get distinct responses. */
    function route(handlers: {
      add?: ReturnType<typeof ok>;
      status?: ReturnType<typeof ok>;
      commit?: ReturnType<typeof ok>;
    }): void {
      mockTasks.runCommandSync.mockImplementation(async (args: { command: string }) => {
        if (args.command.includes('porcelain')) return handlers.status ?? ok('');
        if (args.command.includes('commit')) return handlers.commit ?? ok('');
        if (args.command.includes('add')) return handlers.add ?? ok('');
        throw new Error(`Unexpected command: ${args.command}`);
      });
    }

    it('commits when the path has staged changes and returns true', async () => {
      route({ status: ok(' M .airo/config.json') });

      const result = await gitUtils.commitFileIfChanged('/app', '.airo/config.json', 'persist config');

      expect(result).toBe(true);
      const commitCall = mockTasks.runCommandSync.mock.calls.find((c) =>
        c[0].command.includes('commit')
      );
      expect(commitCall?.[0].command).toContain('persist config');
      // Scoped commit: `git commit -m ... -- <file>`
      expect(commitCall?.[0].command).toContain('.airo/config.json');
    });

    it('is a no-op returning false when the path is already committed and unchanged', async () => {
      route({ status: ok('') }); // empty porcelain → nothing staged

      const result = await gitUtils.commitFileIfChanged('/app', '.airo/config.json', 'persist config');

      expect(result).toBe(false);
      const commitCall = mockTasks.runCommandSync.mock.calls.find((c) =>
        c[0].command.includes('commit')
      );
      expect(commitCall).toBeUndefined(); // commit never attempted
    });

    it('stages only the named path (scoped, leaves unrelated staged entries alone)', async () => {
      route({ status: ok('A  .airo/config.json') });

      await gitUtils.commitFileIfChanged('/app', '.airo/config.json', 'persist config');

      const addCall = mockTasks.runCommandSync.mock.calls.find((c) =>
        c[0].command.includes('add')
      );
      expect(addCall?.[0].command).toContain('.airo/config.json');
      expect(addCall?.[0].command).not.toContain("'.'");
    });

    it('throws when staging fails', async () => {
      route({ add: { ...ok(''), exitCode: 1, stderr: 'permission denied' } });

      await expect(
        gitUtils.commitFileIfChanged('/app', '.airo/config.json', 'persist config')
      ).rejects.toThrow(/Failed to stage .airo\/config.json: permission denied/);
    });

    it('throws when the commit itself fails', async () => {
      route({
        status: ok(' M .airo/config.json'),
        commit: { ...ok(''), exitCode: 1, stderr: 'hook rejected' },
      });

      await expect(
        gitUtils.commitFileIfChanged('/app', '.airo/config.json', 'persist config')
      ).rejects.toThrow(/Failed to commit .airo\/config.json: hook rejected/);
    });
  });

  describe('commitFilesIfChanged', () => {
    const ok = (stdout = '') => ({
      exitCode: 0,
      stdout,
      stderr: '',
      timedOut: false,
      executionTimeMs: 1,
      taskId: 't',
    });

    /** Route by git subcommand so add / status / commit get distinct responses. */
    function route(handlers: {
      add?: ReturnType<typeof ok>;
      status?: ReturnType<typeof ok>;
      commit?: ReturnType<typeof ok>;
    }): void {
      mockTasks.runCommandSync.mockImplementation(async (args: { command: string }) => {
        if (args.command.includes('porcelain')) return handlers.status ?? ok('');
        if (args.command.includes('commit')) return handlers.commit ?? ok('');
        if (args.command.includes('add')) return handlers.add ?? ok('');
        throw new Error(`Unexpected command: ${args.command}`);
      });
    }

    const files = ['src/content/pages/home.json', 'src/content/.user-edits.json'];

    it('commits when a path has staged changes and returns true', async () => {
      route({ status: ok(' M src/content/pages/home.json') });

      const result = await gitUtils.commitFilesIfChanged('/app', 'Update content: home.hero.title', files);

      expect(result).toBe(true);
      const commitCall = mockTasks.runCommandSync.mock.calls.find((c) =>
        c[0].command.includes('commit')
      );
      expect(commitCall?.[0].command).toContain('Update content: home.hero.title');
      expect(commitCall?.[0].command).toContain('src/content/pages/home.json');
      expect(commitCall?.[0].command).toContain('src/content/.user-edits.json');
    });

    it('is a no-op returning false when the paths are already committed and unchanged', async () => {
      route({ status: ok('') }); // empty porcelain → nothing staged

      const result = await gitUtils.commitFilesIfChanged('/app', 'Update content: home.hero.title', files);

      expect(result).toBe(false);
      const commitCall = mockTasks.runCommandSync.mock.calls.find((c) =>
        c[0].command.includes('commit')
      );
      expect(commitCall).toBeUndefined(); // commit never attempted
    });

    it('throws when staging fails', async () => {
      route({ add: { ...ok(''), exitCode: 1, stderr: 'permission denied' } });

      await expect(
        gitUtils.commitFilesIfChanged('/app', 'Update content: home.hero.title', files)
      ).rejects.toThrow(/Failed to stage .*: permission denied/);
    });

    it('throws when the commit itself fails', async () => {
      route({
        status: ok(' M src/content/pages/home.json'),
        commit: { ...ok(''), exitCode: 1, stderr: 'hook rejected' },
      });

      await expect(
        gitUtils.commitFilesIfChanged('/app', 'Update content: home.hero.title', files)
      ).rejects.toThrow(/Failed to commit .*: hook rejected/);
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

      // Flow: dist check -> manifest check (not found) -> contact-form check (not found) -> mkdir -> tar
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // contact-form.config.json check (not found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      // Verify 5 calls: dist check, manifest check, contact-form check, mkdir, tar
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(5);

      // Verify tar archives the entire dist/ directory. Runtime artifacts that
      // already exist under dist, including dist/airo-adsense.json, are included
      // without an artifact-specific copy path.
      const tarCallArgs = mockTasks.runCommandSync.mock.calls[4][0];
      expect(tarCallArgs.command).toContain('tar');
      expect(tarCallArgs.command).toContain("'-C' '/app' 'dist'");
      expect(tarCallArgs.command).not.toContain('airo-adsense');
    });

    it('should copy contact-form.config.json into dist/ when it exists in source', async () => {
      const commitHash = 'abc1234';

      // Flow: dist check -> manifest check (not found) -> contact-form check (found) -> cp config -> mkdir -> tar
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // contact-form.config.json check (found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // cp contact-form config
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(6);

      // Verify contact-form config was copied to dist/
      const cpCallArgs = mockTasks.runCommandSync.mock.calls[3][0];
      expect(cpCallArgs.command).toContain('cp');
      expect(cpCallArgs.command).toContain('src/lib/contact-form.config.json');
      expect(cpCallArgs.command).toContain('dist/contact-form.config.json');
    });

    it('should throw when contact-form.config.json copy fails', async () => {
      // Flow: dist check -> manifest check (not found) -> contact-form check (found) -> cp fails
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // contact-form.config.json check (found)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Permission denied', timedOut: false, executionTimeMs: 0, taskId: 't' }); // cp fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to copy contact-form.config.json to dist/: Permission denied');
    });

    it('should copy airo-media.json into dist/ when it exists', async () => {
      const commitHash = 'abc1234';

      // Flow: dist check -> manifest check (found) -> cp manifest dist/ -> cp manifest
      // dist/client/ -> 4 media copies (public/media + public/assets/media, each ->
      // dist + dist/client) -> contact-form check (not found) -> mkdir -> tar
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/client/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/client/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/assets/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/client/assets/media
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // contact-form.config.json check (not found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      // Verify 11 calls including manifest + media copies + contact-form check
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(11);

      // Verify manifest was copied to dist/
      const copyCallArgs = mockTasks.runCommandSync.mock.calls[2][0];
      expect(copyCallArgs.command).toContain('cp');
      expect(copyCallArgs.command).toContain('airo-media.json');
      expect(copyCallArgs.command).toContain('dist/airo-media.json');

      // Verify manifest was also copied to dist/client/
      const clientCopyArgs = mockTasks.runCommandSync.mock.calls[3][0];
      expect(clientCopyArgs.command).toContain('dist/client');

      // Verify final tar only archives dist/
      const tarCallArgs = mockTasks.runCommandSync.mock.calls[10][0];
      expect(tarCallArgs.command).toContain('tar');
      expect(tarCallArgs.command).toContain('dist');
    });

    it('should copy airo-media.json to dist/client/ for AI video runtime discovery', async () => {
      const commitHash = 'a1b2c3d';

      // Flow: dist check -> manifest check (found) -> cp to dist/ -> cp to dist/client/ ->
      // 4 media copies -> contact-form check (not found) -> mkdir -> tar
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/client/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/client/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/assets/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/client/assets/media
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // contact-form.config.json check (not found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      // Verify the dist/client copy command (call index 3)
      // This ensures airo-video-slots.js can fetch /airo-media.json at runtime in published apps
      const clientCopyArgs = mockTasks.runCommandSync.mock.calls[3][0];
      expect(clientCopyArgs.command).toContain('dist/client');
      expect(clientCopyArgs.command).toContain('airo-media.json');
    });

    it('should copy public uploads into dist/ so dist-only archives carry the bytes', async () => {
      const commitHash = 'abc1234';

      // Flow (manifest found): dist check -> manifest check -> cp manifest dist/ ->
      // cp manifest dist/client/ -> 4 media copies -> mkdir -> tar
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/client/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/client/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/assets/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/client/assets/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      // "use this image" uploads: public/media -> dist/media + dist/client/media
      const mediaCopyArgs = mockTasks.runCommandSync.mock.calls[4][0];
      expect(mediaCopyArgs.command).toContain('public/media');
      expect(mediaCopyArgs.command).toContain('dist/media');

      const clientMediaCopyArgs = mockTasks.runCommandSync.mock.calls[5][0];
      expect(clientMediaCopyArgs.command).toContain('public/media');
      expect(clientMediaCopyArgs.command).toContain('dist/client/media');

      // chat uploads: public/assets/media -> dist/assets/media + dist/client/assets/media
      const assetsMediaCopyArgs = mockTasks.runCommandSync.mock.calls[6][0];
      expect(assetsMediaCopyArgs.command).toContain('public/assets/media');
      expect(assetsMediaCopyArgs.command).toContain('dist/assets/media');

      const clientAssetsMediaCopyArgs = mockTasks.runCommandSync.mock.calls[7][0];
      expect(clientAssetsMediaCopyArgs.command).toContain('public/assets/media');
      expect(clientAssetsMediaCopyArgs.command).toContain('dist/client/assets/media');
    });

    it('should warn (not silently swallow) when a media-copy command fails mid-archive', async () => {
      // Source dir present but the copy errors (I/O, permission, ENOSPC) — must
      // surface as a warn, not be swallowed by the old `|| true`, otherwise a
      // partial upload mirror ships and the published slot 404s.
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp airo-media.json dist/client/
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'cp: write error: No space left on device', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/media — FAILS
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/media dist/client/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/assets/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // cp public/assets/media dist/client/assets/media
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

      // A failed media copy is warn-and-continue, not fatal — the archive still completes.
      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).resolves.toMatchObject({ commitHash: 'abc1234' });

      expect(warnSpy).toHaveBeenCalledWith(
        'git.archive.media_copy.failed',
        expect.objectContaining({ exitCode: 1, stderr: 'cp: write error: No space left on device' })
      );
      warnSpy.mockRestore();
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
      // Flow: dist check -> manifest check (not found) -> contact-form check (not found) -> mkdir fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // contact-form.config.json check (not found)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Permission denied', timedOut: false, executionTimeMs: 0, taskId: 't' }); // mkdir fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to create output directory');
    });

    it('should throw error when tar command fails', async () => {
      // Flow: dist check -> manifest check (not found) -> contact-form check (not found) -> mkdir -> tar fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockTasks.runCommandSync
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // contact-form.config.json check (not found)
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

          // Flow: bundle check (exists) -> dist check -> manifest check -> contact-form check -> mkdir -> tar (dist only)
          // Note: bundle check happens first (in shouldIncludeSource), then dist check for dist-only archives
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // bundle check (exists)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // contact-form.config.json check (not found)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash);

          // Verify bundle check was called first
          const bundleCheckCall = mockTasks.runCommandSync.mock.calls[0][0];
          expect(bundleCheckCall.command).toContain('server.bundle.mjs');

          // Verify tar only archives dist/ (no exclusions)
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[5][0];
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

          // Flow: dist check -> manifest check (not found) -> contact-form check (not found) -> mkdir -> tar
          // Note: No bundle check because includeSource is explicit
          mockTasks.runCommandSync
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // dist/ check
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // airo-media.json check (not found)
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }) // contact-form.config.json check (not found)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' })  // mkdir output dir
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, executionTimeMs: 0, taskId: 't' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

          // Verify no bundle check was called (first call after dist check is manifest check)
          const secondCall = mockTasks.runCommandSync.mock.calls[1][0];
          expect(secondCall.command).not.toContain('server.bundle.mjs');

          // Verify tar only archives dist/
          const tarCallArgs = mockTasks.runCommandSync.mock.calls[4][0];
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

  describe('getCommitFileStats', () => {
    it('parses numstat output into entries with added/deleted counts', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '12\t3\tsrc/pages/about.tsx\n0\t0\tpublic/logo.png\n5\t1\tsrc/components/Header.tsx\n',
        stderr: '',
        timedOut: false,
        executionTimeMs: 5,
        taskId: 'test-task',
      });

      const result = await gitUtils.getCommitFileStats('/app', 'abc1234');

      expect(result).toEqual([
        { path: 'src/pages/about.tsx', added: 12, deleted: 3 },
        { path: 'public/logo.png', added: 0, deleted: 0 },
        { path: 'src/components/Header.tsx', added: 5, deleted: 1 },
      ]);
    });

    it('coerces non-numeric numstat columns (binary `-`) to 0', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '-\t-\tassets/image.png\n',
        stderr: '',
        timedOut: false,
        executionTimeMs: 5,
        taskId: 'test-task',
      });

      const result = await gitUtils.getCommitFileStats('/app', 'abc1234');

      expect(result).toEqual([{ path: 'assets/image.png', added: 0, deleted: 0 }]);
    });

    it('returns [] when the git command fails (e.g. ref unknown)', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 128,
        stdout: '',
        stderr: "fatal: bad revision 'abc~99'",
        timedOut: false,
        executionTimeMs: 5,
        taskId: 'test-task',
      });

      const result = await gitUtils.getCommitFileStats('/app', 'abc1234');

      expect(result).toEqual([]);
    });

    it('returns [] for an empty/whitespace-only stdout', async () => {
      mockTasks.runCommandSync.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '\n   \n',
        stderr: '',
        timedOut: false,
        executionTimeMs: 5,
        taskId: 'test-task',
      });

      const result = await gitUtils.getCommitFileStats('/app', 'abc1234');

      expect(result).toEqual([]);
    });
  });
});
