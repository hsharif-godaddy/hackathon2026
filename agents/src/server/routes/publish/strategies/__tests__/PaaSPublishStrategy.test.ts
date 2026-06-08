import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PaaSPublishStrategy,
  BuildError,
  PreviewNotRunningError,
  MissingStartCommandError,
} from '../PaaSPublishStrategy.js';
import type { PublishContext } from '../PublishStrategy.js';

/**
 * Build a preflight-call stdout blob matching the shape PaaSPublishStrategy
 * expects: `<airo-config-body> ---airo-preflight-sep--- <package-json-body>`.
 * Any arg can be `null` to simulate that file being absent (empty section).
 */
function buildPreflightStdout(
  airoConfig: object | null,
  packageJson: object | null
): string {
  const airo = airoConfig === null ? '' : JSON.stringify(airoConfig);
  const pkg = packageJson === null ? '' : JSON.stringify(packageJson);
  return `${airo}\n---airo-preflight-sep---\n${pkg}`;
}

/** Default mock runtime status: process running and healthy */
function mockRuntimeRunning() {
  return {
    state: 'running' as const,
    pid: 1234,
    health: { status: 'healthy' as const, message: 'OK', consecutiveFailures: 0, consecutiveSuccesses: 1 },
    restarts: { total: 0, recent: 0, windowSeconds: 300, maxRestarts: 5 },
  };
}

/**
 * Route mocked runCommandSync calls to responses based on a command substring match.
 */
function installExecRouter(
  mockTasks: { runCommandSync: ReturnType<typeof vi.fn> },
  opts: {
    airoConfig?: object | null;
    packageJson?: object | null;
    preflightExitCode?: number;
  } = {}
): void {
  const {
    airoConfig = { runtime: { serve: { command: 'npm start' } } },
    packageJson = { scripts: { start: 'node server.js' } },
    preflightExitCode = 0,
  } = opts;

  mockTasks.runCommandSync.mockImplementation(async function (args: { command: string }) {
    if (args.command.includes('airo-preflight-sep')) {
      return {
        stdout: buildPreflightStdout(airoConfig, packageJson),
        exitCode: preflightExitCode,
        stderr: '',
        timedOut: false,
        taskId: 'mock',
        executionTimeMs: 0,
      };
    }
    throw new Error(`Unexpected command: ${args.command}`);
  });
}

describe('PaaSPublishStrategy', () => {
  let strategy: PaaSPublishStrategy;
  let mockContext: PublishContext;
  let mockTasks: {
    runCommandSync: ReturnType<typeof vi.fn>;
  };
  let mockGitUtils: {
    createArchive: ReturnType<typeof vi.fn>;
  };
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let mockRuntime: {
    status: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    strategy = new PaaSPublishStrategy();

    mockTasks = {
      runCommandSync: vi.fn(),
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

    mockRuntime = {
      status: vi.fn().mockResolvedValue(mockRuntimeRunning()),
    };

    mockContext = {
      appId: 'test-app-id',
      appPath: '/tmp/test-app',
      targetDir: '/dist',
      tasks: mockTasks as any,
      gitUtils: mockGitUtils as any,
      logger: mockLogger as any,
      runtime: mockRuntime as any,
    };
  });

  describe('prepareBuild', () => {
    beforeEach(() => {
      installExecRouter(mockTasks);
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
    it('should proceed when process is running', async () => {
      installExecRouter(mockTasks);

      const result = await strategy.prepareBuild(mockContext);

      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preview-check.begin',
        {}
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preview-check.result',
        { state: 'running', healthStatus: 'healthy' }
      );
    });

    it('should proceed when process is stopped (idle-stopped by start-on-request)', async () => {
      mockRuntime.status.mockResolvedValue({
        ...mockRuntimeRunning(),
        state: 'stopped',
      });
      installExecRouter(mockTasks);

      const result = await strategy.prepareBuild(mockContext);
      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should proceed when process is starting', async () => {
      mockRuntime.status.mockResolvedValue({
        ...mockRuntimeRunning(),
        state: 'starting',
      });
      installExecRouter(mockTasks);

      const result = await strategy.prepareBuild(mockContext);
      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should throw PreviewNotRunningError when process is in error state', async () => {
      mockRuntime.status.mockResolvedValue({
        ...mockRuntimeRunning(),
        state: 'error',
        lastError: 'segfault',
      });
      installExecRouter(mockTasks);

      const error = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(error).toBeInstanceOf(PreviewNotRunningError);
      expect((error as PreviewNotRunningError).details).toContain('error state');
    });

    it('should throw PreviewNotRunningError when process is running but health is unhealthy', async () => {
      mockRuntime.status.mockResolvedValue({
        ...mockRuntimeRunning(),
        state: 'running',
        health: { status: 'unhealthy', message: 'HTTP 503', consecutiveFailures: 3, consecutiveSuccesses: 0 },
      });
      installExecRouter(mockTasks);

      const error = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(error).toBeInstanceOf(PreviewNotRunningError);
      expect((error as PreviewNotRunningError).details).toContain('health check reports');
    });

    it('should proceed when process is running and health is disabled', async () => {
      mockRuntime.status.mockResolvedValue({
        ...mockRuntimeRunning(),
        state: 'running',
        health: { status: 'disabled', message: '', consecutiveFailures: 0, consecutiveSuccesses: 0 },
      });
      installExecRouter(mockTasks);

      const result = await strategy.prepareBuild(mockContext);
      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should throw PreviewNotRunningError with isSystemError when runtime.status() throws', async () => {
      mockRuntime.status.mockRejectedValue(new Error('Socket connection refused'));
      installExecRouter(mockTasks);

      const error = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(error).toBeInstanceOf(PreviewNotRunningError);
      expect((error as PreviewNotRunningError).isSystemError).toBe(true);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'route.publish.paas.preview-check.failed',
        expect.objectContaining({ error: 'Socket connection refused' })
      );
    });

    it('should throw PreviewNotRunningError when runtime is not available', async () => {
      installExecRouter(mockTasks);
      mockContext.runtime = undefined;

      const error = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(error).toBeInstanceOf(PreviewNotRunningError);
      expect((error as PreviewNotRunningError).isSystemError).toBe(true);
    });
  });

  describe('preflight start command', () => {
    it('passes when .airo/config.json has runtime.serve.command', async () => {
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { serve: { command: 'node dist/server.js' } } },
        packageJson: { scripts: {} }, // no start script — fine, airo config covers it
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preflight.config',
        expect.objectContaining({
          appId: 'test-app-id',
          hasAiroConfig: true,
          serveCommand: 'node dist/server.js',
          hasPackageJson: true,
          hasStartScript: false,
          startScript: null,
        })
      );
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'route.publish.paas.preflight.missing-start-command',
        expect.anything()
      );
    });

    it('passes when package.json has scripts.start and .airo/config.json is missing', async () => {
      installExecRouter(mockTasks, {
        airoConfig: null,
        packageJson: { scripts: { start: 'node server.js' } },
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preflight.config',
        expect.objectContaining({
          hasAiroConfig: false,
          serveCommand: null,
          hasPackageJson: true,
          hasStartScript: true,
          startScript: 'node server.js',
        })
      );
    });

    it('throws MissingStartCommandError and emits event when neither is set', async () => {
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { serve: { command: '' } } }, // empty ≡ missing
        packageJson: { scripts: { dev: 'vite' } },           // start absent
      });

      const err = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(err).toBeInstanceOf(MissingStartCommandError);
      expect((err as MissingStartCommandError).statusCode).toBe(412);
      expect((err as MissingStartCommandError).preflight).toEqual(
        expect.objectContaining({
          hasAiroConfig: true,
          serveCommand: null,
          hasPackageJson: true,
          hasStartScript: false,
        })
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'route.publish.paas.preflight.missing-start-command',
        expect.objectContaining({
          appId: 'test-app-id',
          hasAiroConfig: true,
          serveCommand: null,
          hasStartScript: false,
        })
      );

      // Archive should NOT have been created — we fail fast before the tar.
      expect(mockGitUtils.createArchive).not.toHaveBeenCalled();
    });

    it('treats malformed JSON the same as missing', async () => {
      mockTasks.runCommandSync.mockImplementation(async function (args: { command: string }) {
        if (args.command.includes('airo-preflight-sep')) {
          return { stdout: '{not json\n---airo-preflight-sep---\nalso not json', exitCode: 0, stderr: '', timedOut: false, taskId: 'mock', executionTimeMs: 0 };
        }
        throw new Error('unexpected');
      });

      const err = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(err).toBeInstanceOf(MissingStartCommandError);
      expect((err as MissingStartCommandError).preflight).toEqual(
        expect.objectContaining({
          hasAiroConfig: false,
          hasPackageJson: false,
          hasStartScript: false,
          serveCommand: null,
        })
      );
    });

    it('treats whitespace-only commands as missing', async () => {
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { serve: { command: '   ' } } },
        packageJson: { scripts: { start: '   ' } },
      });

      await expect(strategy.prepareBuild(mockContext)).rejects.toBeInstanceOf(
        MissingStartCommandError
      );
    });

    it('treats airoConfig with runtime but no serve.command as missing', async () => {
      // Optional-chaining case: runtime present, serve key absent.
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { build: { command: 'npm run build' } } } as any,
        packageJson: { scripts: { dev: 'vite' } },
      });

      await expect(strategy.prepareBuild(mockContext)).rejects.toBeInstanceOf(
        MissingStartCommandError
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preflight.config',
        expect.objectContaining({ hasAiroConfig: true, serveCommand: null }),
      );
    });

    it('passes when airoConfig is valid and package.json is absent entirely', async () => {
      // Edge case: tar ships .airo/config.json without a package.json
      // (unusual but technically valid — the serve command is self-sufficient).
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { serve: { command: 'node dist/server.js' } } },
        packageJson: null,
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preflight.config',
        expect.objectContaining({
          hasAiroConfig: true,
          serveCommand: 'node dist/server.js',
          hasPackageJson: false,
          hasStartScript: false,
        }),
      );
    });

    it('skips preflight and allows publish to continue when exec itself fails', async () => {
      mockTasks.runCommandSync.mockImplementation(async function (args: { command: string }) {
        if (args.command.includes('airo-preflight-sep')) {
          return { stdout: '', exitCode: 1, stderr: 'supervisor: dial tcp: connection refused', timedOut: false, taskId: 'mock', executionTimeMs: 0 };
        }
        throw new Error('unexpected');
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'route.publish.paas.preflight.exec-failed',
        expect.objectContaining({
          appId: 'test-app-id',
          stderr: expect.stringContaining('connection refused'),
        }),
      );
      expect(mockGitUtils.createArchive).toHaveBeenCalled();
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
