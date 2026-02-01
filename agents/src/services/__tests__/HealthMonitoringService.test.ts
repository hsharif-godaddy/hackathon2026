import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthMonitoringService, createHealthMonitoringService } from '../HealthMonitoringService.js';
import * as DevSupervisorClient from '../DevSupervisorClient.js';

// Mock DevSupervisorClient
vi.mock('../DevSupervisorClient.js', () => ({
  createDevSupervisorClient: vi.fn(),
  DevSupervisorClient: vi.fn()
}));

describe('HealthMonitoringService', () => {
  let service: HealthMonitoringService;
  let mockDevSupervisorClient: any;

  beforeEach(() => {
    mockDevSupervisorClient = {
      isAvailable: vi.fn().mockReturnValue(true),
      configureHealthCheck: vi.fn(),
      getHealthStatus: vi.fn(),
      getRestartStats: vi.fn()
    };

    vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(mockDevSupervisorClient);
    service = new HealthMonitoringService();
  });

  describe('isAvailable', () => {
    it('should return true when dev-supervisor is available', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it('should return false when dev-supervisor is not available', () => {
      mockDevSupervisorClient.isAvailable.mockReturnValue(false);
      expect(service.isAvailable()).toBe(false);
    });

    it('should return false when dev-supervisor client is null', () => {
      vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(null);
      const nullService = new HealthMonitoringService();
      expect(nullService.isAvailable()).toBe(false);
    });
  });

  describe('configureHealthMonitoring', () => {
    it('should configure health monitoring successfully', async () => {
      mockDevSupervisorClient.configureHealthCheck.mockResolvedValue(undefined);

      const config = {
        appId: 'test-app',
        healthCheck: {
          type: 'http' as const,
          url: 'http://localhost:3000/health',
          interval: '30s',
          timeout: '10s',
          failure_threshold: 3
        },
        restartPolicy: {
          enabled: true,
          max_restarts: 5,
          restart_window: '5m'
        }
      };

      const result = await service.configureHealthMonitoring(config);

      expect(result).toBe(true);
      expect(mockDevSupervisorClient.configureHealthCheck).toHaveBeenCalledWith(
        config.healthCheck,
        config.restartPolicy
      );
    });

    it('should handle configuration failure', async () => {
      mockDevSupervisorClient.configureHealthCheck.mockRejectedValue(new Error('Configuration failed'));

      const config = {
        appId: 'test-app',
        healthCheck: {
          type: 'http' as const,
          url: 'http://localhost:3000/health',
          interval: '30s',
          timeout: '10s',
          failure_threshold: 3
        }
      };

      const result = await service.configureHealthMonitoring(config);

      expect(result).toBe(false);
    });

    it('should return false when dev-supervisor is unavailable', async () => {
      vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(null);
      const nullService = new HealthMonitoringService();

      const config = {
        appId: 'test-app',
        healthCheck: {
          type: 'http' as const,
          url: 'http://localhost:3000/health',
          interval: '30s',
          timeout: '10s',
          failure_threshold: 3
        }
      };

      const result = await nullService.configureHealthMonitoring(config);

      expect(result).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should retrieve health status successfully', async () => {
      const mockHealthStatus = {
        status: 'healthy' as const,
        message: 'All checks passing',
        last_check: '2025-01-01T00:00:00Z',
        duration: 50,
        consecutive_failures: 0,
        consecutive_successes: 5
      };

      const mockRestartStats = {
        total_restarts: 2,
        recent_restarts: 0,
        restart_window: '5m',
        max_restarts: 5
      };

      mockDevSupervisorClient.getHealthStatus.mockResolvedValue(mockHealthStatus);
      mockDevSupervisorClient.getRestartStats.mockResolvedValue(mockRestartStats);

      const result = await service.getHealthStatus('test-app');

      expect(result).toEqual({
        active: true,
        status: 'healthy',
        message: 'All checks passing',
        lastCheck: '2025-01-01T00:00:00Z',
        duration: 50,
        consecutiveFailures: 0,
        restartStats: {
          totalRestarts: 2,
          recentRestarts: 0,
          maxRestarts: 5
        }
      });
    });

    it('should handle health status retrieval failure', async () => {
      mockDevSupervisorClient.getHealthStatus.mockRejectedValue(new Error('Status retrieval failed'));

      const result = await service.getHealthStatus('test-app');

      expect(result).toBeNull();
    });

    it('should return null when dev-supervisor is unavailable', async () => {
      vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(null);
      const nullService = new HealthMonitoringService();

      const result = await nullService.getHealthStatus('test-app');

      expect(result).toBeNull();
    });
  });

  describe('configureWebAppHealthMonitoring', () => {
    it('should configure web app health monitoring with defaults', async () => {
      mockDevSupervisorClient.configureHealthCheck.mockResolvedValue(undefined);

      const result = await service.configureWebAppHealthMonitoring('test-app', 3000);

      expect(result).toBe(true);
      expect(mockDevSupervisorClient.configureHealthCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'http',
          url: 'http://localhost:3000/airo/health',
          interval: '30s',
          timeout: '10s',
          failure_threshold: 3
        }),
        expect.objectContaining({
          enabled: true,
          max_restarts: 5,
          restart_window: '5m'
        })
      );
    });

    it('should configure web app health monitoring with custom path', async () => {
      mockDevSupervisorClient.configureHealthCheck.mockResolvedValue(undefined);

      const result = await service.configureWebAppHealthMonitoring('test-app', 3000, {
        healthPath: '/api/health'
      });

      expect(result).toBe(true);
      expect(mockDevSupervisorClient.configureHealthCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/api/health'
        }),
        expect.any(Object)
      );
    });

    it('should configure web app health monitoring with production restart policy', async () => {
      mockDevSupervisorClient.configureHealthCheck.mockResolvedValue(undefined);

      const result = await service.configureWebAppHealthMonitoring('test-app', 3000, {
        restartPolicy: 'production'
      });

      expect(result).toBe(true);
      expect(mockDevSupervisorClient.configureHealthCheck).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          enabled: true,
          max_restarts: 3,
          restart_window: '10m'
        })
      );
    });
  });

  describe('disableHealthMonitoring', () => {
    it('should disable health monitoring successfully', async () => {
      mockDevSupervisorClient.configureHealthCheck.mockResolvedValue(undefined);

      const result = await service.disableHealthMonitoring('test-app');

      expect(result).toBe(true);
      expect(mockDevSupervisorClient.configureHealthCheck).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should handle disable failure', async () => {
      mockDevSupervisorClient.configureHealthCheck.mockRejectedValue(new Error('Disable failed'));

      const result = await service.disableHealthMonitoring('test-app');

      expect(result).toBe(false);
    });

    it('should return false when dev-supervisor is unavailable', async () => {
      vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(null);
      const nullService = new HealthMonitoringService();

      const result = await nullService.disableHealthMonitoring('test-app');

      expect(result).toBe(false);
    });
  });

  describe('static factory methods', () => {
    it('should create HTTP health check configuration', () => {
      const config = HealthMonitoringService.createHttpHealthCheck(3000);

      expect(config).toEqual({
        type: 'http',
        url: 'http://localhost:3000/airo/health',
        interval: '30s',
        timeout: '10s',
        failure_threshold: 3,
        success_threshold: 2,
        start_period: '60s'
      });
    });

    it('should create HTTP health check with custom path', () => {
      const config = HealthMonitoringService.createHttpHealthCheck(3000, '/api/health');

      expect(config.url).toBe('http://localhost:3000/api/health');
    });

    it('should create TCP health check configuration', () => {
      const config = HealthMonitoringService.createTcpHealthCheck(5432);

      expect(config).toEqual({
        type: 'tcp',
        address: 'localhost:5432',
        interval: '30s',
        timeout: '5s',
        failure_threshold: 3,
        success_threshold: 2,
        start_period: '30s'
      });
    });

    it('should create command health check configuration', () => {
      const config = HealthMonitoringService.createCommandHealthCheck('curl -f http://localhost:3000/health');

      expect(config).toEqual({
        type: 'command',
        command: 'curl -f http://localhost:3000/health',
        interval: '60s',
        timeout: '30s',
        failure_threshold: 3,
        success_threshold: 1,
        start_period: '30s'
      });
    });

    it('should create default restart policy', () => {
      const policy = HealthMonitoringService.createDefaultRestartPolicy();

      expect(policy).toEqual({
        enabled: true,
        max_restarts: 5,
        restart_window: '5m',
        backoff_multiplier: 2,
        max_backoff: '1m',
        initial_delay: '5s'
      });
    });

    it('should create production restart policy', () => {
      const policy = HealthMonitoringService.createProductionRestartPolicy();

      expect(policy).toEqual({
        enabled: true,
        max_restarts: 3,
        restart_window: '10m',
        backoff_multiplier: 2.5,
        max_backoff: '5m',
        initial_delay: '10s'
      });
    });
  });
});

describe('createHealthMonitoringService', () => {
  it('should return service when available', () => {
    const mockDevSupervisorClient = {
      isAvailable: vi.fn().mockReturnValue(true)
    };
    vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(mockDevSupervisorClient as any);

    const service = createHealthMonitoringService();

    expect(service).toBeInstanceOf(HealthMonitoringService);
  });

  it('should return null when unavailable', () => {
    const mockDevSupervisorClient = {
      isAvailable: vi.fn().mockReturnValue(false)
    };
    vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(mockDevSupervisorClient as any);

    const service = createHealthMonitoringService();

    expect(service).toBeNull();
  });

  it('should return null when dev-supervisor client is null', () => {
    vi.mocked(DevSupervisorClient.createDevSupervisorClient).mockReturnValue(null);

    const service = createHealthMonitoringService();

    expect(service).toBeNull();
  });
});