/**
 * ProjectImportService tests
 *
 * Tests for:
 * - Smart start command selection (npm/yarn/pnpm)
 * - Project root finding logic that handles nested zip structures
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { ProjectImportService, resolveStartCommand } from '../ProjectImportService.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { ImportJobRepository } from '../../database/repositories/ImportJobRepository.js';
import { appRestartService } from '../AppRestartService.js';
import type { DevSupervisorClient } from '../DevSupervisorClient.js';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { projectSourceDetectionService } from '../ProjectSourceDetectionService.js';
import { zipSecurityService } from '../ZipSecurityService.js';
import { codeSyncFileCleanupService } from '../CodeSyncFileCleanupService.js';

// Mock dependencies
vi.mock('../../utils/dev-supervisor-client-factory.js');
vi.mock('../../database/repositories/AppRepository.js');
vi.mock('../../database/repositories/ImportJobRepository.js');
vi.mock('../AppRestartService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AppRestartService.js')>();
  return {
    ...actual,
    // Keep real utility functions but mock the service singleton
    appRestartService: {
      stopDevServer: vi.fn(),
      runInstall: vi.fn(),
      runBuild: vi.fn(),
      createPaasConfig: vi.fn(),
      restartDevServer: vi.fn(),
    },
  };
});
vi.mock('../ZipSecurityService.js');
vi.mock('../GitCloneService.js');
vi.mock('../CodeSyncFileCleanupService.js');
vi.mock('../ProjectSourceDetectionService.js', () => ({
  projectSourceDetectionService: {
    detectAndLogInBackground: vi.fn(),
  },
}));
vi.mock('../ZipSecurityService.js', () => ({
  zipSecurityService: {
    validate: vi.fn(),
  },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});
vi.mock('../../utils/container-metrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/container-metrics.js')>();
  return {
    ...actual,
    measureAppDirSize: vi.fn().mockResolvedValue(0),
  };
});
vi.mock('../ViteConfigModifier.js');
vi.mock('../ExpressPortInjector.js');
vi.mock('../../tools/git-tool.js');
vi.mock('node:fs/promises');
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => mockLogger,
  },
  logger: mockLogger,
}));

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
  describe('Smart Start Command Selection', () => {
    let service: ProjectImportService;
    let mockDevSupervisor: {
      exec: Mock;
      stopProcess: Mock;
      restartProcess: Mock;
      startProcess: Mock;
    };
    let mockAppRepo: {
      findById: Mock;
      updateStatus: Mock;
    };
    let mockImportJobRepo: {
      create: Mock;
      update: Mock;
      markCompleted: Mock;
      markFailed: Mock;
    };

    const testAppId = 'test-app-123';
    const testJobId = 'test-job-456';

    beforeEach(() => {
      vi.clearAllMocks();

      // Create mock DevSupervisor client
      mockDevSupervisor = {
        exec: vi.fn(),
        stopProcess: vi.fn().mockResolvedValue(true),
        restartProcess: vi.fn().mockResolvedValue({ success: true }),
        startProcess: vi.fn().mockResolvedValue({ state: 'running' }),
      };

      // Create mock repositories
      mockAppRepo = {
        findById: vi.fn().mockReturnValue({
          id: testAppId,
          path: `/tmp/apps/${testAppId}/app`,
          status: 'created',
        }),
        updateStatus: vi.fn(),
      };

      mockImportJobRepo = {
        create: vi.fn().mockReturnValue({ id: testJobId }),
        update: vi.fn(),
        markCompleted: vi.fn(),
        markFailed: vi.fn(),
      };

      // Setup factory mock
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor as any);

      // Setup repository mocks
      vi.mocked(AppRepository).mockImplementation(() => mockAppRepo as any);
      vi.mocked(ImportJobRepository).mockImplementation(() => mockImportJobRepo as any);

      // Setup AppRestartService mocks
      vi.mocked(appRestartService.stopDevServer).mockResolvedValue({ success: true });
      vi.mocked(appRestartService.runInstall).mockResolvedValue({ success: true, output: '' });
      vi.mocked(appRestartService.runBuild).mockResolvedValue({ success: true, output: '' });
      vi.mocked(appRestartService.createPaasConfig).mockResolvedValue();
      vi.mocked(appRestartService.restartDevServer).mockResolvedValue({ success: true });

      // Setup fs mocks
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      service = new ProjectImportService();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Helper to setup mock exec responses for validateProjectInContainer
     */
    function setupValidationMocks(packageJson: object, options: {
      hasGitignore?: boolean;
      hasPnpmLock?: boolean;
      hasYarnLock?: boolean;
    } = {}) {
      mockDevSupervisor.exec.mockImplementation(async ({ command }: { command: string }) => {
        // Check for package.json at root
        if (command.includes('test -f') && command.includes('package.json')) {
          return { success: true, stdout: 'found' };
        }
        // Check for .gitignore
        if (command.includes('test -f') && command.includes('.gitignore')) {
          return { success: true, stdout: options.hasGitignore ? 'found' : 'notfound' };
        }
        // Check for pnpm-lock.yaml
        if (command.includes('pnpm-lock.yaml')) {
          return { success: true, stdout: options.hasPnpmLock ? 'found' : '' };
        }
        // Check for yarn.lock
        if (command.includes('yarn.lock')) {
          return { success: true, stdout: options.hasYarnLock ? 'found' : '' };
        }
        // Read package.json
        if (command.includes('cat') && command.includes('package.json')) {
          return { success: true, stdout: JSON.stringify(packageJson) };
        }
        // Check for vite.config (build tool detection)
        if (command.includes('test -f') && command.includes('vite.config')) {
          return { success: true, stdout: 'found' };
        }
        // Default
        return { success: true, stdout: '' };
      });
    }

    describe('Script Detection (hasStartScript vs hasDevScript)', () => {
      it('should detect hasStartScript=true when start script exists', async () => {
        const packageJson = {
          name: 'test-app',
          scripts: {
            start: 'node server.js',
            build: 'tsc',
          },
        };
        setupValidationMocks(packageJson);

        // Access the private method via reflection for testing
        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.valid).toBe(true);
        expect(validation.hasStartScript).toBe(true);
        expect(validation.hasDevScript).toBe(true); // true because start exists
      });

      it('should detect hasStartScript=false, hasDevScript=true when only dev script exists', async () => {
        const packageJson = {
          name: 'test-app',
          scripts: {
            dev: 'vite',
            build: 'vite build',
          },
        };
        setupValidationMocks(packageJson);

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.valid).toBe(true);
        expect(validation.hasStartScript).toBe(false);
        expect(validation.hasDevScript).toBe(true); // true because dev exists
      });

      it('should detect both hasStartScript and hasDevScript when both exist', async () => {
        const packageJson = {
          name: 'test-app',
          scripts: {
            start: 'node server.js',
            dev: 'nodemon server.js',
            build: 'tsc',
          },
        };
        setupValidationMocks(packageJson);

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.valid).toBe(true);
        expect(validation.hasStartScript).toBe(true);
        expect(validation.hasDevScript).toBe(true);
      });

      it('should detect hasStartScript=false, hasDevScript=false when no runnable scripts', async () => {
        const packageJson = {
          name: 'test-app',
          scripts: {
            build: 'tsc',
            test: 'vitest',
          },
        };
        setupValidationMocks(packageJson);

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.valid).toBe(true);
        expect(validation.hasStartScript).toBe(false);
        expect(validation.hasDevScript).toBe(false);
      });

      it('should handle package.json with no scripts object', async () => {
        const packageJson = {
          name: 'test-app',
          dependencies: {},
        };
        setupValidationMocks(packageJson);

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.valid).toBe(true);
        expect(validation.hasStartScript).toBe(false);
        expect(validation.hasDevScript).toBe(false);
      });
    });

    describe('resolveStartCommand', () => {
      // Priority: user-provided → scripts.start → scripts.dev → default.
      // Each case asserts BOTH the resolved command AND the serveCommandSource
      // attribution that gets forwarded to `createPaasConfig` and the
      // `project-import.config.create` Loki event — a regression that always
      // emitted e.g. `'default'` would be invisible without this assertion.

      it('uses user-provided command with attribution "user" (highest priority, even when scripts exist)', () => {
        const result = resolveStartCommand(
          'node custom-server.js',
          { hasStartScript: true, hasDevScript: true },
          'npm'
        );
        expect(result).toEqual({ startCommand: 'node custom-server.js', serveCommandSource: 'user' });
      });

      it('uses user-provided command with attribution "user" even when no scripts exist', () => {
        const result = resolveStartCommand(
          'python app.py',
          { hasStartScript: false, hasDevScript: false },
          'npm'
        );
        expect(result).toEqual({ startCommand: 'python app.py', serveCommandSource: 'user' });
      });

      it('prefers scripts.start over scripts.dev when both are present', () => {
        const result = resolveStartCommand(undefined, { hasStartScript: true, hasDevScript: true }, 'npm');
        expect(result).toEqual({ startCommand: 'npm start', serveCommandSource: 'scripts.start' });
      });

      it('falls back to scripts.dev with NODE_ENV=development when only dev script exists (Vite)', () => {
        const result = resolveStartCommand(undefined, { hasStartScript: false, hasDevScript: true }, 'npm');
        expect(result).toEqual({
          startCommand: 'NODE_ENV=development npm run dev',
          serveCommandSource: 'scripts.dev',
        });
      });

      it('falls back to DEFAULT_START_COMMAND with attribution "default" when no scripts exist', () => {
        const result = resolveStartCommand(undefined, { hasStartScript: false, hasDevScript: false }, 'npm');
        expect(result.serveCommandSource).toBe('default');
        // startCommand value comes from AppRestartService.DEFAULT_START_COMMAND — assert a plausible shape
        expect(typeof result.startCommand).toBe('string');
        expect(result.startCommand.length).toBeGreaterThan(0);
      });

      it.each([
        ['npm', 'npm start', 'NODE_ENV=development npm run dev'],
        ['yarn', 'yarn start', 'NODE_ENV=development yarn run dev'],
        ['pnpm', 'pnpm start', 'NODE_ENV=development pnpm run dev'],
      ])('resolves correctly for packageManager=%s', (pm, expectedStart, expectedDev) => {
        expect(
          resolveStartCommand(undefined, { hasStartScript: true, hasDevScript: false }, pm)
        ).toEqual({ startCommand: expectedStart, serveCommandSource: 'scripts.start' });
        expect(
          resolveStartCommand(undefined, { hasStartScript: false, hasDevScript: true }, pm)
        ).toEqual({ startCommand: expectedDev, serveCommandSource: 'scripts.dev' });
      });
    });

    describe('Package Manager Detection', () => {
      it('should detect npm as default package manager', async () => {
        const packageJson = { name: 'test-app', scripts: { start: 'node index.js' } };
        setupValidationMocks(packageJson);

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.packageManager).toBe('npm');
      });

      it('should detect pnpm when pnpm-lock.yaml exists', async () => {
        const packageJson = { name: 'test-app', scripts: { start: 'node index.js' } };
        setupValidationMocks(packageJson, { hasPnpmLock: true });

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.packageManager).toBe('pnpm');
      });

      it('should detect yarn when yarn.lock exists', async () => {
        const packageJson = { name: 'test-app', scripts: { start: 'node index.js' } };
        setupValidationMocks(packageJson, { hasYarnLock: true });

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.packageManager).toBe('yarn');
      });
    });

    describe('Build Script Detection', () => {
      it('should detect hasBuildScript=true when build script exists', async () => {
        const packageJson = {
          name: 'test-app',
          scripts: {
            build: 'vite build',
            dev: 'vite',
          },
        };
        setupValidationMocks(packageJson);

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.hasBuildScript).toBe(true);
      });

      it('should detect hasBuildScript=false when no build script', async () => {
        const packageJson = {
          name: 'test-app',
          scripts: {
            dev: 'vite',
          },
        };
        setupValidationMocks(packageJson);

        const validation = await (service as any).validateProjectInContainer(
          mockDevSupervisor,
          '/tmp/extract'
        );

        expect(validation.hasBuildScript).toBe(false);
      });
    });
  });

  describe('findProjectRootInContainer', () => {
    let service: ProjectImportService;

    beforeEach(() => {
      service = new ProjectImportService();
    });

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

  describe('copyFilesInContainer', () => {
    let service: ProjectImportService;

    beforeEach(() => {
      service = new ProjectImportService();
    });

    // Access private method for testing
    const copyFilesInContainer = async (
      service: ProjectImportService,
      devSupervisor: { exec: ReturnType<typeof vi.fn> },
      projectRoot: string,
      appPath: string
    ) => {
      return (service as unknown as {
        copyFilesInContainer: (
          devSupervisor: { exec: ReturnType<typeof vi.fn> },
          projectRoot: string,
          appPath: string
        ) => Promise<{ success: boolean; error?: string }>;
      }).copyFilesInContainer(devSupervisor, projectRoot, appPath);
    };

    it('should succeed when /app/public directory exists and cleanup succeeds', async () => {
      // Simulates: /app/public exists, both main cleanup and public cleanup succeed
      const mockDevSupervisor = {
        exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
          // Cleanup command - directory exists and find succeeds
          if (command.includes('find "/app"') && command.includes('-exec rm -rf')) {
            return { success: true, stdout: '', stderr: '', exit_code: 0 };
          }
          // Copy command succeeds
          if (command.includes('-exec cp -r')) {
            return { success: true, stdout: '', stderr: '', exit_code: 0 };
          }
          return { success: true, stdout: '', stderr: '', exit_code: 0 };
        }),
      };

      const result = await copyFilesInContainer(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract/my-app',
        '/tmp/apps/test-app/app'
      );

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(2); // cleanup + copy
    });

    it('should succeed when /app/public directory does NOT exist (graceful handling via || true)', async () => {
      // Simulates fresh app where /app/public doesn't exist yet
      // The command `{ [ -d "/app/public" ] && find ... || true; }` handles this:
      // - [ -d "/app/public" ] returns false (dir doesn't exist)
      // - && short-circuits, find doesn't run
      // - || true makes the whole expression succeed
      // The shell still reports success=true because of || true
      const mockDevSupervisor = {
        exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
          // The cleanup command succeeds even when public dir doesn't exist
          // because the shell evaluates: `mainCleanup && { false || true }` = true
          if (command.includes('find "/app"') && command.includes('-exec rm -rf')) {
            return { success: true, stdout: '', stderr: '', exit_code: 0 };
          }
          if (command.includes('-exec cp -r')) {
            return { success: true, stdout: '', stderr: '', exit_code: 0 };
          }
          return { success: true, stdout: '', stderr: '', exit_code: 0 };
        }),
      };

      const result = await copyFilesInContainer(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract/my-app',
        '/tmp/apps/test-app/app'
      );

      expect(result.success).toBe(true);
    });

    it('should verify cleanup command structure with regex for graceful public directory handling', async () => {
      let cleanupCommand = '';
      const mockDevSupervisor = {
        exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
          if (command.includes('find "/app"') && command.includes('-exec rm -rf')) {
            cleanupCommand = command;
          }
          return { success: true, stdout: '', stderr: '', exit_code: 0 };
        }),
      };

      await copyFilesInContainer(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract/my-app',
        '/tmp/apps/test-app/app'
      );

      // Verify the cleanup command structure using regex for robustness
      // Pattern: `{ [ -d "/app/public" ] && find "/app/public" ... || true; }`
      // The braces are essential - they ensure || true only applies to public cleanup,
      // not the main cleanup (which must fail properly on errors)
      expect(cleanupCommand).toMatch(/\{\s*\[\s*-d\s+"[^"]+\/public"\s*\]\s*&&.*\|\|\s*true\s*;\s*\}/);

      // Also verify specific components
      expect(cleanupCommand).toContain('[ -d "/app/public" ]'); // Directory existence check
      expect(cleanupCommand).toContain('|| true'); // Fallback to success
      expect(cleanupCommand).toContain('! -name "assets"'); // Preserve assets directory
    });

    it('should fail when main cleanup command fails (error propagates correctly)', async () => {
      // Tests that main cleanup failures are NOT masked by || true
      // The braces `{ ... || true; }` ensure || true only applies to public cleanup
      const mockDevSupervisor = {
        exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
          // Main cleanup fails due to permission error
          if (command.includes('find "/app"') && command.includes('-exec rm -rf')) {
            return {
              success: false,
              stdout: '',
              stderr: 'Permission denied',
              exit_code: 1,
            };
          }
          return { success: true, stdout: '', stderr: '', exit_code: 0 };
        }),
      };

      const result = await copyFilesInContainer(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract/my-app',
        '/tmp/apps/test-app/app'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to clean app directory');
      expect(result.error).toContain('Permission denied');
    });

    it('should fail when copy command fails', async () => {
      const mockDevSupervisor = {
        exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
          // Cleanup succeeds
          if (command.includes('-exec rm -rf')) {
            return { success: true, stdout: '', stderr: '', exit_code: 0 };
          }
          // Copy fails
          if (command.includes('-exec cp -r')) {
            return {
              success: false,
              stdout: '',
              stderr: 'No space left on device',
              exit_code: 1,
            };
          }
          return { success: true, stdout: '', stderr: '', exit_code: 0 };
        }),
      };

      const result = await copyFilesInContainer(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract/my-app',
        '/tmp/apps/test-app/app'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to copy files');
      expect(result.error).toContain('No space left on device');
    });

    it('should preserve protected directories during cleanup', async () => {
      let cleanupCommand = '';
      const mockDevSupervisor = {
        exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
          if (command.includes('find "/app"') && command.includes('-exec rm -rf')) {
            cleanupCommand = command;
          }
          return { success: true, stdout: '', stderr: '', exit_code: 0 };
        }),
      };

      await copyFilesInContainer(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract/my-app',
        '/tmp/apps/test-app/app'
      );

      // Verify all protected directories are excluded from deletion
      expect(cleanupCommand).toContain('! -name ".git"');
      expect(cleanupCommand).toContain('! -name ".gitignore"');
      expect(cleanupCommand).toContain('! -name ".is_ready"');
      expect(cleanupCommand).toContain('! -name ".import-*"');
      expect(cleanupCommand).toContain('! -name "public"'); // public dir excluded from top-level deletion
    });

    it('should verify braces are essential for correct error propagation', async () => {
      // This test documents WHY braces are needed in the command:
      // Without braces: `A && B && C || true` - if A fails, || true masks it
      // With braces: `A && { B && C || true; }` - if A fails, failure propagates
      let cleanupCommand = '';
      const mockDevSupervisor = {
        exec: vi.fn().mockImplementation(async ({ command }: { command: string }) => {
          if (command.includes('find "/app"') && command.includes('-exec rm -rf')) {
            cleanupCommand = command;
          }
          return { success: true, stdout: '', stderr: '', exit_code: 0 };
        }),
      };

      await copyFilesInContainer(
        service,
        mockDevSupervisor,
        '/app/.import-123-extract/my-app',
        '/tmp/apps/test-app/app'
      );

      // Verify braces are present around the public cleanup portion
      // This ensures `|| true` only applies to public cleanup, not main cleanup
      expect(cleanupCommand).toContain('&& {'); // Opening brace after main cleanup
      expect(cleanupCommand).toMatch(/\|\|\s*true\s*;\s*\}/); // Closing brace with || true inside
    });
  });

  describe('project source detection', () => {
    let service: ProjectImportService;
    const testAppId = 'test-app-detect';
    const testJobId = 'test-job-detect';
    const testAppPath = `/tmp/apps/${testAppId}/app`;

    beforeEach(() => {
      vi.clearAllMocks();

      const mockDevSupervisor = {
        exec: vi.fn().mockResolvedValue({ success: true, stdout: '', stderr: '', exit_code: 0 }),
        stopProcess: vi.fn(),
        restartProcess: vi.fn(),
        startProcess: vi.fn(),
      };

      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor as any);
      vi.mocked(AppRepository).mockImplementation(() => ({
        findById: vi.fn().mockReturnValue({
          id: testAppId,
          path: testAppPath,
          status: 'created',
        }),
        updateStatus: vi.fn(),
      }) as any);
      vi.mocked(ImportJobRepository).mockImplementation(() => ({
        update: vi.fn(),
        updateStatus: vi.fn(),
        markCompleted: vi.fn(),
        markFailed: vi.fn(),
      }) as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(zipSecurityService.validate).mockResolvedValue({
        valid: true,
        errors: [],
        stats: { fileCount: 1, totalSize: 100, compressionRatio: 1 },
      });
      vi.mocked(codeSyncFileCleanupService.deleteCleanablePatterns).mockResolvedValue({ success: true });
      vi.mocked(codeSyncFileCleanupService.createWarnings).mockReturnValue([]);
      vi.mocked(appRestartService.stopDevServer).mockResolvedValue({ success: true });
      vi.mocked(appRestartService.runInstall).mockResolvedValue({ success: true });
      vi.mocked(appRestartService.runBuild).mockResolvedValue({ success: true });
      vi.mocked(appRestartService.createPaasConfig).mockResolvedValue();
      vi.mocked(appRestartService.restartDevServer).mockResolvedValue({ success: true });
      vi.mocked(fs.cp).mockResolvedValue(undefined);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      service = new ProjectImportService();
      vi.spyOn(service as any, 'extractZipInContainer').mockResolvedValue({ success: true });
      vi.spyOn(service as any, 'validateProjectInContainer').mockResolvedValue({
        valid: true,
        packageManager: 'npm',
        hasBuildScript: false,
        hasDevScript: false,
        projectRoot: '/app/.import-extract',
      });
      vi.spyOn(service as any, 'copyFilesInContainer').mockResolvedValue({ success: true });
      vi.spyOn(service as any, 'gitCommit').mockResolvedValue({ success: true });
      vi.spyOn(service as any, 'cleanupContainerFiles').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'cleanupZipFile').mockResolvedValue(undefined);
    });

    it('calls detectAndLogInBackground after copy during zip import', async () => {
      await (service as any).processImport(testJobId, {
        appId: testAppId,
        appName: 'test',
        sourceType: 'zip',
        zipPath: '/tmp/test.zip',
      });

      expect(projectSourceDetectionService.detectAndLogInBackground).toHaveBeenCalledWith({
        appId: testAppId,
        appPath: testAppPath,
        jobId: testJobId,
        trigger: 'zip_import',
      });
    });
  });

  describe('Metrics Logging', () => {
    it('should use -1 sentinel for missing metric values via bytesToMB', async () => {
      // Import the actual bytesToMB function to test its behavior
      const { bytesToMB } = await import('../../utils/container-metrics.js');

      // Test bytesToMB sentinel behavior
      expect(bytesToMB(undefined)).toBe(-1);
      expect(bytesToMB(null)).toBe(-1);
      expect(bytesToMB(0)).toBe(0); // 0 bytes is valid, not missing
      expect(bytesToMB(104857600)).toBe(100); // 100MB
    });

    it('should calculate bytesToMB with correct precision', async () => {
      const { bytesToMB } = await import('../../utils/container-metrics.js');

      // Test precision (2 decimal places)
      expect(bytesToMB(1048576)).toBe(1); // 1MB exactly
      expect(bytesToMB(1572864)).toBe(1.5); // 1.5MB
      expect(bytesToMB(1610612)).toBe(1.54); // ~1.536MB rounds to 1.54
    });
  });
});
