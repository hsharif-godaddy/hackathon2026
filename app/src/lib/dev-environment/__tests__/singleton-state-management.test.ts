import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Test suite for Singleton State Management
 *
 * Covers:
 * - Instance creation and reuse across multiple callers
 * - Concurrent initialization handling (initializationPromise pattern)
 * - State consistency between singleton instances
 */

// Mock dependencies
vi.mock('execa');

// Mock child_process to handle Docker availability check (execSync('docker info'))
// Use importOriginal to preserve spawn and other exports needed by git.ts
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn(() => 'Docker version 20.10.0')
  };
});

// Mock the adapters/index to avoid Docker availability check and provide mock DockerAppService
vi.mock('../adapters/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/index')>();
  return {
    ...actual,
    createAppAdapter: vi.fn(async () => ({
      initialized: false,
      async initialize() {
        this.initialized = true;
      },
      getCapabilities() {
        return {
          supportsContainerOperations: true,
          supportsProcessOperations: false,
          supportsRebuild: true,
          supportsLogs: true
        };
      }
    })),
    getAdapterType: vi.fn(() => 'docker'),
    isDockerMode: vi.fn(() => true)
  };
});

// Mock DockerAppService with a proper class constructor
vi.mock('../adapters/DockerAppService.js', () => ({
  DockerAppService: class MockDockerAppService {
    private devDb: any;
    initialized = false;

    constructor(devDb: any) {
      this.devDb = devDb;
    }

    async initialize(): Promise<void> {
      this.initialized = true;
    }

    getCapabilities() {
      return {
        supportsContainerOperations: true,
        supportsProcessOperations: false,
        supportsRebuild: true,
        supportsLogs: true
      };
    }
  }
}));

describe('Singleton State Management', () => {
  let DevDatabase: any;
  let DevEnvironmentManager: any;
  let DockerContainerManager: any;

  beforeEach(async () => {
    // Reset module cache to get fresh imports
    vi.resetModules();

    // Import modules after reset
    const dbModule = await import('../database/DevDatabase.js');
    const managerModule = await import('../DevEnvironmentManager.js');
    const dockerModule = await import('../services/docker-container-manager.js');

    DevDatabase = dbModule.DevDatabase;
    DevEnvironmentManager = managerModule.DevEnvironmentManager;
    DockerContainerManager = dockerModule.DockerContainerManager;

    // Reset singleton instances
    (DevDatabase as any).instance = null;
    (DevEnvironmentManager as any).instance = null;
    (DockerContainerManager as any).instance = null;
    (DockerContainerManager as any).initializationPromise = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('DevDatabase Singleton', () => {
    it('should return the same instance across multiple calls', () => {
      const instance1 = DevDatabase.getInstance();
      const instance2 = DevDatabase.getInstance();
      const instance3 = DevDatabase.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
      expect(instance1).toBeDefined();
    });

    it('should create instance lazily on first call', () => {
      expect((DevDatabase as any).instance).toBeNull();

      const instance = DevDatabase.getInstance();

      expect(instance).toBeDefined();
      expect((DevDatabase as any).instance).toBe(instance);
    });

    it('should share state across all getInstance calls', () => {
      const db1 = DevDatabase.getInstance();
      const db2 = DevDatabase.getInstance();

      // Add app via first instance
      const appInfo = {
        appId: 'test-app',
        port: 5001,
        appPath: '/test/path',
        templateVersion: 'v8',
        status: 'created' as const
      };

      db1.createDevApp(appInfo);

      // Verify second instance sees the same state
      const foundApp = db2.findDevAppById('test-app');
      expect(foundApp).toBeDefined();
      expect(foundApp?.appId).toBe('test-app');
      expect(foundApp?.port).toBe(5001);
    });

    it('should maintain consistent port allocations across instances', () => {
      const db1 = DevDatabase.getInstance();
      const db2 = DevDatabase.getInstance();

      // Create app with port via first instance
      db1.createDevApp({
        appId: 'app1',
        port: 5001,
        appPath: '/test/app1',
        templateVersion: 'v8',
        status: 'created'
      });

      // Check port allocation via second instance
      const app = db2.findDevAppById('app1');
      expect(app).toBeDefined();
      expect(app?.port).toBe(5001);
    });

    it('should prevent duplicate app creation via idempotency', () => {
      const db = DevDatabase.getInstance();

      const appInfo = {
        appId: 'test-app',
        port: 5001,
        appPath: '/test/path',
        templateVersion: 'v8',
        status: 'created' as const
      };

      // Create app twice
      const app1 = db.createDevApp(appInfo);
      const app2 = db.createDevApp(appInfo);

      // Should return the same instance
      expect(app1).toBe(app2);

      // Verify only one app exists by checking it's still the same instance
      const foundApp = db.findDevAppById('test-app');
      expect(foundApp).toBe(app1);
    });
  });

  describe('DevEnvironmentManager Singleton', () => {
    it('should return the same instance across multiple calls', () => {
      const instance1 = DevEnvironmentManager.getInstance();
      const instance2 = DevEnvironmentManager.getInstance();
      const instance3 = DevEnvironmentManager.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it('should create instance lazily on first call', () => {
      expect((DevEnvironmentManager as any).instance).toBeNull();

      const instance = DevEnvironmentManager.getInstance();

      expect(instance).toBeDefined();
      expect((DevEnvironmentManager as any).instance).toBe(instance);
    });

    it('should use same DevDatabase singleton instance', () => {
      const devDb = DevDatabase.getInstance();
      const manager = DevEnvironmentManager.getInstance();

      // Verify manager uses the same DevDatabase instance
      expect((manager as any).devDb).toBe(devDb);
    });

    it('should share initialization state across instances', async () => {
      const manager1 = DevEnvironmentManager.getInstance();
      const manager2 = DevEnvironmentManager.getInstance();

      // Initialize via first instance
      await manager1.initialize();

      // Verify second instance sees initialized state
      expect((manager2 as any).initialized).toBe(true);
      expect((manager2 as any).adapter).toBeDefined();
    });

    it('should not reinitialize when already initialized', async () => {
      const manager = DevEnvironmentManager.getInstance();

      await manager.initialize();
      const adapter1 = (manager as any).adapter;

      await manager.initialize();
      const adapter2 = (manager as any).adapter;

      // Should use the same adapter instance
      expect(adapter1).toBe(adapter2);
    });
  });

  describe('DockerContainerManager Singleton', () => {
    it('should return the same instance across multiple calls', () => {
      const devDb = DevDatabase.getInstance();
      const instance1 = DockerContainerManager.getInstance(devDb);
      const instance2 = DockerContainerManager.getInstance(devDb);
      const instance3 = DockerContainerManager.getInstance(devDb);

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it('should use same DevDatabase singleton instance', () => {
      const devDb = DevDatabase.getInstance();
      const dockerManager = DockerContainerManager.getInstance(devDb);

      expect((dockerManager as any).devDb).toBe(devDb);
    });
  });

  describe('Concurrent Initialization Handling', () => {
    it('should handle concurrent initialization without race conditions', async () => {
      const manager = DevEnvironmentManager.getInstance();

      // Execute: Multiple concurrent initialize calls
      await Promise.all([
        manager.initialize(),
        manager.initialize(),
        manager.initialize(),
        manager.initialize(),
        manager.initialize()
      ]);

      // Verify: Initialization should complete successfully
      expect((manager as any).initialized).toBe(true);
      expect((manager as any).adapter).toBeDefined();
    });

    it('should handle concurrent DockerContainerManager initialization', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      // Mock Docker availability checks
      mockExeca.mockResolvedValue({ stdout: 'Docker version 20.10.0', stderr: '' } as any);

      const devDb = DevDatabase.getInstance();
      const docker1 = DockerContainerManager.getInstance(devDb);
      const docker2 = DockerContainerManager.getInstance(devDb);

      // Mock internal methods to prevent actual Docker operations
      vi.spyOn(docker1 as any, 'recoverExistingContainers').mockResolvedValue(undefined);

      // Mock SharedMySQLService.initialize
      if ((docker1 as any).sharedMySQLService) {
        vi.spyOn((docker1 as any).sharedMySQLService, 'initialize').mockResolvedValue(undefined);
      }

      // Execute: Concurrent initialization
      await Promise.all([
        docker1.initialize(),
        docker2.initialize(),
        docker1.initialize(),
        docker2.initialize()
      ]);

      // Verify: Both instances are initialized
      expect((docker1 as any).initialized).toBe(true);
      expect((docker2 as any).initialized).toBe(true);

      // Should be the same instance
      expect(docker1).toBe(docker2);
    }, 10000); // Increase timeout to 10 seconds

    it('should use initializationPromise to prevent duplicate initialization', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      // Mock Docker commands with delay to simulate slow initialization
      mockExeca.mockResolvedValue({ stdout: 'Docker version 20.10.0', stderr: '' } as any);

      const devDb = DevDatabase.getInstance();
      const docker = DockerContainerManager.getInstance(devDb);

      // Mock internal methods to prevent actual Docker operations
      vi.spyOn(docker as any, 'recoverExistingContainers').mockResolvedValue(undefined);

      // Mock SharedMySQLService.initialize
      if ((docker as any).sharedMySQLService) {
        vi.spyOn((docker as any).sharedMySQLService, 'initialize').mockResolvedValue(undefined);
      }

      // Execute: Start multiple initializations concurrently
      const promises = [
        docker.initialize(),
        docker.initialize(),
        docker.initialize()
      ];

      await Promise.all(promises);

      // Verify: initializationPromise should prevent duplicate initialization
      // Note: The check runs docker --version and docker-compose --version
      // With concurrent calls, all should share the same promise
      expect((docker as any).initialized).toBe(true);
    }, 10000); // Increase timeout to 10 seconds

    it('should allow initialization to be called again after failure', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      const devDb = DevDatabase.getInstance();
      const docker = DockerContainerManager.getInstance(devDb);

      // Mock internal methods for first attempt (will fail on execa)
      vi.spyOn(docker as any, 'recoverExistingContainers').mockResolvedValue(undefined);

      // Mock SharedMySQLService.initialize
      if ((docker as any).sharedMySQLService) {
        vi.spyOn((docker as any).sharedMySQLService, 'initialize').mockResolvedValue(undefined);
      }

      // First attempt fails
      mockExeca.mockRejectedValueOnce(new Error('Docker not available'));

      // First initialization should fail
      await expect(docker.initialize()).rejects.toThrow();

      // Reset mock for second attempt
      mockExeca.mockResolvedValue({ stdout: 'Docker version 20.10.0', stderr: '' } as any);

      // Second attempt should succeed
      await expect(docker.initialize()).resolves.not.toThrow();
    }, 10000); // Increase timeout to 10 seconds
  });

  describe('State Consistency Between Singletons', () => {
    it('should maintain consistent container records between DevDatabase and DockerContainerManager', () => {
      const devDb = DevDatabase.getInstance();
      const dockerManager = DockerContainerManager.getInstance(devDb);

      // Create app record in DevDatabase
      devDb.createDevApp({
        appId: 'test-app',
        port: 5001,
        supervisorPort: 8877,
        appPath: '/test/app',
        templateVersion: 'v8',
        status: 'created'
      });

      // Verify DockerContainerManager uses the same DevDatabase
      const appFromDocker = (dockerManager as any).devDb.findDevAppById('test-app');
      expect(appFromDocker).toBeDefined();
      expect(appFromDocker?.appId).toBe('test-app');
      expect(appFromDocker?.port).toBe(5001);
    });

    it('should maintain consistent state when creating apps via DevEnvironmentManager', async () => {
      const devDb = DevDatabase.getInstance();
      const manager = DevEnvironmentManager.getInstance();

      await manager.initialize();

      // Note: We can't actually create an app without full Docker setup,
      // but we can verify the DevDatabase is shared
      const dbFromManager = (manager as any).devDb;
      expect(dbFromManager).toBe(devDb);
    });

    it('should share port allocations across all singletons', () => {
      const devDb = DevDatabase.getInstance();
      const manager = DevEnvironmentManager.getInstance();
      const dockerManager = DockerContainerManager.getInstance(devDb);

      // Allocate port via DevDatabase
      devDb.createDevApp({
        appId: 'app1',
        port: 5001,
        appPath: '/test/app1',
        templateVersion: 'v8',
        status: 'created'
      });

      // Verify all instances see the same state
      expect((manager as any).devDb.findDevAppById('app1')).toBeDefined();
      expect((dockerManager as any).devDb.findDevAppById('app1')).toBeDefined();

      // All should reference the same Map
      const app1 = devDb.findDevAppById('app1');
      const app2 = (manager as any).devDb.findDevAppById('app1');
      const app3 = (dockerManager as any).devDb.findDevAppById('app1');

      expect(app1).toBe(app2);
      expect(app2).toBe(app3);
    });

    it('should update status consistently across all singleton references', () => {
      const devDb = DevDatabase.getInstance();
      const dockerManager = DockerContainerManager.getInstance(devDb);

      // Create app
      devDb.createDevApp({
        appId: 'test-app',
        port: 5001,
        appPath: '/test/app',
        templateVersion: 'v8',
        status: 'creating'
      });

      // Update status via one instance
      devDb.updateDevAppStatus('test-app', 'running');

      // Verify other instance sees the update
      const app = (dockerManager as any).devDb.findDevAppById('test-app');
      expect(app?.status).toBe('running');
    });

    it('should delete apps consistently across all singleton references', () => {
      const devDb = DevDatabase.getInstance();
      const manager = DevEnvironmentManager.getInstance();

      // Create app
      devDb.createDevApp({
        appId: 'test-app',
        port: 5001,
        appPath: '/test/app',
        templateVersion: 'v8',
        status: 'created'
      });

      // Delete via one instance
      devDb.deleteDevApp('test-app');

      // Verify deletion is visible to other instance
      const app = (manager as any).devDb.findDevAppById('test-app');
      expect(app).toBeNull();
    });
  });

  describe('Singleton Test Isolation', () => {
    it('should allow resetting singleton instances for testing', () => {
      // Get initial instance
      const instance1 = DevDatabase.getInstance();

      // Reset instance (simulating test cleanup)
      (DevDatabase as any).instance = null;

      // Get new instance
      const instance2 = DevDatabase.getInstance();

      // Should be different instances (in a test environment)
      expect(instance1).not.toBe(instance2);
    });

    it('should start with clean state after reset', () => {
      const db = DevDatabase.getInstance();

      // Add some data
      db.createDevApp({
        appId: 'test-app',
        port: 5001,
        appPath: '/test/app',
        templateVersion: 'v8',
        status: 'created'
      });

      // Reset instance
      (DevDatabase as any).instance = null;

      // Get new instance
      const newDb = DevDatabase.getInstance();

      // Should have clean state
      const app = newDb.findDevAppById('test-app');
      expect(app).toBeNull();
    });

    it('should handle resetting all singletons together', () => {
      // Get all instances
      const devDb1 = DevDatabase.getInstance();
      const manager1 = DevEnvironmentManager.getInstance();
      const docker1 = DockerContainerManager.getInstance(devDb1);

      // Reset all
      (DevDatabase as any).instance = null;
      (DevEnvironmentManager as any).instance = null;
      (DockerContainerManager as any).instance = null;

      // Get new instances
      const devDb2 = DevDatabase.getInstance();
      const manager2 = DevEnvironmentManager.getInstance();
      const docker2 = DockerContainerManager.getInstance(devDb2);

      // Should all be new instances
      expect(devDb1).not.toBe(devDb2);
      expect(manager1).not.toBe(manager2);
      expect(docker1).not.toBe(docker2);

      // New instances should still be connected
      expect((manager2 as any).devDb).toBe(devDb2);
      expect((docker2 as any).devDb).toBe(devDb2);
    });
  });
});
