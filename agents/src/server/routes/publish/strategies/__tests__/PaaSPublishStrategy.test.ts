import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PaaSPublishStrategy,
  BuildError,
  PreviewNotRunningError,
  MissingStartCommandError,
} from '../PaaSPublishStrategy.js';
import type { PublishContext } from '../PublishStrategy.js';
import { appRestartService } from '../../../../../services/AppRestartService.js';

/** Realistic 40-char HEAD SHA returned by the mocked gitUtils.getCurrentCommit. */
const REAL_HEAD_SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

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
 * Mutable workspace state the exec router reads from. `createPaasConfig` (spied
 * in beforeEach) mutates `airoConfig` so a publish-time persist is reflected in
 * the subsequent preflight read, mirroring the real working-tree round-trip.
 */
interface ExecState {
  airoConfig: object | null;
  packageJson: object | null;
  preflightExitCode: number;
}

let execState: ExecState;

/**
 * Route mocked runCommandSync calls to responses based on a command substring
 * match. Handles the preflight/persist read (`airo-preflight-sep`), the
 * package-manager lock-file probes (`detectPackageManager`), and the scoped
 * package.json read (`readPackageJsonScripts`).
 */
function installExecRouter(
  mockTasks: { runCommandSync: ReturnType<typeof vi.fn> },
  opts: {
    airoConfig?: object | null;
    packageJson?: object | null;
    preflightExitCode?: number;
  } = {}
): void {
  execState = {
    airoConfig:
      opts.airoConfig === undefined
        ? { runtime: { serve: { command: 'npm start' } } }
        : opts.airoConfig,
    packageJson:
      opts.packageJson === undefined ? { scripts: { start: 'node server.js' } } : opts.packageJson,
    preflightExitCode: opts.preflightExitCode ?? 0,
  };

  mockTasks.runCommandSync.mockImplementation(async function (args: { command: string }) {
    const ok = (stdout: string, exitCode = 0) => ({
      stdout,
      exitCode,
      stderr: '',
      timedOut: false,
      taskId: 'mock',
      executionTimeMs: 0,
    });

    // Combined preflight/persist read (cat config + package.json with separator)
    if (args.command.includes('airo-preflight-sep')) {
      return ok(
        buildPreflightStdout(execState.airoConfig, execState.packageJson),
        execState.preflightExitCode
      );
    }
    // detectPackageManager lock-file probes: report "not found" → falls back to npm
    if (args.command.includes('pnpm-lock.yaml') || args.command.includes('yarn.lock')) {
      return ok('', 1);
    }
    // readPackageJsonScripts: scoped `cat "/app/package.json"`
    if (args.command.includes('package.json')) {
      return execState.packageJson === null
        ? ok('', 1)
        : ok(JSON.stringify(execState.packageJson));
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
    getCurrentCommit: ReturnType<typeof vi.fn>;
  };
  let createPaasConfigSpy: ReturnType<typeof vi.spyOn>;
  let patchPaasPackageManagerSpy: ReturnType<typeof vi.spyOn>;
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
      getCurrentCommit: vi.fn().mockResolvedValue(REAL_HEAD_SHA),
    };

    // Stub the real fs-writing config writer. Reflect the write back into the
    // exec router's mutable state so the subsequent preflight read sees it.
    createPaasConfigSpy = vi
      .spyOn(appRestartService, 'createPaasConfig')
      .mockImplementation(async (_appPath, _bt, startCommand, _pid, _dev, packageManager) => {
        execState.airoConfig = {
          runtime: {
            serve: { command: startCommand ?? 'npm start' },
            build: { command: 'npm run build' },
            dev: { command: startCommand ?? 'npm start' },
            packageManager: packageManager ?? 'npm',
          },
        };
      });

    patchPaasPackageManagerSpy = vi
      .spyOn(appRestartService, 'patchPaasPackageManager')
      .mockImplementation(async (_appPath, packageManager) => {
        if (execState.airoConfig?.runtime) {
          execState.airoConfig.runtime.packageManager = packageManager;
        }
        return true;
      });

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

  afterEach(() => {
    createPaasConfigSpy.mockRestore();
    patchPaasPackageManagerSpy.mockRestore();
  });

  describe('prepareBuild', () => {
    beforeEach(() => {
      installExecRouter(mockTasks);
    });

    it('should use the real HEAD commit SHA', async () => {
      const result = await strategy.prepareBuild(mockContext);

      expect(mockGitUtils.getCurrentCommit).toHaveBeenCalledWith('/tmp/test-app');
      expect(result.commitHash).toBe(REAL_HEAD_SHA);
    });

    it('should fall back to a synthetic hex identifier when HEAD cannot be resolved', async () => {
      mockGitUtils.getCurrentCommit.mockRejectedValue(new Error('fatal: needed a single revision'));

      const result = await strategy.prepareBuild(mockContext);

      expect(result.commitHash).toMatch(/^[a-f0-9]{12}$/);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'route.publish.paas.commit-fallback',
        expect.objectContaining({
          message: 'Could not resolve HEAD commit; using synthetic identifier',
        })
      );
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

    it('should log commit-resolved with the HEAD SHA', async () => {
      await strategy.prepareBuild(mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.commit-resolved',
        expect.objectContaining({
          commitHash: REAL_HEAD_SHA.substring(0, 7),
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

      expect(result.commitHash).toBe(REAL_HEAD_SHA);
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
      expect(result.commitHash).toBe(REAL_HEAD_SHA);
    });

    it('should proceed when process is starting', async () => {
      mockRuntime.status.mockResolvedValue({
        ...mockRuntimeRunning(),
        state: 'starting',
      });
      installExecRouter(mockTasks);

      const result = await strategy.prepareBuild(mockContext);
      expect(result.commitHash).toBe(REAL_HEAD_SHA);
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
      expect(result.commitHash).toBe(REAL_HEAD_SHA);
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

      expect(createPaasConfigSpy).toHaveBeenCalledWith(
        '/tmp/test-app',
        undefined,
        'NODE_ENV=production npm start',
        undefined,
        undefined,
        'npm',
        'scripts.start',
        'test-app-id'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.preflight.config',
        expect.objectContaining({
          hasAiroConfig: true,
          serveCommand: 'NODE_ENV=production npm start',
          hasPackageJson: true,
          hasStartScript: true,
          startScript: 'node server.js',
        })
      );
    });

    it('persists a synthesized command (does not throw) when neither serve nor start is set', async () => {
      // dev-only app: empty serve command + only a dev script. Previously a hard
      // 412; now the persist step resolves scripts.dev and the preflight passes.
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { serve: { command: '' } } }, // empty ≡ missing
        packageJson: { scripts: { dev: 'vite' } },           // start absent
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();

      expect(createPaasConfigSpy).toHaveBeenCalledWith(
        '/tmp/test-app',
        undefined,
        'NODE_ENV=production npm run dev',
        undefined,
        undefined,
        'npm',
        'scripts.dev',
        'test-app-id'
      );
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'route.publish.paas.preflight.missing-start-command',
        expect.anything()
      );
      expect(mockGitUtils.createArchive).toHaveBeenCalled();
    });

    it('safety net: still throws MissingStartCommandError if the persist write never surfaces a command', async () => {
      // Simulate a persist that does not make a serve command visible (e.g. the
      // write silently no-ops) AND no start script — the preflight must still 412.
      createPaasConfigSpy.mockResolvedValue(undefined); // does NOT mutate execState
      installExecRouter(mockTasks, {
        airoConfig: null,
        packageJson: { scripts: { dev: 'vite' } }, // no start
      });

      const err = await strategy.prepareBuild(mockContext).catch((e) => e);
      expect(err).toBeInstanceOf(MissingStartCommandError);
      expect((err as MissingStartCommandError).statusCode).toBe(412);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'route.publish.paas.preflight.missing-start-command',
        expect.objectContaining({ appId: 'test-app-id', serveCommand: null, hasStartScript: false })
      );
      // Failed fast before the tar.
      expect(mockGitUtils.createArchive).not.toHaveBeenCalled();
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

  describe('start command persistence', () => {
    it('preserves an existing serve command without re-resolving', async () => {
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { serve: { command: 'node dist/server.js' } } },
        packageJson: { scripts: {} },
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();

      expect(createPaasConfigSpy).not.toHaveBeenCalled();
      expect(patchPaasPackageManagerSpy).toHaveBeenCalledWith(
        '/tmp/test-app',
        'npm',
        'test-app-id'
      );
    });

    it('does not patch packageManager when config already has one', async () => {
      installExecRouter(mockTasks, {
        airoConfig: {
          runtime: {
            serve: { command: 'node dist/server.js' },
            packageManager: 'pnpm',
          },
        },
        packageJson: { scripts: {} },
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();

      expect(createPaasConfigSpy).not.toHaveBeenCalled();
      expect(patchPaasPackageManagerSpy).not.toHaveBeenCalled();
    });

    it('does not log package-manager.persisted when patch returns false', async () => {
      patchPaasPackageManagerSpy.mockResolvedValue(false);
      installExecRouter(mockTasks, {
        airoConfig: { runtime: { serve: { command: 'node dist/server.js' } } },
        packageJson: { scripts: {} },
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();

      expect(patchPaasPackageManagerSpy).toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'route.publish.paas.package-manager.persisted',
        expect.anything()
      );
    });

    it('writes config from scripts.start when no serve command is present', async () => {
      installExecRouter(mockTasks, {
        airoConfig: null,
        packageJson: { scripts: { start: 'node server.js' } },
      });

      await expect(strategy.prepareBuild(mockContext)).resolves.toBeDefined();

      expect(createPaasConfigSpy).toHaveBeenCalledWith(
        '/tmp/test-app',
        undefined,
        'NODE_ENV=production npm start',
        undefined,
        undefined,
        'npm',
        'scripts.start',
        'test-app-id'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'route.publish.paas.start-command.persisted',
        expect.objectContaining({ hadServeCommand: false })
      );
    });

    it('runs config write before the archive is built', async () => {
      installExecRouter(mockTasks, {
        airoConfig: null,
        packageJson: { scripts: { dev: 'vite' } },
      });

      const order: string[] = [];
      createPaasConfigSpy.mockImplementation(async () => {
        order.push('config');
        // Simulate the config becoming visible after write
        execState.airoConfig = { runtime: { serve: { command: 'NODE_ENV=development npm run dev' } } };
      });
      mockGitUtils.createArchive.mockImplementation(async () => {
        order.push('archive');
        return { path: '/dist/test-archive.tar.gz', commitHash: 'abc123' };
      });

      await strategy.prepareBuild(mockContext);

      expect(order).toEqual(['config', 'archive']);
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
