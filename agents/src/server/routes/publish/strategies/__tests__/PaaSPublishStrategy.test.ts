import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaaSPublishStrategy, BuildError } from '../PaaSPublishStrategy.js';
import type { PublishContext } from '../PublishStrategy.js';

describe('PaaSPublishStrategy', () => {
  let strategy: PaaSPublishStrategy;
  let mockContext: PublishContext;
  let mockDevSupervisor: {
    exec: ReturnType<typeof vi.fn>;
  };
  let mockGitUtils: {
    createArchive: ReturnType<typeof vi.fn>;
  };
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    strategy = new PaaSPublishStrategy();

    mockDevSupervisor = {
      exec: vi.fn(),
    };

    mockGitUtils = {
      createArchive: vi.fn().mockResolvedValue({
        path: '/dist/test-archive.tar.gz',
        commitHash: 'abc123',
      }),
    };

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    mockContext = {
      appId: 'test-app-id',
      appPath: '/tmp/test-app',
      targetDir: '/dist',
      devSupervisor: mockDevSupervisor as any,
      gitUtils: mockGitUtils as any,
      logger: mockLogger as any,
    };
  });

  describe('package manager detection', () => {
    it('should detect pnpm when pnpm-lock.yaml exists', async () => {
      // First call: pnpm-lock.yaml check - found
      // Second call: build command
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: 'found', success: true })
        .mockResolvedValueOnce({ success: true, exit_code: 0, execution_time: 100 });

      await strategy.publish(mockContext);

      // Verify pnpm-lock.yaml was checked
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'test -f "/app/pnpm-lock.yaml" && echo "found"',
        })
      );

      // Verify pnpm build command was used
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'NODE_ENV=production pnpm run build',
          working_dir: '/app',
        })
      );

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.package-manager.detected',
        { packageManager: 'pnpm' }
      );
    });

    it('should detect yarn when yarn.lock exists', async () => {
      // First call: pnpm-lock.yaml check - not found
      // Second call: yarn.lock check - found
      // Third call: build command
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: '', success: true }) // pnpm check
        .mockResolvedValueOnce({ stdout: 'found', success: true }) // yarn check
        .mockResolvedValueOnce({ success: true, exit_code: 0, execution_time: 100 }); // build

      await strategy.publish(mockContext);

      // Verify yarn.lock was checked
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'test -f "/app/yarn.lock" && echo "found"',
        })
      );

      // Verify yarn build command was used
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'NODE_ENV=production yarn run build',
          working_dir: '/app',
        })
      );

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.package-manager.detected',
        { packageManager: 'yarn' }
      );
    });

    it('should default to npm when no lock file exists', async () => {
      // First call: pnpm-lock.yaml check - not found
      // Second call: yarn.lock check - not found
      // Third call: build command
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: '', success: true }) // pnpm check
        .mockResolvedValueOnce({ stdout: '', success: true }) // yarn check
        .mockResolvedValueOnce({ success: true, exit_code: 0, execution_time: 100 }); // build

      await strategy.publish(mockContext);

      // Verify npm build command was used
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'NODE_ENV=production npm run build',
          working_dir: '/app',
        })
      );

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.package-manager.detected',
        { packageManager: 'npm' }
      );
    });

    it('should fall back to npm when exec throws during detection', async () => {
      // First call: pnpm-lock.yaml check - throws error
      // Second call: build command (npm fallback)
      mockDevSupervisor.exec
        .mockRejectedValueOnce(new Error('Container unreachable'))
        .mockResolvedValueOnce({ success: true, exit_code: 0, execution_time: 100 }); // build

      await strategy.publish(mockContext);

      // Verify npm build command was used as fallback
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'NODE_ENV=production npm run build',
          working_dir: '/app',
        })
      );

      // Verify logging shows npm
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.package-manager.detected',
        { packageManager: 'npm' }
      );
    });

    it('should fall back to npm when exec throws during yarn check', async () => {
      // First call: pnpm-lock.yaml check - not found
      // Second call: yarn.lock check - throws error
      // Third call: build command (npm fallback)
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: '', success: true }) // pnpm check
        .mockRejectedValueOnce(new Error('Timeout')) // yarn check throws
        .mockResolvedValueOnce({ success: true, exit_code: 0, execution_time: 100 }); // build

      await strategy.publish(mockContext);

      // Verify npm build command was used as fallback
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'NODE_ENV=production npm run build',
          working_dir: '/app',
        })
      );
    });
  });

  describe('publish flow', () => {
    beforeEach(() => {
      // Default: no lock files, npm
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: '', success: true }) // pnpm check
        .mockResolvedValueOnce({ stdout: '', success: true }) // yarn check
        .mockResolvedValueOnce({ success: true, exit_code: 0, execution_time: 100 }); // build
    });

    it('should generate hex timestamp identifier', async () => {
      const result = await strategy.publish(mockContext);

      // Verify commitHash is a hex string (12 chars)
      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should create archive with includeSource: true', async () => {
      await strategy.publish(mockContext);

      expect(mockGitUtils.createArchive).toHaveBeenCalledWith(
        '/tmp/test-app',
        expect.any(String),
        '/dist',
        { includeSource: true, excludeUntracked: true }
      );
    });

    it('should return archive path', async () => {
      const result = await strategy.publish(mockContext);

      expect(result.archivePath).toBe('/dist/test-archive.tar.gz');
    });

    it('should log build begin with package manager info', async () => {
      await strategy.publish(mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.build.begin',
        expect.objectContaining({
          packageManager: 'npm',
          command: 'NODE_ENV=production npm run build',
        })
      );
    });

    it('should log build success with package manager info', async () => {
      await strategy.publish(mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.build.success',
        expect.objectContaining({
          packageManager: 'npm',
          executionTime: 100,
        })
      );
    });
  });

  describe('build failure', () => {
    it('should throw BuildError when build fails', async () => {
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: '', success: true }) // pnpm check
        .mockResolvedValueOnce({ stdout: '', success: true }) // yarn check
        .mockResolvedValueOnce({
          success: false,
          exit_code: 127,
          stderr: 'sh: vite: not found',
        }); // build fails

      try {
        await strategy.publish(mockContext);
        expect.fail('Expected BuildError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BuildError);
        expect((error as BuildError).name).toBe('BuildError');
        expect((error as BuildError).details).toBe('sh: vite: not found');
        expect((error as BuildError).exitCode).toBe(127);
      }
    });

    it('should log build failure with package manager info', async () => {
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: '', success: true })
        .mockResolvedValueOnce({ stdout: '', success: true })
        .mockResolvedValueOnce({
          success: false,
          exit_code: 1,
          stderr: 'Build error',
        });

      try {
        await strategy.publish(mockContext);
      } catch {
        // Expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'route.publish.paas.build.failed',
        expect.objectContaining({
          packageManager: 'npm',
          exitCode: 1,
          stderr: 'Build error',
        })
      );
    });
  });

  describe('key property', () => {
    it('should have key "paas"', () => {
      expect(strategy.key).toBe('paas');
    });
  });
});
