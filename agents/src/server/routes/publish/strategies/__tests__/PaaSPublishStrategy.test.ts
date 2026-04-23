import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaaSPublishStrategy, BuildError, PreviewNotRunningError } from '../PaaSPublishStrategy.js';
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
    warn: ReturnType<typeof vi.fn>;
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
      warn: vi.fn(),
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

  describe('prepareBuild', () => {
    beforeEach(() => {
      // Default: curl returns 200 (healthy preview)
      mockDevSupervisor.exec.mockResolvedValue({ stdout: '200', success: true });
    });

    it('should generate hex timestamp identifier', async () => {
      const result = await strategy.prepareBuild(mockContext);

      // Verify commitHash is a hex string (12 chars)
      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should create archive with includeSource, includeNodeModules, and extended timeout', async () => {
      await strategy.prepareBuild(mockContext);

      expect(mockGitUtils.createArchive).toHaveBeenCalledWith(
        '/tmp/test-app',
        expect.any(String),
        '/dist',
        { includeSource: true, excludeUntracked: true, includeNodeModules: true, timeout: 120000 }
      );
    });

    it('should return archive path', async () => {
      const result = await strategy.prepareBuild(mockContext);

      expect(result.archivePath).toBe('/dist/test-archive.tar.gz');
    });

    it('should log git-skipped message', async () => {
      await strategy.prepareBuild(mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.git-skipped',
        expect.objectContaining({
          message: 'PaaS strategy: skipping git operations',
        })
      );
    });

    it('should log archive begin with includeNodeModules', async () => {
      await strategy.prepareBuild(mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.archive.begin',
        expect.objectContaining({
          includeSource: true,
          includeNodeModules: true,
        })
      );
    });

    it('should log archive success', async () => {
      await strategy.prepareBuild(mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.archive.success',
        expect.objectContaining({
          archivePath: '/dist/test-archive.tar.gz',
        })
      );
    });
  });

  describe('key property', () => {
    it('should have key "paas"', () => {
      expect(strategy.key).toBe('paas');
    });
  });

  describe('preview health check', () => {
    it('should proceed when HTTP returns 200', async () => {
      mockDevSupervisor.exec.mockResolvedValue({ stdout: '200', success: true });

      const result = await strategy.prepareBuild(mockContext);

      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preview-check.begin',
        {}
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preview-check.result',
        { statusCode: 200, success: true }
      );
    });

    it('should proceed when HTTP returns 301 (3xx)', async () => {
      mockDevSupervisor.exec.mockResolvedValue({ stdout: '301', success: true });

      const result = await strategy.prepareBuild(mockContext);

      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should throw PreviewNotRunningError when HTTP returns 404', async () => {
      mockDevSupervisor.exec.mockResolvedValue({ stdout: '404', success: true });

      await expect(strategy.prepareBuild(mockContext)).rejects.toThrow(PreviewNotRunningError);
    });

    it('should throw PreviewNotRunningError when HTTP returns 500', async () => {
      mockDevSupervisor.exec.mockResolvedValue({ stdout: '500', success: true });

      await expect(strategy.prepareBuild(mockContext)).rejects.toThrow(PreviewNotRunningError);
    });

    it('should throw PreviewNotRunningError when curl fails (connection refused)', async () => {
      mockDevSupervisor.exec.mockResolvedValue({ stdout: '000', success: false });

      await expect(strategy.prepareBuild(mockContext)).rejects.toThrow(PreviewNotRunningError);
    });

    it('should throw PreviewNotRunningError with isSystemError when exec throws', async () => {
      mockDevSupervisor.exec.mockRejectedValue(new Error('Connection refused'));

      const error = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(error).toBeInstanceOf(PreviewNotRunningError);
      expect((error as PreviewNotRunningError).isSystemError).toBe(true);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'route.publish.paas.preview-check.failed',
        expect.objectContaining({ error: 'Connection refused' })
      );
    });
  });

  describe('deploy flow', () => {
    let mockPublishSupervisor: {
      publish: ReturnType<typeof vi.fn>;
      restartProcess: ReturnType<typeof vi.fn>;
      getPublishStatus: ReturnType<typeof vi.fn>;
    };

    const testCommitHash = 'abc1234567890';
    const baseRequest = {
      commitHash: testCommitHash,
      force: false,
      waitForHealthy: true,
      healthTimeoutSeconds: 120,
    };

    beforeEach(() => {
      mockPublishSupervisor = {
        publish: vi.fn(),
        restartProcess: vi.fn(),
        getPublishStatus: vi.fn(),
      };
    });

    describe('successful publish (no recovery)', () => {
      it('should return response from supervisor when publish succeeds', async () => {
        const expectedResponse = {
          status: 'success',
          version: testCommitHash,
          healthStatus: 'healthy',
        };
        mockPublishSupervisor.publish.mockResolvedValue(expectedResponse);

        const result = await strategy.deploy(
          mockPublishSupervisor as any,
          baseRequest,
          mockLogger as any
        );

        expect(result).toEqual(expectedResponse);
        expect(mockPublishSupervisor.restartProcess).not.toHaveBeenCalled();
        expect(mockPublishSupervisor.getPublishStatus).not.toHaveBeenCalled();
      });
    });

    describe('non-recoverable errors', () => {
      it('should propagate non-recoverable errors immediately', async () => {
        const error = new Error('Internal server error');
        mockPublishSupervisor.publish.mockRejectedValue(error);

        await expect(
          strategy.deploy(mockPublishSupervisor as any, baseRequest, mockLogger as any)
        ).rejects.toThrow('Internal server error');

        expect(mockPublishSupervisor.restartProcess).not.toHaveBeenCalled();
      });

      it('should not trigger recovery for validation errors', async () => {
        const error = new Error('Invalid commit hash format');
        mockPublishSupervisor.publish.mockRejectedValue(error);

        await expect(
          strategy.deploy(mockPublishSupervisor as any, baseRequest, mockLogger as any)
        ).rejects.toThrow('Invalid commit hash format');

        expect(mockPublishSupervisor.restartProcess).not.toHaveBeenCalled();
      });
    });

    describe('recovery flow', () => {
      const recoverableErrors = [
        'socket hang up',
        'ECONNRESET',
        'ETIMEDOUT',
        'request timeout',
      ];

      recoverableErrors.forEach((errorMessage) => {
        it(`should trigger recovery for "${errorMessage}" error`, async () => {
          mockPublishSupervisor.publish.mockRejectedValue(new Error(errorMessage));
          mockPublishSupervisor.restartProcess.mockResolvedValue({ success: true });
          mockPublishSupervisor.getPublishStatus.mockResolvedValue({
            version: testCommitHash,
            health: { status: 'healthy' },
            process: { state: 'running' },
          });

          const result = await strategy.deploy(
            mockPublishSupervisor as any,
            baseRequest,
            mockLogger as any
          );

          expect(result.status).toBe('success');
          expect(result.version).toBe(testCommitHash);
          expect(mockPublishSupervisor.restartProcess).toHaveBeenCalledWith({ graceful: true });
          expect(mockLogger.warn).toHaveBeenCalledWith(
            'route.publish.supervisor.timeout_restarting',
            expect.objectContaining({ error: errorMessage })
          );
        });
      });

      it('should fail if restart fails', async () => {
        mockPublishSupervisor.publish.mockRejectedValue(new Error('socket hang up'));
        mockPublishSupervisor.restartProcess.mockResolvedValue({
          success: false,
          error: 'Container not found',
        });

        await expect(
          strategy.deploy(mockPublishSupervisor as any, baseRequest, mockLogger as any)
        ).rejects.toThrow('Restart failed: Container not found');
      });
    });

    describe('health polling', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        mockPublishSupervisor.publish.mockRejectedValue(new Error('socket hang up'));
        mockPublishSupervisor.restartProcess.mockResolvedValue({ success: true });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should poll until healthy with correct version', async () => {
        // First poll: starting, second poll: healthy with correct version
        mockPublishSupervisor.getPublishStatus
          .mockResolvedValueOnce({
            version: null,
            health: { status: 'starting' },
            process: { state: 'running' },
          })
          .mockResolvedValueOnce({
            version: testCommitHash,
            health: { status: 'healthy' },
            process: { state: 'running' },
          });

        const deployPromise = strategy.deploy(
          mockPublishSupervisor as any,
          baseRequest,
          mockLogger as any
        );

        // Advance through first poll interval
        await vi.advanceTimersByTimeAsync(3000);
        // Advance through second poll interval
        await vi.advanceTimersByTimeAsync(3000);

        const result = await deployPromise;
        expect(result.status).toBe('success');
        expect(result.version).toBe(testCommitHash);
        expect(mockPublishSupervisor.getPublishStatus).toHaveBeenCalledWith({
          includeLogs: false,
          lines: 0,
        });
      });

      it('should keep polling when healthy but version does not match', async () => {
        const wrongVersion = 'wrongversion123';
        mockPublishSupervisor.getPublishStatus
          .mockResolvedValueOnce({
            version: wrongVersion, // Old version
            health: { status: 'healthy' },
            process: { state: 'running' },
          })
          .mockResolvedValueOnce({
            version: testCommitHash, // Correct version
            health: { status: 'healthy' },
            process: { state: 'running' },
          });

        const deployPromise = strategy.deploy(
          mockPublishSupervisor as any,
          baseRequest,
          mockLogger as any
        );

        // Advance through polls
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(3000);

        const result = await deployPromise;
        expect(result.status).toBe('success');
        expect(result.version).toBe(testCommitHash);
        expect(mockLogger.info).toHaveBeenCalledWith(
          'route.publish.supervisor.timeout_recovery_version_mismatch',
          expect.objectContaining({
            expectedVersion: testCommitHash.substring(0, 7),
            actualVersion: wrongVersion.substring(0, 7),
          })
        );
      });

      it('should fail when process enters error state', async () => {
        mockPublishSupervisor.getPublishStatus.mockResolvedValue({
          version: null,
          health: { status: 'unhealthy', message: 'App crashed' },
          process: { state: 'error' },
        });

        const deployPromise = strategy.deploy(
          mockPublishSupervisor as any,
          baseRequest,
          mockLogger as any
        );
        // Suppress unhandled rejection warning - promise will be caught by rejects.toThrow
        deployPromise.catch(() => {});

        await vi.advanceTimersByTimeAsync(3000);

        await expect(deployPromise).rejects.toThrow('Process in error state: App crashed');
        expect(mockLogger.error).toHaveBeenCalledWith(
          'route.publish.supervisor.timeout_recovery_failed',
          expect.objectContaining({
            processState: 'error',
            healthMessage: 'App crashed',
          })
        );
      });

      it('should timeout when app never becomes healthy with correct version', async () => {
        mockPublishSupervisor.getPublishStatus.mockResolvedValue({
          version: null,
          health: { status: 'starting' },
          process: { state: 'running' },
        });

        const deployPromise = strategy.deploy(
          mockPublishSupervisor as any,
          baseRequest,
          mockLogger as any
        );
        // Suppress unhandled rejection warning - promise will be caught by rejects.toThrow
        deployPromise.catch(() => {});

        // Advance past the timeout (120 seconds from request)
        await vi.advanceTimersByTimeAsync(120000 + 1000);

        await expect(deployPromise).rejects.toThrow(
          'Recovery timeout: app did not become healthy with expected version'
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          'route.publish.supervisor.timeout_recovery_failed',
          { reason: 'polling_timeout' }
        );
      });

      it('should use healthTimeoutSeconds from request', async () => {
        const shortTimeoutRequest = { ...baseRequest, healthTimeoutSeconds: 10 };
        mockPublishSupervisor.getPublishStatus.mockResolvedValue({
          version: null,
          health: { status: 'starting' },
          process: { state: 'running' },
        });

        const deployPromise = strategy.deploy(
          mockPublishSupervisor as any,
          shortTimeoutRequest,
          mockLogger as any
        );
        // Suppress unhandled rejection warning - promise will be caught by rejects.toThrow
        deployPromise.catch(() => {});

        // With 10s timeout and 3s poll interval, need to advance through multiple polls
        // until we exceed the deadline (poll at 0s, 3s, 6s, 9s, then at 12s deadline exceeded)
        await vi.advanceTimersByTimeAsync(15000);

        await expect(deployPromise).rejects.toThrow(
          'Recovery timeout: app did not become healthy with expected version'
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          'route.publish.supervisor.timeout_recovery_polling',
          expect.objectContaining({ timeoutMs: 10000 })
        );
      });

      it('should handle transient getPublishStatus errors', async () => {
        mockPublishSupervisor.getPublishStatus
          .mockRejectedValueOnce(new Error('Network error'))
          .mockRejectedValueOnce(new Error('Connection reset'))
          .mockResolvedValueOnce({
            version: testCommitHash,
            health: { status: 'healthy' },
            process: { state: 'running' },
          });

        const deployPromise = strategy.deploy(
          mockPublishSupervisor as any,
          baseRequest,
          mockLogger as any
        );

        // Advance through retries
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(3000);

        const result = await deployPromise;
        expect(result.status).toBe('success');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'route.publish.supervisor.timeout_recovery_poll_error',
          expect.objectContaining({ consecutiveErrors: 1 })
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'route.publish.supervisor.timeout_recovery_poll_error',
          expect.objectContaining({ consecutiveErrors: 2 })
        );
      });

      it('should fail after max consecutive getPublishStatus errors', async () => {
        mockPublishSupervisor.getPublishStatus.mockRejectedValue(
          new Error('Persistent network failure')
        );

        const deployPromise = strategy.deploy(
          mockPublishSupervisor as any,
          baseRequest,
          mockLogger as any
        );
        // Suppress unhandled rejection warning - promise will be caught by rejects.toThrow
        deployPromise.catch(() => {});

        // Advance through all retry attempts
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(3000);

        await expect(deployPromise).rejects.toThrow(
          'Failed to get status after 3 attempts: Persistent network failure'
        );
      });
    });
  });
});
