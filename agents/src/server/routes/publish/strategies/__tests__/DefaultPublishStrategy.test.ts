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
  });
});
