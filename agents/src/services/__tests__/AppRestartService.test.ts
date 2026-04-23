import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  AppRestartService,
  appRestartService,
  detectPackageManager,
  getBuildCommand,
  getInstallCommand,
} from '../AppRestartService.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { TerminalTool } from '../../tools/terminal.js';
import * as fs from 'node:fs/promises';

// Mock dependencies
vi.mock('../../utils/dev-supervisor-client-factory.js');
vi.mock('../../tools/terminal.js');
vi.mock('node:fs/promises');
vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('AppRestartService', () => {
  let service: AppRestartService;
  let mockDevSupervisor: {
    stopProcess: Mock;
    restartProcess: Mock;
    startProcess: Mock;
    exec: Mock;
  };
  let mockTerminalTool: {
    executeCommand: Mock;
  };

  const testAppId = 'test-app-123';
  const testAppPath = '/tmp/apps/test-app-123/app';

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock DevSupervisor client
    mockDevSupervisor = {
      stopProcess: vi.fn(),
      restartProcess: vi.fn(),
      startProcess: vi.fn(),
      exec: vi.fn(),
    };

    // Create mock TerminalTool
    mockTerminalTool = {
      executeCommand: vi.fn(),
    };

    // Setup factory mock
    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor as any);

    // Setup TerminalTool mock
    vi.mocked(TerminalTool).mockImplementation(() => mockTerminalTool as any);

    // Setup fs mocks
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    service = new AppRestartService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('stopDevServer', () => {
    it('should successfully stop dev server', async () => {
      mockDevSupervisor.stopProcess.mockResolvedValue(true);

      const result = await service.stopDevServer(testAppId);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(DevSupervisorClientFactory.createForApp).toHaveBeenCalledWith(testAppId);
      expect(mockDevSupervisor.stopProcess).toHaveBeenCalled();
    });

    it('should return error when dev supervisor is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await service.stopDevServer(testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dev supervisor not available');
    });

    it('should return error when stop fails', async () => {
      mockDevSupervisor.stopProcess.mockResolvedValue(false);

      const result = await service.stopDevServer(testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to stop dev server');
    });

    it('should handle exceptions', async () => {
      mockDevSupervisor.stopProcess.mockRejectedValue(new Error('Connection refused'));

      const result = await service.stopDevServer(testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('runInstall', () => {
    it('should successfully run npm install with default package manager', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'added 100 packages',
        stderr: '',
      });

      const result = await service.runInstall(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.output).toBe('added 100 packages');
      expect(result.exitCode).toBe(0);
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'npm install --include=dev',
        timeout: 5 * 60 * 1000,
      });
    });

    it('should use pnpm install when packageManager is pnpm', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'added 100 packages',
        stderr: '',
      });

      const result = await service.runInstall(testAppId, testAppPath, 'pnpm');

      expect(result.success).toBe(true);
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'pnpm install',
        timeout: 5 * 60 * 1000,
      });
    });

    it('should use yarn install when packageManager is yarn', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'added 100 packages',
        stderr: '',
      });

      const result = await service.runInstall(testAppId, testAppPath, 'yarn');

      expect(result.success).toBe(true);
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'yarn install',
        timeout: 5 * 60 * 1000,
      });
    });

    it('should return error when dev supervisor is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await service.runInstall(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dev supervisor not available');
    });

    it('should return error when install fails', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'npm ERR! code ERESOLVE',
      });

      const result = await service.runInstall(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('npm ERR! code ERESOLVE');
      expect(result.exitCode).toBe(1);
    });

    it('should handle exceptions', async () => {
      mockTerminalTool.executeCommand.mockRejectedValue(new Error('Timeout'));

      const result = await service.runInstall(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');
    });
  });

  describe('runBuild', () => {
    it('should successfully run npm build with default package manager', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'vite build completed',
        stderr: '',
      });

      const result = await service.runBuild(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.output).toBe('vite build completed');
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'npm run build',
        timeout: 10 * 60 * 1000,
      });
    });

    it('should use pnpm run build when packageManager is pnpm', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'vite build completed',
        stderr: '',
      });

      const result = await service.runBuild(testAppId, testAppPath, 'pnpm');

      expect(result.success).toBe(true);
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'pnpm run build',
        timeout: 10 * 60 * 1000,
      });
    });

    it('should use yarn run build when packageManager is yarn', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'vite build completed',
        stderr: '',
      });

      const result = await service.runBuild(testAppId, testAppPath, 'yarn');

      expect(result.success).toBe(true);
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'yarn run build',
        timeout: 10 * 60 * 1000,
      });
    });

    it('should return error when dev supervisor is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await service.runBuild(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dev supervisor not available');
    });

    it('should return error when build fails', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Build failed',
      });

      const result = await service.runBuild(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Build failed');
    });
  });

  describe('createPaasConfig', () => {
    it('should create config file with correct structure', async () => {
      await service.createPaasConfig(testAppPath);

      expect(fs.mkdir).toHaveBeenCalledWith(`${testAppPath}/.airo`, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${testAppPath}/.airo/config.json`,
        expect.stringContaining('"runtime"'),
        'utf-8'
      );

      // Verify the JSON structure - always Node.js commands
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.runtime.build.command).toBe('npm run build');
      expect(writtenConfig.runtime.serve.command).toBe('npm start');
      expect(writtenConfig.cleanAppDirBeforeExtract).toBeUndefined();
      expect(writtenConfig.productId).toBeUndefined();
    });

    it('should use custom start command when provided', async () => {
      await service.createPaasConfig(testAppPath, undefined, 'node server.js');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.runtime.build.command).toBe('npm run build');
      expect(writtenConfig.runtime.serve.command).toBe('node server.js');
      expect(writtenConfig.cleanAppDirBeforeExtract).toBeUndefined();
    });

    it('should include productId when provided', async () => {
      await service.createPaasConfig(testAppPath, undefined, undefined, 'paas-v1');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.productId).toBe('paas-v1');
      expect(writtenConfig.cleanAppDirBeforeExtract).toBeUndefined();
    });

    it('should enable cleanAppDirBeforeExtract for paas-nodejs-v1', async () => {
      await service.createPaasConfig(testAppPath, undefined, undefined, 'paas-nodejs-v1');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.cleanAppDirBeforeExtract).toBe(true);
    });

    it('should use custom dev command when provided', async () => {
      await service.createPaasConfig(testAppPath, undefined, 'npm start', undefined, 'npm run dev');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.runtime.dev.command).toBe('npm run dev');
      expect(writtenConfig.runtime.build.command).toBe('npm run build');
      expect(writtenConfig.runtime.serve.command).toBe('npm start');
    });

    it('should use pnpm build command when packageManager is pnpm', async () => {
      await service.createPaasConfig(testAppPath, undefined, 'pnpm start', undefined, 'pnpm run dev', 'pnpm');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.runtime.build.command).toBe('pnpm run build');
      expect(writtenConfig.runtime.serve.command).toBe('pnpm start');
      expect(writtenConfig.runtime.dev.command).toBe('pnpm run dev');
    });

    it('should use yarn build command when packageManager is yarn', async () => {
      await service.createPaasConfig(testAppPath, undefined, 'yarn start', undefined, 'yarn run dev', 'yarn');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.runtime.build.command).toBe('yarn run build');
      expect(writtenConfig.runtime.serve.command).toBe('yarn start');
      expect(writtenConfig.runtime.dev.command).toBe('yarn run dev');
    });
  });

  describe('restartDevServer', () => {
    it('should restart without command using graceful restart', async () => {
      mockDevSupervisor.restartProcess.mockResolvedValue({ success: true });

      const result = await service.restartDevServer(testAppId);

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.restartProcess).toHaveBeenCalledWith({ graceful: true });
    });

    it('should restart with custom command', async () => {
      mockDevSupervisor.stopProcess.mockResolvedValue(true);
      mockDevSupervisor.startProcess.mockResolvedValue({ state: 'running' });

      const customCommand = 'npm run dev';
      const result = await service.restartDevServer(testAppId, customCommand);

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.stopProcess).toHaveBeenCalled();
      expect(mockDevSupervisor.startProcess).toHaveBeenCalledWith({
        command: `sh -c "${customCommand}"`,
        working_dir: '/app',
      });
    });

    it('should return error for empty command', async () => {
      mockDevSupervisor.stopProcess.mockResolvedValue(true);

      const result = await service.restartDevServer(testAppId, '   ');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid command: empty after port substitution');
    });

    it('should return error when dev supervisor is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await service.restartDevServer(testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dev supervisor not available');
    });

    it('should return error when restart fails', async () => {
      mockDevSupervisor.restartProcess.mockResolvedValue({ success: false, error: 'HTTP 400: restart_failed: port 3000 still in use' });

      const result = await service.restartDevServer(testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 400: restart_failed: port 3000 still in use');
    });

    it('should return error when startProcess returns error state', async () => {
      mockDevSupervisor.stopProcess.mockResolvedValue(true);
      mockDevSupervisor.startProcess.mockResolvedValue({
        state: 'error',
        error: 'Process crashed',
      });

      const result = await service.restartDevServer(testAppId, 'npm run dev');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Process crashed');
    });

    it('should escape double quotes in command', async () => {
      mockDevSupervisor.stopProcess.mockResolvedValue(true);
      mockDevSupervisor.startProcess.mockResolvedValue({ state: 'running' });

      const commandWithQuotes = 'echo "hello"';
      await service.restartDevServer(testAppId, commandWithQuotes);

      expect(mockDevSupervisor.startProcess).toHaveBeenCalledWith({
        command: 'sh -c "echo \\"hello\\""',
        working_dir: '/app',
      });
    });
  });

  describe('performFullRestartCycle', () => {
    beforeEach(() => {
      // Setup default successful mocks for full cycle
      mockDevSupervisor.stopProcess.mockResolvedValue(true);
      mockDevSupervisor.startProcess.mockResolvedValue({ state: 'running' });
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'Success',
        stderr: '',
      });
      // Default to npm (no lock files found) for existing tests
      mockDevSupervisor.exec
        .mockResolvedValueOnce({ stdout: '' }) // pnpm check - not found
        .mockResolvedValueOnce({ stdout: '' }); // yarn check - not found
    });

    it('should complete full restart cycle successfully', async () => {
      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.phases.install).toBe(true);
      expect(result.phases.build).toBe(true);
      expect(result.phases.restart).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should skip install when skipInstall option is set', async () => {
      const result = await service.performFullRestartCycle(testAppId, testAppPath, {
        skipInstall: true,
      });

      expect(result.success).toBe(true);
      expect(result.phases.install).toBe(true);
      // Verify npm install was not called (only npm build should be called)
      const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
      const installCalls = terminalCalls.filter((call) => call[1].command === 'npm install');
      expect(installCalls.length).toBe(0);
    });

    it('should skip build when skipBuild option is set', async () => {
      const result = await service.performFullRestartCycle(testAppId, testAppPath, {
        skipBuild: true,
      });

      expect(result.success).toBe(true);
      expect(result.phases.build).toBe(true);
      // Verify npm build was not called
      const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
      const buildCalls = terminalCalls.filter((call) => call[1].command === 'npm run build');
      expect(buildCalls.length).toBe(0);
    });

    it('should use custom dev command when provided', async () => {
      const customCommand = 'node server.js';
      await service.performFullRestartCycle(testAppId, testAppPath, {
        devCommand: customCommand,
      });

      expect(mockDevSupervisor.startProcess).toHaveBeenCalledWith({
        command: `sh -c "${customCommand}"`,
        working_dir: '/app',
      });
    });

    it('should fail when npm install fails', async () => {
      mockTerminalTool.executeCommand.mockResolvedValueOnce({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'npm ERR! Installation failed',
      });

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.phases.install).toBe(false);
      expect(result.phases.build).toBe(false);
      expect(result.phases.restart).toBe(false);
      expect(result.error).toBe('npm ERR! Installation failed');
    });

    it('should continue when build fails (build is not critical)', async () => {
      // First call is install (success), second is build (fail)
      mockTerminalTool.executeCommand
        .mockResolvedValueOnce({
          success: true,
          exitCode: 0,
          stdout: 'Install success',
          stderr: '',
        })
        .mockResolvedValueOnce({
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Build failed',
        });

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.phases.install).toBe(true);
      expect(result.phases.build).toBe(true); // Still true - build failure is non-critical
      expect(result.phases.restart).toBe(true);
    });

    it('should fail when restart fails', async () => {
      mockDevSupervisor.startProcess.mockResolvedValue({
        state: 'error',
        error: 'Failed to start process',
      });

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.phases.install).toBe(true);
      expect(result.phases.build).toBe(true);
      expect(result.phases.restart).toBe(false);
      expect(result.error).toBe('Failed to start process');
    });

    it('should continue even when stop fails', async () => {
      mockDevSupervisor.stopProcess.mockResolvedValue(false);

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      // Should still succeed - stop failure is non-critical
      expect(result.success).toBe(true);
    });

    it('should handle unexpected exceptions', async () => {
      mockDevSupervisor.stopProcess.mockRejectedValue(new Error('Unexpected error'));

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected error');
    });

    describe('package manager detection', () => {
      beforeEach(() => {
        // Clear exec mock from parent beforeEach to allow test-specific setup
        mockDevSupervisor.exec.mockReset();
        // Reset default mocks for PM detection tests
        mockDevSupervisor.stopProcess.mockResolvedValue(true);
        mockDevSupervisor.startProcess.mockResolvedValue({ state: 'running' });
        mockTerminalTool.executeCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
        });
      });

      it('should detect pnpm and use pnpm commands', async () => {
        mockDevSupervisor.exec.mockResolvedValueOnce({ stdout: 'found' }); // pnpm check

        await service.performFullRestartCycle(testAppId, testAppPath);

        // Verify pnpm-lock.yaml was checked
        expect(mockDevSupervisor.exec).toHaveBeenCalledWith({
          command: 'test -f "/app/pnpm-lock.yaml" && echo "found"',
          timeout: 5,
        });

        // Verify pnpm install command was used
        const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
        expect(terminalCalls[0][1].command).toBe('pnpm install');

        // Verify pnpm build command was used
        expect(terminalCalls[1][1].command).toBe('pnpm run build');

        // Verify config was created with pnpm
        const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
        const writtenConfig = JSON.parse(writeCall[1] as string);
        expect(writtenConfig.runtime.build.command).toBe('pnpm run build');
      });

      it('should detect yarn and use yarn commands', async () => {
        mockDevSupervisor.exec
          .mockResolvedValueOnce({ stdout: '' }) // pnpm check - not found
          .mockResolvedValueOnce({ stdout: 'found' }); // yarn check

        await service.performFullRestartCycle(testAppId, testAppPath);

        // Verify yarn.lock was checked
        expect(mockDevSupervisor.exec).toHaveBeenCalledWith({
          command: 'test -f "/app/yarn.lock" && echo "found"',
          timeout: 5,
        });

        // Verify yarn install command was used
        const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
        expect(terminalCalls[0][1].command).toBe('yarn install');

        // Verify yarn build command was used
        expect(terminalCalls[1][1].command).toBe('yarn run build');

        // Verify config was created with yarn
        const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
        const writtenConfig = JSON.parse(writeCall[1] as string);
        expect(writtenConfig.runtime.build.command).toBe('yarn run build');
      });

      it('should default to npm when no lock file exists', async () => {
        mockDevSupervisor.exec
          .mockResolvedValueOnce({ stdout: '' }) // pnpm check - not found
          .mockResolvedValueOnce({ stdout: '' }); // yarn check - not found

        await service.performFullRestartCycle(testAppId, testAppPath);

        // Verify npm install command was used
        const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
        expect(terminalCalls[0][1].command).toBe('npm install --include=dev');

        // Verify npm build command was used
        expect(terminalCalls[1][1].command).toBe('npm run build');

        // Verify config was created with npm
        const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
        const writtenConfig = JSON.parse(writeCall[1] as string);
        expect(writtenConfig.runtime.build.command).toBe('npm run build');
      });

      it('should fall back to npm when devSupervisor is null', async () => {
        vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

        const result = await service.performFullRestartCycle(testAppId, testAppPath);

        // Should fail because devSupervisor is needed for other operations
        expect(result.success).toBe(false);
      });

      it('should fall back to npm when exec throws during PM detection', async () => {
        mockDevSupervisor.exec.mockRejectedValue(new Error('Container unreachable'));

        await service.performFullRestartCycle(testAppId, testAppPath);

        // Verify npm commands were used as fallback
        const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
        expect(terminalCalls[0][1].command).toBe('npm install --include=dev');
        expect(terminalCalls[1][1].command).toBe('npm run build');
      });

      it('should use custom install command over detected PM', async () => {
        mockDevSupervisor.exec.mockResolvedValueOnce({ stdout: 'found' }); // pnpm detected

        await service.performFullRestartCycle(testAppId, testAppPath, {
          commands: { install: 'custom-install-command' },
        });

        // Verify custom install command was used instead of pnpm install
        const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
        expect(terminalCalls[0][1].command).toBe('custom-install-command');
      });

      it('should use custom build command over detected PM', async () => {
        mockDevSupervisor.exec.mockResolvedValueOnce({ stdout: 'found' }); // pnpm detected

        await service.performFullRestartCycle(testAppId, testAppPath, {
          commands: { build: 'custom-build-command' },
        });

        // Verify custom build command was used instead of pnpm build
        const terminalCalls = mockTerminalTool.executeCommand.mock.calls;
        expect(terminalCalls[1][1].command).toBe('custom-build-command');
      });
    });
  });

  describe('singleton export', () => {
    it('should export a singleton instance', () => {
      expect(appRestartService).toBeInstanceOf(AppRestartService);
    });
  });

  describe('metrics collection', () => {
    beforeEach(() => {
      mockDevSupervisor.stopProcess.mockResolvedValue(true);
      mockDevSupervisor.startProcess.mockResolvedValue({ state: 'running' });
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'Success',
        stderr: '',
      });
      // Use command-based mocking for robustness (not dependent on call order)
      mockDevSupervisor.exec.mockImplementation(({ command }: { command: string }) => {
        if (command.includes('pnpm-lock.yaml')) {
          return Promise.resolve({ stdout: '' }); // pnpm not found
        }
        if (command.includes('yarn.lock')) {
          return Promise.resolve({ stdout: '' }); // yarn not found
        }
        if (command.includes('du -sb')) {
          return Promise.resolve({ stdout: '104857600' }); // 100MB
        }
        return Promise.resolve({ stdout: '' });
      });
    });

    it('should collect timing metrics for install, build, and start phases', async () => {
      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(result.metrics!.installDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics!.buildDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics!.startDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should collect app directory size metric', async () => {
      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.metrics!.appDirSizeBytes).toBe(104857600); // 100MB
    });

    it('should handle du command failure gracefully', async () => {
      mockDevSupervisor.exec.mockReset().mockImplementation(({ command }: { command: string }) => {
        if (command.includes('du -sb')) {
          return Promise.reject(new Error('du command failed'));
        }
        return Promise.resolve({ stdout: '' });
      });

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.metrics!.appDirSizeBytes).toBeUndefined();
    });

    it('should handle invalid du output gracefully', async () => {
      mockDevSupervisor.exec.mockReset().mockImplementation(({ command }: { command: string }) => {
        if (command.includes('du -sb')) {
          return Promise.resolve({ stdout: 'not-a-number' });
        }
        return Promise.resolve({ stdout: '' });
      });

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.metrics!.appDirSizeBytes).toBeUndefined();
    });

    it('should have undefined install metrics when install is skipped', async () => {
      const result = await service.performFullRestartCycle(testAppId, testAppPath, {
        skipInstall: true,
      });

      expect(result.success).toBe(true);
      expect(result.metrics!.installDurationMs).toBeUndefined();
      expect(result.metrics!.buildDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should have undefined build metrics when build is skipped', async () => {
      const result = await service.performFullRestartCycle(testAppId, testAppPath, {
        skipBuild: true,
      });

      expect(result.success).toBe(true);
      expect(result.metrics!.installDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics!.buildDurationMs).toBeUndefined();
    });

    it('should still collect partial metrics when install fails', async () => {
      mockTerminalTool.executeCommand.mockResolvedValueOnce({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'npm ERR!',
      });

      const result = await service.performFullRestartCycle(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.metrics!.installDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics!.buildDurationMs).toBeUndefined();
      expect(result.metrics!.startDurationMs).toBeUndefined();
    });
  });
});

describe('Package Manager Utilities', () => {
  describe('getInstallCommand', () => {
    it('should return npm install --include=dev for npm', function npmDefault() {
      expect(getInstallCommand('npm')).toBe('npm install --include=dev');
    });

    it('should return pnpm install for pnpm', function pnpmDefault() {
      expect(getInstallCommand('pnpm')).toBe('pnpm install');
    });

    it('should return yarn install for yarn', function yarnDefault() {
      expect(getInstallCommand('yarn')).toBe('yarn install');
    });

    it('should default to npm', function defaultNpm() {
      expect(getInstallCommand()).toBe('npm install --include=dev');
    });

    it('should add --legacy-peer-deps for npm', function npmLegacy() {
      expect(getInstallCommand('npm', { legacyPeerDeps: true })).toBe('npm install --include=dev --legacy-peer-deps');
    });

    it('should add --no-strict-peer-dependencies for pnpm', function pnpmLegacy() {
      expect(getInstallCommand('pnpm', { legacyPeerDeps: true })).toBe('pnpm install --no-strict-peer-dependencies');
    });

    it('should not change yarn install with legacyPeerDeps', function yarnLegacy() {
      expect(getInstallCommand('yarn', { legacyPeerDeps: true })).toBe('yarn install');
    });
  });

  describe('getBuildCommand', () => {
    it('should return npm run build for npm (dev mode)', () => {
      expect(getBuildCommand('npm')).toBe('npm run build');
    });

    it('should return pnpm run build for pnpm (dev mode)', () => {
      expect(getBuildCommand('pnpm')).toBe('pnpm run build');
    });

    it('should return yarn run build for yarn (dev mode)', () => {
      expect(getBuildCommand('yarn')).toBe('yarn run build');
    });

    it('should prefix with NODE_ENV=production when production=true', () => {
      expect(getBuildCommand('npm', true)).toBe('NODE_ENV=production npm run build');
      expect(getBuildCommand('pnpm', true)).toBe('NODE_ENV=production pnpm run build');
      expect(getBuildCommand('yarn', true)).toBe('NODE_ENV=production yarn run build');
    });

    it('should default to npm', () => {
      expect(getBuildCommand()).toBe('npm run build');
    });
  });

  describe('detectPackageManager', () => {
    it('should detect pnpm when pnpm-lock.yaml exists', async () => {
      const mockDevSupervisor = {
        exec: vi.fn()
          .mockResolvedValueOnce({ stdout: 'found' }) // pnpm check
      };

      const result = await detectPackageManager(mockDevSupervisor);

      expect(result).toBe('pnpm');
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith({
        command: 'test -f "/app/pnpm-lock.yaml" && echo "found"',
        timeout: 5,
      });
    });

    it('should detect yarn when yarn.lock exists', async () => {
      const mockDevSupervisor = {
        exec: vi.fn()
          .mockResolvedValueOnce({ stdout: '' }) // pnpm check - not found
          .mockResolvedValueOnce({ stdout: 'found' }) // yarn check
      };

      const result = await detectPackageManager(mockDevSupervisor);

      expect(result).toBe('yarn');
    });

    it('should default to npm when no lock file exists', async () => {
      const mockDevSupervisor = {
        exec: vi.fn()
          .mockResolvedValueOnce({ stdout: '' }) // pnpm check - not found
          .mockResolvedValueOnce({ stdout: '' }) // yarn check - not found
      };

      const result = await detectPackageManager(mockDevSupervisor);

      expect(result).toBe('npm');
    });

    it('should fall back to npm when exec throws an error', async () => {
      const mockDevSupervisor = {
        exec: vi.fn().mockRejectedValue(new Error('Container unreachable'))
      };

      const result = await detectPackageManager(mockDevSupervisor);

      expect(result).toBe('npm');
    });

    it('should fall back to npm when exec throws during yarn check', async () => {
      const mockDevSupervisor = {
        exec: vi.fn()
          .mockResolvedValueOnce({ stdout: '' }) // pnpm check - not found
          .mockRejectedValueOnce(new Error('Timeout')) // yarn check throws
      };

      const result = await detectPackageManager(mockDevSupervisor);

      expect(result).toBe('npm');
    });

    it('should use custom projectRoot when provided', async () => {
      const mockDevSupervisor = {
        exec: vi.fn()
          .mockResolvedValueOnce({ stdout: 'found' }) // pnpm check with custom path
      };

      const result = await detectPackageManager(mockDevSupervisor, '/app/my-project');

      expect(result).toBe('pnpm');
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith({
        command: 'test -f "/app/my-project/pnpm-lock.yaml" && echo "found"',
        timeout: 5,
      });
    });
  });
});
