import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { AppRestartService, appRestartService } from '../AppRestartService.js';
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

  describe('runNpmInstall', () => {
    it('should successfully run npm install', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'added 100 packages',
        stderr: '',
      });

      const result = await service.runNpmInstall(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.output).toBe('added 100 packages');
      expect(result.exitCode).toBe(0);
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'npm install',
        timeout: 5 * 60 * 1000,
      });
    });

    it('should return error when dev supervisor is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await service.runNpmInstall(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dev supervisor not available');
    });

    it('should return error when npm install fails', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'npm ERR! code ERESOLVE',
      });

      const result = await service.runNpmInstall(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('npm ERR! code ERESOLVE');
      expect(result.exitCode).toBe(1);
    });

    it('should handle exceptions', async () => {
      mockTerminalTool.executeCommand.mockRejectedValue(new Error('Timeout'));

      const result = await service.runNpmInstall(testAppId, testAppPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');
    });
  });

  describe('runNpmBuild', () => {
    it('should successfully run npm build', async () => {
      mockTerminalTool.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'vite build completed',
        stderr: '',
      });

      const result = await service.runNpmBuild(testAppId, testAppPath);

      expect(result.success).toBe(true);
      expect(result.output).toBe('vite build completed');
      expect(mockTerminalTool.executeCommand).toHaveBeenCalledWith(testAppPath, {
        command: 'npm run build',
        timeout: 10 * 60 * 1000,
      });
    });

    it('should return error when dev supervisor is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await service.runNpmBuild(testAppId, testAppPath);

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

      const result = await service.runNpmBuild(testAppId, testAppPath);

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
      expect(writtenConfig.runtime.dev.command).toBe('npm start');
      expect(writtenConfig.runtime.build.command).toBe('npm run build');
      expect(writtenConfig.runtime.serve.command).toBe('npm start');
    });

    it('should use custom start command when provided', async () => {
      await service.createPaasConfig(testAppPath, undefined, 'node server.js');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.runtime.dev.command).toBe('node server.js');
      expect(writtenConfig.runtime.build.command).toBe('npm run build');
      expect(writtenConfig.runtime.serve.command).toBe('npm start');
    });
  });

  describe('restartDevServer', () => {
    it('should restart without command using graceful restart', async () => {
      mockDevSupervisor.restartProcess.mockResolvedValue(true);

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
      mockDevSupervisor.restartProcess.mockResolvedValue(false);

      const result = await service.restartDevServer(testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to restart dev server');
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
  });

  describe('singleton export', () => {
    it('should export a singleton instance', () => {
      expect(appRestartService).toBeInstanceOf(AppRestartService);
    });
  });
});
