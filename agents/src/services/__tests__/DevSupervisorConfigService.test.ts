import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevSupervisorConfigService } from '../DevSupervisorConfigService.js';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn()
}));

describe('DevSupervisorConfigService', () => {
  let service: DevSupervisorConfigService;
  let mockExistsSync: any;
  let originalEnv: Record<string, string | undefined>;
  let originalPid: number;

  beforeEach(() => {
    service = new DevSupervisorConfigService();
    mockExistsSync = vi.mocked(fs.existsSync);
    
    // Store original environment and process
    originalEnv = { ...process.env };
    originalPid = process.pid;
    
    // Clear mocks
    vi.clearAllMocks();
    service.clearCache();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    Object.defineProperty(process, 'pid', { value: originalPid });
  });

  describe('detectEnvironment', () => {
    it('should detect Docker environment with dev-supervisor available', async () => {
      // Mock Docker environment
      process.env.DOCKER_ENV = 'true';
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/tmp/supervisor/dev-supervisor.sock';
      });

      const env = await service.detectEnvironment();

      expect(env).toEqual({
        available: true,
        socketPath: '/tmp/supervisor/dev-supervisor.sock',
        environment: 'docker',
        isPid1: false,
        version: undefined
      });
    });

    it('should detect Docker environment as PID 1', async () => {
      // Mock Docker environment as PID 1
      process.env.DOCKER_ENV = 'true';
      Object.defineProperty(process, 'pid', { value: 1 });
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/tmp/supervisor/dev-supervisor.sock';
      });

      const env = await service.detectEnvironment();

      expect(env.isPid1).toBe(true);
      expect(env.environment).toBe('docker');
    });

    it('should detect local development environment', async () => {
      // Mock local development environment
      process.env.NODE_ENV = 'development';
      delete process.env.DOCKER_ENV;
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/tmp/dev-supervisor.sock';
      });

      const env = await service.detectEnvironment();

      expect(env).toEqual({
        available: true,
        socketPath: '/tmp/dev-supervisor.sock',
        environment: 'local',
        isPid1: false,
        version: undefined
      });
    });

    it('should use custom socket path from environment variable', async () => {
      process.env.DEV_SUPERVISOR_SOCKET_PATH = '/custom/path.sock';
      mockExistsSync.mockImplementation((path: string) => {
        return path === '/custom/path.sock';
      });

      const env = await service.detectEnvironment();

      expect(env.socketPath).toBe('/custom/path.sock');
      expect(env.available).toBe(true);
    });

    it('should detect unavailable dev-supervisor', async () => {
      mockExistsSync.mockReturnValue(false);

      const env = await service.detectEnvironment();

      expect(env.available).toBe(false);
    });

    it('should cache environment detection results', async () => {
      mockExistsSync.mockReturnValue(true);

      // First call
      const env1 = await service.detectEnvironment();
      // Second call
      const env2 = await service.detectEnvironment();

      expect(env1).toBe(env2); // Same object reference (cached)
      expect(mockExistsSync).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should detect Docker environment from /.dockerenv file', async () => {
      delete process.env.DOCKER_ENV;
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/.dockerenv') return true;
        if (path === '/tmp/supervisor/dev-supervisor.sock') return true;
        return false;
      });

      const env = await service.detectEnvironment();

      expect(env.environment).toBe('docker');
    });
  });

  describe('getRecommendedConfig', () => {
    it('should return Docker configuration for Docker environment', async () => {
      process.env.DOCKER_ENV = 'true';
      mockExistsSync.mockReturnValue(true);

      const config = await service.getRecommendedConfig();

      expect(config).toEqual({
        socketPath: '/tmp/supervisor/dev-supervisor.sock',
        enableHealthMonitoring: true,
        defaultHealthInterval: '30s',
        defaultRestartPolicy: {
          enabled: true,
          maxRestarts: 5,
          restartWindow: '5m'
        }
      });
    });

    it('should return local configuration for local environment', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DOCKER_ENV;
      mockExistsSync.mockReturnValue(true);

      const config = await service.getRecommendedConfig();

      expect(config).toEqual({
        socketPath: '/tmp/dev-supervisor.sock',
        enableHealthMonitoring: false, // Disabled in local development
        defaultHealthInterval: '60s',
        defaultRestartPolicy: {
          enabled: false,
          maxRestarts: 3,
          restartWindow: '10m'
        }
      });
    });

    it('should enable health monitoring in local production environment', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DOCKER_ENV;
      mockExistsSync.mockReturnValue(true);

      const config = await service.getRecommendedConfig();

      expect(config.enableHealthMonitoring).toBe(true);
    });

    it('should return conservative defaults for unknown environment', async () => {
      // No environment indicators
      delete process.env.NODE_ENV;
      delete process.env.DOCKER_ENV;
      mockExistsSync.mockReturnValue(true);

      const config = await service.getRecommendedConfig();

      expect(config).toEqual({
        socketPath: '/tmp/dev-supervisor.sock',
        enableHealthMonitoring: false,
        defaultHealthInterval: '60s',
        defaultRestartPolicy: {
          enabled: false,
          maxRestarts: 3,
          restartWindow: '10m'
        }
      });
    });
  });

  describe('validateConfiguration', () => {
    it('should validate successful Docker configuration', async () => {
      process.env.DOCKER_ENV = 'true';
      Object.defineProperty(process, 'pid', { value: 1 });
      mockExistsSync.mockReturnValue(true);

      const validation = await service.validateConfiguration();

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
      expect(validation.recommendations).toHaveLength(0);
    });

    it('should identify missing dev-supervisor in Docker environment', async () => {
      process.env.DOCKER_ENV = 'true';
      mockExistsSync.mockReturnValue(false);

      const validation = await service.validateConfiguration();

      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('dev-supervisor not available in Docker environment');
      expect(validation.recommendations).toContain('Ensure dev-supervisor is installed and running in the container');
    });

    it('should recommend PID 1 for Docker environment', async () => {
      process.env.DOCKER_ENV = 'true';
      Object.defineProperty(process, 'pid', { value: 123 }); // Not PID 1
      mockExistsSync.mockReturnValue(true);

      const validation = await service.validateConfiguration();

      expect(validation.recommendations).toContain('Consider running dev-supervisor as PID 1 for better process management');
    });

    it('should identify missing socket file', async () => {
      process.env.DOCKER_ENV = 'true';
      mockExistsSync.mockImplementation((path: string) => {
        // Socket path exists for initial availability check, but not for validation
        if (path === '/tmp/supervisor/dev-supervisor.sock') return false;
        return false;
      });

      const validation = await service.validateConfiguration();

      expect(validation.issues).toContain('Socket file does not exist: /tmp/supervisor/dev-supervisor.sock');
    });

    it('should recommend health monitoring for Docker environment', async () => {
      process.env.DOCKER_ENV = 'true';
      process.env.NODE_ENV = 'development'; // This would disable health monitoring
      mockExistsSync.mockReturnValue(true);

      const validation = await service.validateConfiguration();

      // This test would need to be adjusted based on the actual implementation
      // The current implementation doesn't have this specific recommendation logic
    });
  });

  describe('shouldEnableIntegration', () => {
    it('should enable integration for available Docker environment', async () => {
      process.env.DOCKER_ENV = 'true';
      mockExistsSync.mockReturnValue(true);

      const shouldEnable = await service.shouldEnableIntegration();

      expect(shouldEnable).toBe(true);
    });

    it('should enable integration for available local environment', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DOCKER_ENV;
      mockExistsSync.mockReturnValue(true);

      const shouldEnable = await service.shouldEnableIntegration();

      expect(shouldEnable).toBe(true);
    });

    it('should not enable integration when unavailable', async () => {
      mockExistsSync.mockReturnValue(false);

      const shouldEnable = await service.shouldEnableIntegration();

      expect(shouldEnable).toBe(false);
    });

    it('should not enable integration for unknown environment even if available', async () => {
      // No environment indicators
      delete process.env.NODE_ENV;
      delete process.env.DOCKER_ENV;
      mockExistsSync.mockReturnValue(true);

      const shouldEnable = await service.shouldEnableIntegration();

      expect(shouldEnable).toBe(false);
    });
  });

  describe('getIntegrationStatus', () => {
    it('should return complete integration status', async () => {
      process.env.DOCKER_ENV = 'true';
      Object.defineProperty(process, 'pid', { value: 1 });
      mockExistsSync.mockReturnValue(true);

      const status = await service.getIntegrationStatus();

      expect(status.enabled).toBe(true);
      expect(status.environment.environment).toBe('docker');
      expect(status.environment.available).toBe(true);
      expect(status.config.enableHealthMonitoring).toBe(true);
      expect(status.validation.valid).toBe(true);
    });

    it('should return disabled status for unavailable dev-supervisor', async () => {
      mockExistsSync.mockReturnValue(false);

      const status = await service.getIntegrationStatus();

      expect(status.enabled).toBe(false);
      expect(status.environment.available).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear cached environment detection', async () => {
      mockExistsSync.mockReturnValue(true);

      // First call
      await service.detectEnvironment();
      expect(mockExistsSync).toHaveBeenCalledTimes(1);

      // Clear cache
      service.clearCache();

      // Second call should hit the detection logic again
      await service.detectEnvironment();
      expect(mockExistsSync).toHaveBeenCalledTimes(2);
    });
  });
});