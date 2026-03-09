/**
 * Git Utils Unit Tests
 *
 * Tests for GitUtils class methods, particularly the pull method
 * with allowUnrelatedHistories parameter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitUtils } from '../git.js';

// Mock DevSupervisorClient
const createMockDevSupervisor = () => ({
  isAvailable: vi.fn().mockReturnValue(true),
  exec: vi.fn().mockResolvedValue({
    success: true,
    exit_code: 0,
    stdout: 'Already up to date.',
    stderr: ''
  })
});

describe('GitUtils', () => {
  let gitUtils: GitUtils;
  let mockDevSupervisor: ReturnType<typeof createMockDevSupervisor>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevSupervisor = createMockDevSupervisor();
    gitUtils = new GitUtils(mockDevSupervisor as any);
  });

  describe('pull', () => {
    it('should execute git pull with -X when merge strategy specified', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs');

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).not.toContain('--allow-unrelated-histories');
      expect(callArgs.command).not.toContain('--no-rebase');
    });

    it('should execute git pull with --no-rebase when noRebase is true', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', false, true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('--no-rebase');
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
    });

    it('should execute git pull with --allow-unrelated-histories when set to true', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });

    it('should execute git pull without --allow-unrelated-histories when set to false', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', false);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).not.toContain('--allow-unrelated-histories');
    });

    it('should execute git pull without merge strategy when not specified', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {});

      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.stringContaining("git 'pull' 'origin' 'main'")
        })
      );

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).not.toContain('-X');
      expect(callArgs.command).not.toContain('--no-rebase');
    });

    it('should execute git pull with all options: noRebase, mergeStrategy, and allowUnrelatedHistories', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', true, true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('--no-rebase');
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });

    it('should execute git pull with allowUnrelatedHistories but without merge strategy', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, undefined, true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).not.toContain('-X');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });
  });

  describe('commitTree', () => {
    it('should create orphan commit when no parent specified', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: true,
        exit_code: 0,
        stdout: 'abc123def456\n',
        stderr: ''
      });

      await gitUtils.commitTree('/app', 'tree-hash-123', 'test message');

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('commit-tree');
      expect(callArgs.command).toContain('tree-hash-123');
      expect(callArgs.command).toContain('test message');
      expect(callArgs.command).not.toContain('-p');
    });

    it('should create commit with parent when parentHash specified', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: true,
        exit_code: 0,
        stdout: 'abc123def456\n',
        stderr: ''
      });

      await gitUtils.commitTree('/app', 'tree-hash-123', 'test message', { parentHash: 'parent-hash-456' });

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('commit-tree');
      expect(callArgs.command).toContain('tree-hash-123');
      expect(callArgs.command).toContain('-p');
      expect(callArgs.command).toContain('parent-hash-456');
      expect(callArgs.command).toContain('test message');
    });

    it('should return failure result when commit-tree fails', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: false,
        exit_code: 1,
        stdout: '',
        stderr: 'fatal: not a valid tree object'
      });

      const result = await gitUtils.commitTree('/app', 'bad-tree', 'test message');

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not a valid tree object');
    });
  });

  describe('getTreeHash', () => {
    it('should resolve tree hash for a ref', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: true,
        exit_code: 0,
        stdout: 'tree-hash-abc123\n',
        stderr: ''
      });

      const result = await gitUtils.getTreeHash('/app', 'HEAD');

      expect(result).toBe('tree-hash-abc123');
      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('rev-parse');
      expect(callArgs.command).toContain('HEAD^{tree}');
    });

    it('should throw when ref cannot be resolved', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: false,
        exit_code: 128,
        stdout: '',
        stderr: 'fatal: not a valid object name'
      });

      await expect(gitUtils.getTreeHash('/app', 'nonexistent')).rejects.toThrow(
        "Failed to get tree hash for 'nonexistent'"
      );
    });
  });

  describe('updateRef', () => {
    it('should update a ref to point to a commit', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: true,
        exit_code: 0,
        stdout: '',
        stderr: ''
      });

      await gitUtils.updateRef('/app', 'refs/heads/main', 'commit-hash-789');

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('update-ref');
      expect(callArgs.command).toContain('refs/heads/main');
      expect(callArgs.command).toContain('commit-hash-789');
    });

    it('should include old value for compare-and-swap when provided', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: true,
        exit_code: 0,
        stdout: '',
        stderr: ''
      });

      await gitUtils.updateRef('/app', 'refs/heads/main', 'new-hash', 'old-hash');

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('update-ref');
      expect(callArgs.command).toContain('refs/heads/main');
      expect(callArgs.command).toContain('new-hash');
      expect(callArgs.command).toContain('old-hash');
    });

    it('should throw when update-ref fails', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: false,
        exit_code: 1,
        stdout: '',
        stderr: 'fatal: update_ref failed'
      });

      await expect(
        gitUtils.updateRef('/app', 'refs/heads/main', 'commit-hash-789')
      ).rejects.toThrow("Failed to update ref 'refs/heads/main'");
    });
  });

  describe('addFiles', () => {
    it('should use 60 second default timeout for large repos', async () => {
      await gitUtils.addFiles('/app', ['.']);

      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60 // 60 seconds (60000ms converted to seconds for dev-supervisor)
        })
      );
    });

    it('should respect custom timeout when provided', async () => {
      await gitUtils.addFiles('/app', ['.'], { timeout: 180000 });

      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 180 // 180 seconds
        })
      );
    });

    it('should add specified files', async () => {
      await gitUtils.addFiles('/app', ['file1.txt', 'file2.txt']);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('git');
      expect(callArgs.command).toContain('add');
      expect(callArgs.command).toContain('file1.txt');
      expect(callArgs.command).toContain('file2.txt');
    });

    it('should add all files by default', async () => {
      await gitUtils.addFiles('/app');

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('git');
      expect(callArgs.command).toContain('add');
      expect(callArgs.command).toContain("'.'");
    });
  });

  describe('createArchive', () => {
    it('should throw error when dev-supervisor is not available', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(false);
      const gitUtilsUnavailable = new GitUtils(mockDevSupervisor as any);

      await expect(
        gitUtilsUnavailable.createArchive('/app', 'abc1234')
      ).rejects.toThrow('Archive creation requires dev-supervisor to be available');
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

    it('should throw error when dist/ folder does not exist', async () => {
      // Mock dist/ check to fail
      mockDevSupervisor.exec.mockResolvedValueOnce({
        success: false,
        exit_code: 1,
        stdout: '',
        stderr: ''
      });

      await expect(
        gitUtils.createArchive('/app', 'abc1234')
      ).rejects.toThrow('dist/ folder not found - application must be built before publishing');

      // Verify the dist/ check was called
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.stringContaining('test'),
          working_dir: '/app'
        })
      );
    });

    it('should create archive when dist/ folder exists (no manifest)', async () => {
      const commitHash = 'abc1234';

      // Flow: dist check -> manifest check (not found) -> mkdir -> tar
      // Note: Using explicit includeSource: false to skip auto-detect
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
        .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: '' }) // airo-media.json check (not found)
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      // Verify 4 calls: dist check, manifest check, mkdir, tar
      expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(4);

      // Verify tar archives dist/
      const tarCallArgs = mockDevSupervisor.exec.mock.calls[3][0];
      expect(tarCallArgs.command).toContain('tar');
      expect(tarCallArgs.command).toContain('dist');
    });

    it('should copy airo-media.json into dist/ when it exists', async () => {
      const commitHash = 'abc1234';

      // Flow: dist check -> manifest check (found) -> copy manifest -> mkdir -> tar
      // Note: Using explicit includeSource: false to skip auto-detect
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // cp airo-media.json dist/
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

      const result = await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

      expect(result).toEqual({
        path: expect.stringContaining(`${commitHash}.tar.gz`),
        commitHash
      });

      // Verify 5 calls including the copy
      expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(5);

      // Verify manifest was copied to dist/
      const copyCallArgs = mockDevSupervisor.exec.mock.calls[2][0];
      expect(copyCallArgs.command).toContain('cp');
      expect(copyCallArgs.command).toContain('airo-media.json');
      expect(copyCallArgs.command).toContain('dist/airo-media.json');

      // Verify final tar only archives dist/
      const tarCallArgs = mockDevSupervisor.exec.mock.calls[4][0];
      expect(tarCallArgs.command).toContain('tar');
      expect(tarCallArgs.command).toContain('dist');
    });

    it('should throw error when copying airo-media.json fails', async () => {
      // Flow: dist check -> manifest check (found) -> copy fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // airo-media.json check (found)
        .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: 'Permission denied' }); // cp fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to copy airo-media.json to dist/');

      // Verify the copy command was attempted
      expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(3);
      const copyCallArgs = mockDevSupervisor.exec.mock.calls[2][0];
      expect(copyCallArgs.command).toContain('cp');
      expect(copyCallArgs.command).toContain('airo-media.json');
    });

    it('should throw error when mkdir fails', async () => {
      // Flow: dist check -> manifest check (not found) -> mkdir fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
        .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: '' }) // airo-media.json check
        .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: 'Permission denied' }); // mkdir fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to create output directory');
    });

    it('should throw error when tar command fails', async () => {
      // Flow: dist check -> manifest check (not found) -> mkdir -> tar fails
      // Note: Using explicit includeSource: false to skip auto-detect
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
        .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: '' }) // airo-media.json check
        .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir succeeds
        .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: 'No space left on device' }); // tar fails

      await expect(
        gitUtils.createArchive('/app', 'abc1234', undefined, { includeSource: false })
      ).rejects.toThrow('Failed to create archive');
    });

    describe('includeSource option', () => {
      describe('auto-detect (when includeSource not specified)', () => {
        it('should auto-detect dist-only when dist/server.bundle.cjs exists', async () => {
          const commitHash = 'abc1234';

          // Flow: dist check -> bundle check (exists) -> manifest check -> mkdir -> tar (dist only)
          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // bundle check (exists)
            .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: '' }) // airo-media.json check (not found)
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash);

          // Verify bundle check was called
          const bundleCheckCall = mockDevSupervisor.exec.mock.calls[1][0];
          expect(bundleCheckCall.command).toContain('server.bundle.cjs');

          // Verify tar only archives dist/ (no exclusions)
          const tarCallArgs = mockDevSupervisor.exec.mock.calls[4][0];
          expect(tarCallArgs.command).toContain('dist');
          expect(tarCallArgs.command).not.toContain('--exclude');
        });

        it('should auto-detect full-source when dist/server.bundle.cjs does not exist', async () => {
          const commitHash = 'abc1234';

          // Flow: dist check -> bundle check (not exists) -> mkdir -> tar (full source with exclusions)
          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
            .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: '' }) // bundle check (not exists)
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash);

          // Verify tar archives full source with exclusions
          const tarCallArgs = mockDevSupervisor.exec.mock.calls[3][0];
          expect(tarCallArgs.command).toContain('tar');
          expect(tarCallArgs.command).toContain('--exclude');
          expect(tarCallArgs.command).toContain('node_modules');
          expect(tarCallArgs.command).toContain("'.'");
        });
      });

      describe('explicit override', () => {
        it('should use dist-only when includeSource is explicitly false (skip auto-detect)', async () => {
          const commitHash = 'abc1234';

          // Flow: dist check -> manifest check (not found) -> mkdir -> tar
          // Note: No bundle check because includeSource is explicit
          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
            .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: '', stderr: '' }) // airo-media.json check (not found)
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: false });

          // Verify no bundle check was called (first call after dist check is manifest check)
          const secondCall = mockDevSupervisor.exec.mock.calls[1][0];
          expect(secondCall.command).not.toContain('server.bundle.cjs');

          // Verify tar only archives dist/
          const tarCallArgs = mockDevSupervisor.exec.mock.calls[3][0];
          expect(tarCallArgs.command).toContain('dist');
          expect(tarCallArgs.command).not.toContain('--exclude');
        });

        it('should use full-source when includeSource is explicitly true (skip auto-detect)', async () => {
          const commitHash = 'abc1234';

          // Flow: dist check -> mkdir -> tar (with exclusions)
          // Note: No bundle check because includeSource is explicit
          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          // Verify no bundle check was called
          expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(3);
          const allCommands = mockDevSupervisor.exec.mock.calls.map(call => call[0].command);
          const hasBundleCheck = allCommands.some(cmd => cmd.includes('server.bundle.cjs'));
          expect(hasBundleCheck).toBe(false);

          // Verify tar archives full source with exclusions
          const tarCallArgs = mockDevSupervisor.exec.mock.calls[2][0];
          expect(tarCallArgs.command).toContain('--exclude');
          expect(tarCallArgs.command).toContain("'.'");
        });
      });

      describe('full source archive behavior', () => {
        it('should exclude node_modules, .git, and .env files in full source archive', async () => {
          const commitHash = 'abc1234';

          // Flow: dist check -> mkdir -> tar (with exclusions)
          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          // Verify all exclusions are present
          const tarCallArgs = mockDevSupervisor.exec.mock.calls[2][0];
          expect(tarCallArgs.command).toMatch(/--exclude.*node_modules/);
          expect(tarCallArgs.command).toMatch(/--exclude.*\.git/);
          expect(tarCallArgs.command).toMatch(/--exclude.*\.env/);
        });

        it('should exclude untracked files in full source archive when git reports them', async () => {
          const commitHash = 'abc1234';

          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }) // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }) // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: 'test.json\u0000tmp/cache.db\u0000', stderr: '' }) // list untracked
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true });

          const tarCallArgs = mockDevSupervisor.exec.mock.calls[3][0];
          expect(tarCallArgs.command).toContain('--exclude=test.json');
          expect(tarCallArgs.command).toContain('--exclude=tmp/cache.db');
        });

        it('should preserve leading and trailing spaces in untracked file names', async () => {
          const commitHash = 'abc1234';

          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }) // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }) // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: ' leading.txt\u0000trailing.txt \u0000', stderr: '' }) // list untracked
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true });

          const tarCallArgs = mockDevSupervisor.exec.mock.calls[3][0];
          expect(tarCallArgs.command).toContain('--exclude= leading.txt');
          expect(tarCallArgs.command).toContain('--exclude=trailing.txt ');
        });

        it('should continue archive creation when listing untracked files fails', async () => {
          const commitHash = 'abc1234';

          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }) // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }) // mkdir output dir
            .mockResolvedValueOnce({
              success: false,
              exit_code: 1,
              stdout: '',
              stderr: 'not a git repository',
            }) // list untracked (fails)
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await expect(
            gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true, excludeUntracked: true })
          ).resolves.toEqual({
            path: '/publish/dist/abc1234.tar.gz',
            commitHash: 'abc1234',
          });

          expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(4);
          const tarCallArgs = mockDevSupervisor.exec.mock.calls[3][0];
          expect(tarCallArgs.command).not.toContain('--exclude=test.json');
          expect(tarCallArgs.command).not.toContain('--exclude=tmp/cache.db');
        });

        it('should skip airo-media.json copy when includeSource is true (included in full archive)', async () => {
          const commitHash = 'abc1234';

          // Flow: dist check -> mkdir -> tar
          // Note: No manifest check or copy when includeSource is true
          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          // Should only have 3 calls: dist check, mkdir, tar
          // No manifest check or copy because full source includes everything
          expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(3);

          // Verify no cp command was called
          const allCommands = mockDevSupervisor.exec.mock.calls.map(call => call[0].command);
          const hasCopy = allCommands.some(cmd => cmd.includes('cp') && cmd.includes('airo-media.json'));
          expect(hasCopy).toBe(false);
        });

        it('should archive from root directory when includeSource is true', async () => {
          const commitHash = 'abc1234';

          mockDevSupervisor.exec
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // dist/ check
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' })  // mkdir output dir
            .mockResolvedValueOnce({ success: true, exit_code: 0, stdout: '', stderr: '' }); // tar

          await gitUtils.createArchive('/app', commitHash, undefined, { includeSource: true });

          // Verify tar uses '.' to archive from root
          const tarCallArgs = mockDevSupervisor.exec.mock.calls[2][0];
          expect(tarCallArgs.command).toContain("'.'");
        });
      });
    });
  });
});
