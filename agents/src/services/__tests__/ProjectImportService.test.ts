/**
 * ProjectImportService tests
 *
 * Tests for project root finding logic that handles nested zip structures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectImportService } from '../ProjectImportService.js';
import type { DevSupervisorClient } from '../DevSupervisorClient.js';

// Mock dependencies
vi.mock('../../database/repositories/ImportJobRepository.js');
vi.mock('../../database/repositories/AppRepository.js');
vi.mock('../ZipSecurityService.js');
vi.mock('../GitCloneService.js');
vi.mock('../CodeSyncFileCleanupService.js');
vi.mock('../ViteConfigModifier.js');
vi.mock('../AppRestartService.js');
vi.mock('../ExpressPortInjector.js');
vi.mock('../../tools/git-tool.js');
vi.mock('../../utils/dev-supervisor-client-factory.js');

/**
 * Create a mock DevSupervisorClient that simulates a specific directory structure
 */
function createMockDevSupervisor(
  structure: Record<string, string[] | 'package.json'>
): DevSupervisorClient {
  return {
    exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
      // Parse test -f command for package.json check
      const packageJsonMatch = command.match(/test -f "([^"]+)\/package\.json"/);
      if (packageJsonMatch) {
        const path = packageJsonMatch[1];
        const hasPackageJson = structure[path] === 'package.json';
        return {
          success: true,
          stdout: hasPackageJson ? 'found' : 'notfound',
          stderr: '',
          exit_code: 0,
        };
      }

      // Parse ls -1 command for directory listing
      const lsMatch = command.match(/ls -1 "([^"]+)"/);
      if (lsMatch) {
        const path = lsMatch[1];
        const entries = structure[path];
        if (Array.isArray(entries)) {
          return {
            success: true,
            stdout: entries.join('\n'),
            stderr: '',
            exit_code: 0,
          };
        }
        // Path not in structure map - simulate ls failure on non-existent directory
        return {
          success: false,
          stdout: '',
          stderr: `ls: cannot access '${path}': No such file or directory`,
          exit_code: 2,
        };
      }

      return { success: true, stdout: '', stderr: '', exit_code: 0 };
    }),
  } as unknown as DevSupervisorClient;
}

describe('ProjectImportService', () => {
  let service: ProjectImportService;

  beforeEach(() => {
    service = new ProjectImportService();
  });

  describe('findProjectRootInContainer', () => {
    // Access private method for testing
    const findProjectRoot = async (
      service: ProjectImportService,
      devSupervisor: DevSupervisorClient,
      extractPath: string
    ) => {
      // Use bracket notation to access private method
      return (service as unknown as {
        findProjectRootInContainer: (
          devSupervisor: DevSupervisorClient,
          extractPath: string
        ) => Promise<{ found: boolean; projectRoot?: string; depth?: number }>;
      }).findProjectRootInContainer(devSupervisor, extractPath);
    };

    it('should find package.json at root (depth 0)', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': 'package.json',
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(true);
      expect(result.projectRoot).toBe('/app/.import-123-extract');
      expect(result.depth).toBe(0);
    });

    it('should find package.json in single subdirectory (depth 1)', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['my-app'],
        '/app/.import-123-extract/my-app': 'package.json',
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(true);
      expect(result.projectRoot).toBe('/app/.import-123-extract/my-app');
      expect(result.depth).toBe(1);
    });

    it('should find package.json in double-nested structure (depth 2)', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['parent'],
        '/app/.import-123-extract/parent': ['my-app'],
        '/app/.import-123-extract/parent/my-app': 'package.json',
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(true);
      expect(result.projectRoot).toBe('/app/.import-123-extract/parent/my-app');
      expect(result.depth).toBe(2);
    });

    it('should ignore __MACOSX directory when finding project root', async () => {
      // This is the common macOS zip structure
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['vite-app', '__MACOSX'],
        '/app/.import-123-extract/vite-app': 'package.json',
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(true);
      expect(result.projectRoot).toBe('/app/.import-123-extract/vite-app');
      expect(result.depth).toBe(1);
    });

    it('should ignore .DS_Store when finding project root', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['my-project', '.DS_Store'],
        '/app/.import-123-extract/my-project': 'package.json',
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(true);
      expect(result.projectRoot).toBe('/app/.import-123-extract/my-project');
      expect(result.depth).toBe(1);
    });

    it('should handle nested structure with __MACOSX at multiple levels', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['outer', '__MACOSX'],
        '/app/.import-123-extract/outer': ['inner', '__MACOSX'],
        '/app/.import-123-extract/outer/inner': 'package.json',
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(true);
      expect(result.projectRoot).toBe('/app/.import-123-extract/outer/inner');
      expect(result.depth).toBe(2);
    });

    it('should stop at max depth (3 levels)', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['level1'],
        '/app/.import-123-extract/level1': ['level2'],
        '/app/.import-123-extract/level1/level2': ['level3'],
        '/app/.import-123-extract/level1/level2/level3': ['level4'],
        '/app/.import-123-extract/level1/level2/level3/level4': 'package.json',
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      // Should not find it because it's at depth 4 (beyond max of 3)
      expect(result.found).toBe(false);
    });

    it('should fail when multiple directories exist (ambiguous)', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['app1', 'app2'],
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(false);
    });

    it('should fail when multiple directories exist after filtering ignored ones', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['app1', 'app2', '__MACOSX'],
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      // Still fails because app1 and app2 remain after filtering __MACOSX
      expect(result.found).toBe(false);
    });

    it('should fail when directory is empty', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': [],
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(false);
    });

    it('should fail when only ignored directories exist', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['__MACOSX', '.DS_Store'],
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(false);
    });

    it('should fail when no package.json exists at any level', async () => {
      const mockDevSupervisor = createMockDevSupervisor({
        '/app/.import-123-extract': ['my-app'],
        '/app/.import-123-extract/my-app': ['src', 'public'],
      });

      const result = await findProjectRoot(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract'
      );

      expect(result.found).toBe(false);
    });
  });
});
