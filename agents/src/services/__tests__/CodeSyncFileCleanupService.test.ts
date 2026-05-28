import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { codeSyncFileCleanupService, CodeSyncFileCleanupService } from '../CodeSyncFileCleanupService.js';
import { ValidationErrorKey } from '../../types/import.js';
import type { WorkspaceTasks } from '../../workspace/tasks.js';
import { makeRunCommandResult } from '../../workspace/__tests__/mock-helpers.js';
import * as features from '../features.js';

describe('CodeSyncFileCleanupService', () => {
  describe('isCleanableFile', () => {
    it('should identify OS junk files', () => {
      expect(codeSyncFileCleanupService.isCleanableFile('.DS_Store')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('folder/.DS_Store')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('Thumbs.db')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('__MACOSX/._file')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('desktop.ini')).toBe(true);
    });

    it('should identify security-sensitive files', () => {
      expect(codeSyncFileCleanupService.isCleanableFile('.git/hooks/pre-commit')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('.git/config')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('.git/HEAD')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('certs/private.pem')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('server.key')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('.npmrc')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('.yarnrc')).toBe(true);
    });

    it('should identify IDE config', () => {
      expect(codeSyncFileCleanupService.isCleanableFile('.idea/workspace.xml')).toBe(true);
      expect(codeSyncFileCleanupService.isCleanableFile('.vscode/settings.json')).toBe(true);
    });

    it('should NOT mark regular files as cleanable', () => {
      expect(codeSyncFileCleanupService.isCleanableFile('package.json')).toBe(false);
      expect(codeSyncFileCleanupService.isCleanableFile('src/index.ts')).toBe(false);
      expect(codeSyncFileCleanupService.isCleanableFile('.gitignore')).toBe(false);
      expect(codeSyncFileCleanupService.isCleanableFile('README.md')).toBe(false);
    });

    it('should NOT match files that start with cleanable pattern but are different', () => {
      // .npmrc should NOT match .npmrcignore (hypothetical)
      expect(codeSyncFileCleanupService.isCleanableFile('.npmrcconfig')).toBe(false);
    });
  });

  describe('createWarnings', () => {
    it('should create validation errors for cleaned files', () => {
      const files = ['.DS_Store', '.npmrc'];
      const warnings = codeSyncFileCleanupService.createWarnings(files);

      expect(warnings).toHaveLength(2);
      expect(warnings[0].key).toBe(ValidationErrorKey.FILE_CLEANED);
      expect(warnings[0].message).toContain('.DS_Store');
      expect(warnings[1].message).toContain('.npmrc');
    });

    it('should return empty array for no files', () => {
      const warnings = codeSyncFileCleanupService.createWarnings([]);
      expect(warnings).toHaveLength(0);
    });

    it('should use neutral message instead of security-focused', () => {
      const warnings = codeSyncFileCleanupService.createWarnings(['.DS_Store']);
      expect(warnings[0].message).toBe('Removed during import: .DS_Store');
      expect(warnings[0].message).not.toContain('security');
    });
  });

  describe('deleteCleanablePatterns', () => {
    let mockTasks: WorkspaceTasks;

    beforeEach(() => {
      CodeSyncFileCleanupService.clearCache();
      mockTasks = {
        runCommandSync: vi.fn(),
      } as unknown as WorkspaceTasks;
    });

    afterEach(() => {
      CodeSyncFileCleanupService.clearCache();
    });

    it('should return success when exec succeeds', async () => {
      (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mockResolvedValue(makeRunCommandResult());

      const result = await codeSyncFileCleanupService.deleteCleanablePatterns(
        mockTasks,
        '/app'
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);
    });

    it('should return failure when command exits with non-zero exitCode', async () => {
      (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mockResolvedValue(makeRunCommandResult({ exitCode: 1, stderr: 'Command failed' }));

      const result = await codeSyncFileCleanupService.deleteCleanablePatterns(
        mockTasks,
        '/app'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed');
    });

    it('should return failure when exec throws an error', async () => {
      (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection failed')
      );

      const result = await codeSyncFileCleanupService.deleteCleanablePatterns(
        mockTasks,
        '/app'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });

    it('should build valid command with directory and file patterns', async () => {
      (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mockResolvedValue(makeRunCommandResult());

      await codeSyncFileCleanupService.deleteCleanablePatterns(mockTasks, '/app');

      const execCall = (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const command = execCall.command as string;

      // Should have rm command for directories (e.g., __MACOSX/, .idea/, .vscode/, .git/)
      expect(command).toContain('rm -rf');
      // Should have find command for files
      expect(command).toContain('find');
      // Should use single quotes for safety
      expect(command).toContain("'/app'");
      // Should have || true to prevent failures
      expect(command).toContain('|| true');
    });

    it('should omit excluded patterns from the generated command', async () => {
      (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mockResolvedValue(makeRunCommandResult());

      await codeSyncFileCleanupService.deleteCleanablePatterns(mockTasks, '/app', ['.git/']);

      const command = (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mock.calls[0][0].command as string;

      // .git/ must not appear in the rm command — deleting it would break subsequent pulls
      expect(command).not.toContain('/app/.git');
      // Other directory patterns should still be present
      expect(command).toContain('rm -rf');
    });

    it('should use single quotes in shell command for safety', async () => {
      (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mockResolvedValue(makeRunCommandResult());

      await codeSyncFileCleanupService.deleteCleanablePatterns(mockTasks, '/app');

      const execCall = (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const command = execCall.command as string;

      // Should use single quotes for paths and patterns
      expect(command).toContain("'/app");
      // Should NOT have double quotes around paths (vulnerable to shell expansion)
      expect(command).not.toMatch(/"\$\{/);
    });

    it('should reject patterns with shell injection characters', async () => {
      // Mock getZipImportLimits to return unsafe patterns
      const getZipImportLimitsSpy = vi.spyOn(features, 'getZipImportLimits').mockReturnValue({
        maxFileSize: 10 * 1024 * 1024,
        maxTotalSize: 100 * 1024 * 1024,
        maxFiles: 1000,
        maxCompressionRatio: 100,
        dangerousExtensions: [],
        cleanablePatterns: {
          osJunk: ['.DS_Store', '$(rm -rf /)'], // Unsafe pattern with command substitution
          securitySensitive: ['.env'],
          ideConfig: ['.idea/'],
        },
      });

      // Clear cache to pick up mocked values
      CodeSyncFileCleanupService.clearCache();

      const result = await codeSyncFileCleanupService.deleteCleanablePatterns(
        mockTasks,
        '/app'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsafe patterns detected');
      expect(result.error).toContain('$(rm -rf /)');
      // Should NOT have called exec
      expect(mockTasks.runCommandSync).not.toHaveBeenCalled();

      getZipImportLimitsSpy.mockRestore();
    });

    it('should reject patterns with backticks', async () => {
      const getZipImportLimitsSpy = vi.spyOn(features, 'getZipImportLimits').mockReturnValue({
        maxFileSize: 10 * 1024 * 1024,
        maxTotalSize: 100 * 1024 * 1024,
        maxFiles: 1000,
        maxCompressionRatio: 100,
        dangerousExtensions: [],
        cleanablePatterns: {
          osJunk: ['`whoami`'], // Unsafe pattern with backticks
          securitySensitive: [],
          ideConfig: [],
        },
      });

      CodeSyncFileCleanupService.clearCache();

      const result = await codeSyncFileCleanupService.deleteCleanablePatterns(
        mockTasks,
        '/app'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsafe patterns detected');
      expect(mockTasks.runCommandSync).not.toHaveBeenCalled();

      getZipImportLimitsSpy.mockRestore();
    });

    it('should reject patterns with quotes', async () => {
      const getZipImportLimitsSpy = vi.spyOn(features, 'getZipImportLimits').mockReturnValue({
        maxFileSize: 10 * 1024 * 1024,
        maxTotalSize: 100 * 1024 * 1024,
        maxFiles: 1000,
        maxCompressionRatio: 100,
        dangerousExtensions: [],
        cleanablePatterns: {
          osJunk: ["file'name"], // Unsafe pattern with single quote
          securitySensitive: [],
          ideConfig: [],
        },
      });

      CodeSyncFileCleanupService.clearCache();

      const result = await codeSyncFileCleanupService.deleteCleanablePatterns(
        mockTasks,
        '/app'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsafe patterns detected');
      expect(mockTasks.runCommandSync).not.toHaveBeenCalled();

      getZipImportLimitsSpy.mockRestore();
    });

    it('should allow safe patterns with alphanumeric, dots, slashes, underscores, and hyphens', async () => {
      const getZipImportLimitsSpy = vi.spyOn(features, 'getZipImportLimits').mockReturnValue({
        maxFileSize: 10 * 1024 * 1024,
        maxTotalSize: 100 * 1024 * 1024,
        maxFiles: 1000,
        maxCompressionRatio: 100,
        dangerousExtensions: [],
        cleanablePatterns: {
          osJunk: ['.DS_Store', 'Thumbs.db', '__MACOSX/'],
          securitySensitive: ['.env', '.git/', '.pem', '.key'],
          ideConfig: ['.idea/', '.vscode/'],
        },
      });

      CodeSyncFileCleanupService.clearCache();
      (mockTasks.runCommandSync as ReturnType<typeof vi.fn>).mockResolvedValue(makeRunCommandResult());

      const result = await codeSyncFileCleanupService.deleteCleanablePatterns(
        mockTasks,
        '/app'
      );

      expect(result.success).toBe(true);
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);

      getZipImportLimitsSpy.mockRestore();
    });
  });
});
