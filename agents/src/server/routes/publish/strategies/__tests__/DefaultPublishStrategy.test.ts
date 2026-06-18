import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultPublishStrategy } from '../DefaultPublishStrategy.js';
import { BuildError } from '../PaaSPublishStrategy.js';
import type { PublishContext } from '../PublishStrategy.js';
import type { PublishRequest, PublishResponse } from '../../../../../services/DevSupervisorClient.js';

describe('DefaultPublishStrategy', () => {
  let strategy: DefaultPublishStrategy;

  beforeEach(() => {
    strategy = new DefaultPublishStrategy();
  });

  describe('key property', () => {
    it('should have key "default"', () => {
      expect(strategy.key).toBe('default');
    });
  });

  describe('deploy', () => {
    it('should call publishSupervisor.publish and return its response', async () => {
      const mockPublishSupervisor = {
        publish: vi.fn(),
      };

      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const request: PublishRequest = {
        commitHash: 'abc1234567890',
        force: false,
        waitForHealthy: true,
        healthTimeoutSeconds: 120,
      };

      const expectedResponse: PublishResponse = {
        status: 'success',
        version: 'abc1234567890',
        healthStatus: 'healthy',
      };

      mockPublishSupervisor.publish.mockResolvedValue(expectedResponse);

      const result = await strategy.deploy(
        mockPublishSupervisor as any,
        request,
        mockLogger as any
      );

      expect(mockPublishSupervisor.publish).toHaveBeenCalledWith(request);
      expect(mockPublishSupervisor.publish).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('build (via prepareBuild)', () => {
    let mockTasks: { runCommandSync: ReturnType<typeof vi.fn> };
    let mockGitUtils: {
      getCurrentBranch: ReturnType<typeof vi.fn>;
      getCurrentCommit: ReturnType<typeof vi.fn>;
      getStatus: ReturnType<typeof vi.fn>;
      getCommitHistory: ReturnType<typeof vi.fn>;
      resolveCommitHash: ReturnType<typeof vi.fn>;
      getCommitDetails: ReturnType<typeof vi.fn>;
      createArchive: ReturnType<typeof vi.fn>;
    };
    let mockLogger: {
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
      debug: ReturnType<typeof vi.fn>;
    };
    let mockContext: PublishContext;

    beforeEach(() => {
      mockTasks = { runCommandSync: vi.fn() };
      mockGitUtils = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getCurrentCommit: vi.fn().mockResolvedValue('abc1234567890'),
        getStatus: vi.fn().mockResolvedValue({ branch: 'main', isClean: true }),
        getCommitHistory: vi.fn().mockResolvedValue([{ hash: 'abc1234567890' }]),
        resolveCommitHash: vi.fn().mockResolvedValue('abc1234567890'),
        getCommitDetails: vi.fn().mockResolvedValue({ hash: 'abc1234567890', branch: 'main' }),
        createArchive: vi.fn().mockResolvedValue('/dist/abc1234567890.tar.gz'),
      };
      mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      mockContext = {
        appId: 'test-app',
        appPath: '/tmp/test-app',
        targetDir: '/dist',
        tasks: mockTasks as any,
        gitUtils: mockGitUtils as any,
        logger: mockLogger as any,
      };
    });

    it('should succeed when build exits with code 0', async () => {
      mockTasks.runCommandSync.mockResolvedValue({
        exitCode: 0,
        stdout: 'Build complete',
        stderr: '',
        timedOut: false,
        taskId: 'mock',
        executionTimeMs: 5000,
      });

      const result = await strategy.prepareBuild(mockContext);

      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(expect.objectContaining({
        command: 'NODE_ENV=production npm run build',
        workingDir: '/app',
        timeoutSeconds: 300,
      }));
      expect(mockGitUtils.createArchive).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        { timeout: 120_000 }
      );
      expect(result.commitHash).toBe('abc1234567890');
    });

    it('should throw BuildError when build exits with non-zero code', async () => {
      mockTasks.runCommandSync.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Cannot find module',
        timedOut: false,
        taskId: 'mock',
        executionTimeMs: 2000,
      });

      await expect(strategy.prepareBuild(mockContext)).rejects.toThrow(BuildError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'route.publish.default.build.failed',
        expect.objectContaining({ exitCode: 1, stderr: 'Error: Cannot find module' })
      );
    });

    it('should include stderr in BuildError details', async () => {
      mockTasks.runCommandSync.mockResolvedValue({
        exitCode: 2,
        stdout: 'partial output',
        stderr: 'FATAL: out of memory',
        timedOut: false,
        taskId: 'mock',
        executionTimeMs: 1000,
      });

      const error = await strategy.prepareBuild(mockContext).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).message).toBe('Build failed');
      expect((error as BuildError).details).toBe('FATAL: out of memory');
      expect((error as BuildError).exitCode).toBe(2);
    });

    it('runs runtime artifact hooks after a successful build and before archive creation', async () => {
      const order: string[] = [];
      const runtimeArtifactHook = vi.fn(async () => {
        order.push('hook');
      });
      mockTasks.runCommandSync.mockImplementation(async () => {
        order.push('build');
        return {
          exitCode: 0,
          stdout: 'Build complete',
          stderr: '',
          timedOut: false,
          taskId: 'mock',
          executionTimeMs: 5000,
        };
      });
      mockGitUtils.createArchive.mockImplementation(async () => {
        order.push('archive');
        return '/dist/abc1234567890.tar.gz';
      });

      await strategy.prepareBuild({
        ...mockContext,
        runtimeArtifactHooks: [runtimeArtifactHook],
      });

      expect(runtimeArtifactHook).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'test-app',
          appPath: '/tmp/test-app',
        }),
      );
      expect(order).toEqual(['build', 'hook', 'archive']);
    });

    it('does not run runtime artifact hooks when the build fails', async () => {
      const runtimeArtifactHook = vi.fn();
      mockTasks.runCommandSync.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Cannot find module',
        timedOut: false,
        taskId: 'mock',
        executionTimeMs: 2000,
      });

      await expect(
        strategy.prepareBuild({
          ...mockContext,
          runtimeArtifactHooks: [runtimeArtifactHook],
        }),
      ).rejects.toThrow(BuildError);

      expect(runtimeArtifactHook).not.toHaveBeenCalled();
      expect(mockGitUtils.createArchive).not.toHaveBeenCalled();
    });

    it('wraps runtime artifact hook failures and prevents archive creation', async () => {
      const runtimeArtifactHook = vi.fn().mockRejectedValue(new Error('manifest write failed'));
      mockTasks.runCommandSync.mockResolvedValue({
        exitCode: 0,
        stdout: 'Build complete',
        stderr: '',
        timedOut: false,
        taskId: 'mock',
        executionTimeMs: 5000,
      });

      const error = await strategy.prepareBuild({
        ...mockContext,
        runtimeArtifactHooks: [runtimeArtifactHook],
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).message).toBe('Publish runtime manifest generation failed');
      expect((error as BuildError).details).toBe('manifest write failed');
      expect(mockGitUtils.createArchive).not.toHaveBeenCalled();
    });

    it('preserves structured runtime artifact hook diagnostics in the BuildError details and logs', async () => {
      const cause = Object.assign(new Error('workspace write rejected'), {
        code: 'workspace_write_failed',
        statusCode: 503,
      });
      const hookError = Object.assign(new Error('manifest write failed'), {
        code: 'dev_supervisor_error',
        statusCode: 502,
        cause,
      });
      const runtimeArtifactHook = vi.fn().mockRejectedValue(hookError);
      mockTasks.runCommandSync.mockResolvedValue({
        exitCode: 0,
        stdout: 'Build complete',
        stderr: '',
        timedOut: false,
        taskId: 'mock',
        executionTimeMs: 5000,
      });

      const error = await strategy.prepareBuild({
        ...mockContext,
        runtimeArtifactHooks: [runtimeArtifactHook],
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).message).toBe('Publish runtime manifest generation failed');
      expect((error as BuildError).details).toContain('manifest write failed');
      expect((error as BuildError).details).toContain('dev_supervisor_error');
      expect((error as BuildError).details).toContain('502');
      expect((error as BuildError).details).toContain('workspace write rejected');
      expect((error as BuildError).details).toContain('workspace_write_failed');
      expect((error as BuildError).details).toContain('503');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'route.publish.default.runtime-artifacts.failed',
        expect.objectContaining({
          error: 'manifest write failed',
          code: 'dev_supervisor_error',
          statusCode: 502,
          cause: expect.objectContaining({
            error: 'workspace write rejected',
            code: 'workspace_write_failed',
            statusCode: 503,
          }),
        }),
      );
      expect(mockGitUtils.createArchive).not.toHaveBeenCalled();
    });
  });
});
