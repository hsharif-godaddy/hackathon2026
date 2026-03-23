/**
 * Unit tests for V4 bind mount setup methods
 * Tests setupGitRepoBindMount and setupAssetsBindMount for proper handling of:
 * - Race conditions (EEXIST errors)
 * - Idempotent operations
 * - Data loss prevention (merge strategy)
 * - Error handling with context
 * - Platform-specific symlinks (Windows junctions vs Unix symlinks)
 */

import { existsSync, promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevEnvironmentManager } from '../DevEnvironmentManager';

// Mock logger to avoid console spam in tests
vi.mock('../../request-context', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DevEnvironmentManager - Bind Mount Setup', () => {
  let testDir: string;
  let manager: DevEnvironmentManager;

  beforeEach(async () => {
    // Create temp directory for testing
    testDir = path.join(os.tmpdir(), `test-bind-mount-${Date.now()}`);
    await fsPromises.mkdir(testDir, { recursive: true });

    // Create manager instance
    manager = new DevEnvironmentManager();
  });

  afterEach(async () => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    }
  });

  describe('setupGitRepoBindMount', () => {
    it('should move .git from preview to git-repo and create symlink', async () => {
      const appId = 'test-app-1';
      const previewPath = path.join(testDir, 'preview');
      const gitRepoPath = path.join(testDir, 'git-repo');
      const previewGitPath = path.join(previewPath, '.git');
      const gitRepoGitPath = path.join(gitRepoPath, '.git');

      // Setup: Create preview/.git directory
      await fsPromises.mkdir(path.join(previewPath, '.git'), { recursive: true });
      await fsPromises.writeFile(path.join(previewGitPath, 'HEAD'), 'ref: refs/heads/main');
      await fsPromises.mkdir(gitRepoPath, { recursive: true });

      // Access private method for testing
      // @ts-expect-error - Testing private method
      await manager.setupGitRepoBindMount(appId, previewPath, gitRepoPath);

      // Verify .git was moved to git-repo
      expect(existsSync(gitRepoGitPath)).toBe(true);
      expect(existsSync(path.join(gitRepoGitPath, 'HEAD'))).toBe(true);

      // Verify preview/.git is now a symlink
      const stat = await fsPromises.lstat(previewGitPath);
      expect(stat.isSymbolicLink()).toBe(true);

      // Verify symlink target
      const target = await fsPromises.readlink(previewGitPath);
      expect(target).toBe('../git-repo/.git');
    });

    it('should handle race condition when symlink already exists (EEXIST)', async () => {
      const appId = 'test-app-race';
      const previewPath = path.join(testDir, 'preview');
      const gitRepoPath = path.join(testDir, 'git-repo');
      const previewGitPath = path.join(previewPath, '.git');
      const gitRepoGitPath = path.join(gitRepoPath, '.git');

      // Setup: Create git-repo/.git and symlink (simulating another process)
      await fsPromises.mkdir(gitRepoGitPath, { recursive: true });
      await fsPromises.writeFile(path.join(gitRepoGitPath, 'HEAD'), 'ref: refs/heads/main');
      await fsPromises.mkdir(previewPath, { recursive: true });
      // @ts-expect-error - Testing private method
      await manager.createDirectorySymlink('../git-repo/.git', previewGitPath);

      // Should not throw when symlink already exists
      await expect(
        (manager as any).setupGitRepoBindMount(appId, previewPath, gitRepoPath)
      ).resolves.not.toThrow();

      // Verify symlink still exists and points to correct target
      const stat = await fsPromises.lstat(previewGitPath);
      expect(stat.isSymbolicLink()).toBe(true);
    });

    it('should be idempotent - running twice should not cause errors', async () => {
      const appId = 'test-app-idempotent';
      const previewPath = path.join(testDir, 'preview');
      const gitRepoPath = path.join(testDir, 'git-repo');
      const previewGitPath = path.join(previewPath, '.git');

      // Setup: Create preview/.git
      await fsPromises.mkdir(path.join(previewPath, '.git'), { recursive: true });
      await fsPromises.writeFile(path.join(previewGitPath, 'HEAD'), 'ref: refs/heads/main');
      await fsPromises.mkdir(gitRepoPath, { recursive: true });

      // Run first time
      // @ts-expect-error - Testing private method
      await manager.setupGitRepoBindMount(appId, previewPath, gitRepoPath);

      // Run second time - should not throw
      await expect(
        (manager as any).setupGitRepoBindMount(appId, previewPath, gitRepoPath)
      ).resolves.not.toThrow();

      // Verify symlink still exists
      const stat = await fsPromises.lstat(previewGitPath);
      expect(stat.isSymbolicLink()).toBe(true);
    });

    it('should handle duplicate .git directories by removing preview copy', async () => {
      const appId = 'test-app-duplicate';
      const previewPath = path.join(testDir, 'preview');
      const gitRepoPath = path.join(testDir, 'git-repo');
      const previewGitPath = path.join(previewPath, '.git');
      const gitRepoGitPath = path.join(gitRepoPath, '.git');

      // Setup: Create both preview/.git and git-repo/.git (conflict scenario)
      await fsPromises.mkdir(previewGitPath, { recursive: true });
      await fsPromises.writeFile(path.join(previewGitPath, 'HEAD'), 'ref: refs/heads/preview');
      await fsPromises.mkdir(gitRepoGitPath, { recursive: true });
      await fsPromises.writeFile(path.join(gitRepoGitPath, 'HEAD'), 'ref: refs/heads/main');

      // Should handle duplicate by removing preview copy
      // @ts-expect-error - Testing private method
      await manager.setupGitRepoBindMount(appId, previewPath, gitRepoPath);

      // Verify preview/.git is now a symlink
      const stat = await fsPromises.lstat(previewGitPath);
      expect(stat.isSymbolicLink()).toBe(true);

      // Verify git-repo/.git still has the original content
      const content = await fsPromises.readFile(path.join(gitRepoGitPath, 'HEAD'), 'utf-8');
      expect(content).toBe('ref: refs/heads/main');
    });

    it('should throw error with context on failure', async () => {
      const appId = 'test-app-error';
      const previewPath = '/invalid/path/preview';
      const gitRepoPath = '/invalid/path/git-repo';

      // Should throw with context
      await expect(
        (manager as any).setupGitRepoBindMount(appId, previewPath, gitRepoPath)
      ).rejects.toThrow(/Failed to setup git-repo bind mount for app test-app-error/);
    });
  });

  describe('setupAssetsBindMount', () => {
    it('should move assets from preview to assets/ and remove preview/assets', async () => {
      const appId = 'test-app-assets';
      const previewPath = path.join(testDir, 'preview');
      const assetsPath = path.join(testDir, 'assets');
      const previewAssetsPath = path.join(previewPath, 'assets');

      // Setup: Create preview/assets with files
      await fsPromises.mkdir(path.join(previewAssetsPath, 'public'), { recursive: true });
      await fsPromises.mkdir(path.join(previewAssetsPath, 'private'), { recursive: true });
      await fsPromises.writeFile(path.join(previewAssetsPath, 'public', 'logo.png'), 'fake-image');
      await fsPromises.writeFile(path.join(previewAssetsPath, 'private', 'secret.txt'), 'secret-data');
      await fsPromises.mkdir(assetsPath, { recursive: true });

      // Run setup
      // @ts-expect-error - Testing private method
      await manager.setupAssetsBindMount(appId, previewPath, assetsPath);

      // Verify assets were copied to assets/
      expect(existsSync(path.join(assetsPath, 'public', 'logo.png'))).toBe(true);
      expect(existsSync(path.join(assetsPath, 'private', 'secret.txt'))).toBe(true);

      // Verify preview/assets no longer exists
      expect(existsSync(previewAssetsPath)).toBe(false);
    });

    it('should merge assets without data loss when destination exists', async () => {
      const appId = 'test-app-merge';
      const previewPath = path.join(testDir, 'preview');
      const assetsPath = path.join(testDir, 'assets');
      const previewAssetsPath = path.join(previewPath, 'assets');

      // Setup: Create assets in both locations
      // Existing assets in assets/
      await fsPromises.mkdir(path.join(assetsPath, 'public'), { recursive: true });
      await fsPromises.writeFile(path.join(assetsPath, 'public', 'existing.png'), 'existing-file');

      // New assets in preview/assets
      await fsPromises.mkdir(path.join(previewAssetsPath, 'public'), { recursive: true });
      await fsPromises.writeFile(path.join(previewAssetsPath, 'public', 'new.png'), 'new-file');
      await fsPromises.writeFile(path.join(previewAssetsPath, 'public', 'existing.png'), 'should-not-overwrite');

      // Run setup
      // @ts-expect-error - Testing private method
      await manager.setupAssetsBindMount(appId, previewPath, assetsPath);

      // Verify existing file was NOT overwritten
      const existingContent = await fsPromises.readFile(
        path.join(assetsPath, 'public', 'existing.png'),
        'utf-8'
      );
      expect(existingContent).toBe('existing-file');

      // Verify new file was added
      const newContent = await fsPromises.readFile(path.join(assetsPath, 'public', 'new.png'), 'utf-8');
      expect(newContent).toBe('new-file');

      // Verify preview/assets no longer exists
      expect(existsSync(previewAssetsPath)).toBe(false);
    });

    it('should remove preview/assets symlink if it already exists', async () => {
      const appId = 'test-app-assets-race';
      const previewPath = path.join(testDir, 'preview');
      const assetsPath = path.join(testDir, 'assets');
      const previewAssetsPath = path.join(previewPath, 'assets');

      // Setup: Create assets/ and symlink (simulating another process)
      await fsPromises.mkdir(path.join(assetsPath, 'public'), { recursive: true });
      await fsPromises.mkdir(path.join(assetsPath, 'private'), { recursive: true });
      await fsPromises.mkdir(previewPath, { recursive: true });
      // @ts-expect-error - Testing private method
      await manager.createDirectorySymlink('../assets', previewAssetsPath);

      // Should not throw when symlink already exists
      await expect(
        (manager as any).setupAssetsBindMount(appId, previewPath, assetsPath)
      ).resolves.not.toThrow();

      // Verify symlink was removed
      expect(existsSync(previewAssetsPath)).toBe(false);
    });

    it('should be idempotent - running twice should not cause errors', async () => {
      const appId = 'test-app-assets-idempotent';
      const previewPath = path.join(testDir, 'preview');
      const assetsPath = path.join(testDir, 'assets');
      const previewAssetsPath = path.join(previewPath, 'assets');

      // Setup: Create preview/assets
      await fsPromises.mkdir(path.join(previewAssetsPath, 'public'), { recursive: true });
      await fsPromises.writeFile(path.join(previewAssetsPath, 'public', 'logo.png'), 'fake-image');
      await fsPromises.mkdir(assetsPath, { recursive: true });

      // Run first time
      // @ts-expect-error - Testing private method
      await manager.setupAssetsBindMount(appId, previewPath, assetsPath);

      // Run second time - should not throw
      await expect(
        (manager as any).setupAssetsBindMount(appId, previewPath, assetsPath)
      ).resolves.not.toThrow();

      // Verify preview/assets no longer exists
      expect(existsSync(previewAssetsPath)).toBe(false);
    });

    it('should throw error with context on failure', async () => {
      const appId = 'test-app-assets-error';
      const previewPath = path.join(testDir, 'preview-error');
      const assetsPath = path.join(testDir, 'assets-error');
      const previewAssetsPath = path.join(previewPath, 'assets');
      const publicPath = path.join(previewAssetsPath, 'public');

      // Create preview/assets directory but make preview/assets/public a FILE (not directory)
      // This will cause filesystem operations to fail
      await fsPromises.mkdir(previewAssetsPath, { recursive: true });
      await fsPromises.writeFile(publicPath, 'not-a-directory');

      // Should throw with context when it tries to process the malformed assets
      await expect(
        (manager as any).setupAssetsBindMount(appId, previewPath, assetsPath)
      ).rejects.toThrow(/Failed to setup assets bind mount for app test-app-assets-error/);
    });
  });

  describe('createDirectorySymlink', () => {
    it('should create directory symlink on Unix-like systems', async () => {
      if (os.platform() === 'win32') {
        // Skip on Windows
        return;
      }

      const targetDir = path.join(testDir, 'target');
      const linkPath = path.join(testDir, 'link');

      // Create target directory
      await fsPromises.mkdir(targetDir, { recursive: true });
      await fsPromises.writeFile(path.join(targetDir, 'file.txt'), 'content');

      // Create symlink using relative path
      // @ts-expect-error - Testing private method
      await manager.createDirectorySymlink('./target', linkPath);

      // Verify symlink was created
      const stat = await fsPromises.lstat(linkPath);
      expect(stat.isSymbolicLink()).toBe(true);

      // Verify we can read through the symlink
      const content = await fsPromises.readFile(path.join(linkPath, 'file.txt'), 'utf-8');
      expect(content).toBe('content');
    });

    it('should create junction on Windows', async () => {
      if (os.platform() !== 'win32') {
        // Skip on non-Windows
        return;
      }

      const targetDir = path.join(testDir, 'target');
      const linkPath = path.join(testDir, 'link');

      // Create target directory
      await fsPromises.mkdir(targetDir, { recursive: true });
      await fsPromises.writeFile(path.join(targetDir, 'file.txt'), 'content');

      // Create junction using relative path
      // @ts-expect-error - Testing private method
      await manager.createDirectorySymlink('./target', linkPath);

      // Verify junction was created (lstat should show it as a symlink-like object)
      const stat = await fsPromises.lstat(linkPath);
      expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(true);

      // Verify we can read through the junction
      const content = await fsPromises.readFile(path.join(linkPath, 'file.txt'), 'utf-8');
      expect(content).toBe('content');
    });

    it('should handle absolute paths correctly', async () => {
      const targetDir = path.join(testDir, 'target');
      const linkPath = path.join(testDir, 'link');

      // Create target directory
      await fsPromises.mkdir(targetDir, { recursive: true });
      await fsPromises.writeFile(path.join(targetDir, 'file.txt'), 'content');

      // Create symlink using absolute path
      // @ts-expect-error - Testing private method
      await manager.createDirectorySymlink(targetDir, linkPath);

      // Verify we can read through the symlink/junction
      const content = await fsPromises.readFile(path.join(linkPath, 'file.txt'), 'utf-8');
      expect(content).toBe('content');
    });
  });
});
