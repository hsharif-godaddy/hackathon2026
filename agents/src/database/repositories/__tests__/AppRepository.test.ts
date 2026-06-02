/**
 * AppRepository Test Suite
 *
 * Comprehensive tests for the AppRepository class covering:
 * - Database operations (CRUD)
 * - App registration workflow
 * - Git repository initialization
 * - Adapter pattern integration
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppRepository } from '../AppRepository.js';
import path from 'path';
import type { App, UpdateAppRequest } from '../../schema.js';

// Mock all external dependencies
vi.mock('fs');
vi.mock('path');
vi.mock('../../connection.js');
vi.mock('../../../utils/git.js');
vi.mock('../../../workspace/index.js');
vi.mock('../../../logging/index.js');
vi.mock('../../../utils/error.js');

// Mock the logging events
vi.mock('../../../logging/events/index.js', () => ({
  appCleanupEvents: {
    directorySuccess: vi.fn(),
  },
}));

describe('AppRepository', () => {
  let appRepository: AppRepository;
  let mockDb: any;
  let mockGitUtils: any;
  let mockLogger: any;

  // Test data
  const mockAppId = 'test-app-123';
  const mockApp: App = {
    id: mockAppId,
    name: 'Test App',
    path: '/tmp/apps/test-app-123',
    port: 3000,
    initialPrompt: 'Create a test app',
    templateVersion: 'v8',
    status: 'created',
    initialBuildComplete: false,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Clear env vars that might affect tests
    delete process.env.SITE_ID;
    delete process.env.CUSTOMER_APP_DIR;
    delete process.env.APPS_BASE_DIR;
    delete process.env.DOC_APPS;
    delete process.env.NOMAD_ALLOC_DIR;

    // Mock database
    mockDb = {
      prepare: vi.fn(),
      exec: vi.fn(),
    };

    const mockStatement = {
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    };

    // Set up default mock returns
    mockStatement.get.mockImplementation(function (id?: any) {
      if (id === mockAppId || id === 'test-app-123') {
        return {
          id: mockAppId,
          name: 'Test App',
          path: '/tmp/apps/test-app-123',
          port: 3000,
          socket_path: null,
          publish_supervisor_path: null,
          preview_url: null,
          initial_prompt: 'Create a test app',
          template_version: 'v8',
          subscription_id: null,
          customer_id: null,
          status: 'created',
          initial_build_complete: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return null;
    });
    mockStatement.all.mockReturnValue([]);
    mockStatement.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });

    mockDb.prepare.mockReturnValue(mockStatement);

    // Mock database connection
    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    // Mock GitUtils
    const { GitUtils } = await import('../../../utils/git.js');
    mockGitUtils = {
      initRepository: vi.fn().mockResolvedValue({ success: true }),
      configureUser: vi.fn().mockResolvedValue(undefined),
      createInitialCommit: vi.fn().mockResolvedValue({ success: true }),
    };
    vi.mocked(GitUtils).mockImplementation(function () { return mockGitUtils; });

    // Mock logger
    const { Logger } = await import('../../../logging/index.js');
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    vi.mocked(Logger).create = vi.fn().mockReturnValue(mockLogger);

    // Mock error utility
    const { getErrorMessage } = await import('../../../utils/error.js');
    vi.mocked(getErrorMessage).mockImplementation(function (error: any) { return error instanceof Error ? error.message : String(error); }
    );

    // Mock path functions
    vi.mocked(path.join).mockImplementation(function (...args) { return args.join('/'); });
    vi.mocked(path.resolve).mockImplementation(function (...args) { return '/' + args.join('/'); });
    vi.mocked(path.dirname).mockReturnValue('/parent');
    vi.mocked(path.isAbsolute).mockReturnValue(false);
    vi.mocked(path.relative).mockReturnValue('relative/path');

    // Create a new repository instance for each test
    appRepository = new AppRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await appRepository.initialize();
      expect(mockLogger.info).toHaveBeenCalledWith('app.repository.init', expect.any(Object));
    });

    it('should not fail when initialized twice', async () => {
      await appRepository.initialize();
      await appRepository.initialize(); // Second call should not throw
    });
  });

  describe('CRUD Operations', () => {
    describe('findById', () => {
      it('should return app when found', () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue({
            id: mockApp.id,
            name: mockApp.name,
            path: mockApp.path,
            port: mockApp.port,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: mockApp.initialPrompt,
            template_version: mockApp.templateVersion,
            subscription_id: null,
            customer_id: null,
            status: mockApp.status,
            initial_build_complete: 0,
            created_at: mockApp.createdAt.toISOString(),
            updated_at: mockApp.updatedAt.toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.findById(mockAppId);

        expect(result).toMatchObject({
          id: mockApp.id,
          name: mockApp.name,
          path: mockApp.path,
          port: mockApp.port,
          initialPrompt: mockApp.initialPrompt,
          templateVersion: mockApp.templateVersion,
          status: mockApp.status,
          initialBuildComplete: false,
        });
        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
        expect(mockStatement.get).toHaveBeenCalledWith(mockAppId);
      });

      it('should return null when app not found', () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.findById('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('findAll', () => {
      it('should return all apps with default pagination', () => {
        const mockApps = [
          {
            id: 'app1',
            name: 'App 1',
            path: '/tmp/app1',
            port: 3000,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: 'Test',
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'app2',
            name: 'App 2',
            path: '/tmp/app2',
            port: 3001,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: null,
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'creating',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];

        const mockStatement = {
          all: vi.fn().mockReturnValue(mockApps),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.findAll();

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('app1');
        expect(result[1].id).toBe('app2');
        expect(mockStatement.all).toHaveBeenCalledWith(50, 0);
      });

      it('should support custom pagination', () => {
        const mockStatement = {
          all: vi.fn().mockReturnValue([]),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        appRepository.findAll(10, 20);

        expect(mockStatement.all).toHaveBeenCalledWith(10, 20);
      });
    });

    describe('update', () => {
      it('should update app name successfully', () => {
        const existingApp = { ...mockApp };
        const updatedData = { name: 'Updated App Name' };

        const mockGetStatement = {
          get: vi.fn()
            .mockReturnValueOnce({
              id: existingApp.id,
              name: existingApp.name,
              path: existingApp.path,
              port: existingApp.port,
              socket_path: null,
              publish_supervisor_path: null,
              preview_url: null,
              initial_prompt: existingApp.initialPrompt,
              template_version: existingApp.templateVersion,
              subscription_id: null,
              customer_id: null,
              status: existingApp.status,
              initial_build_complete: 0,
              created_at: existingApp.createdAt.toISOString(),
              updated_at: existingApp.updatedAt.toISOString(),
            })
            .mockReturnValueOnce({
              id: existingApp.id,
              name: updatedData.name,
              path: existingApp.path,
              port: existingApp.port,
              socket_path: null,
              publish_supervisor_path: null,
              preview_url: null,
              initial_prompt: existingApp.initialPrompt,
              template_version: existingApp.templateVersion,
              subscription_id: null,
              customer_id: null,
              status: existingApp.status,
              initial_build_complete: 0,
              created_at: existingApp.createdAt.toISOString(),
              updated_at: new Date().toISOString(),
            }),
        };

        const mockUpdateStatement = {
          run: vi.fn(),
        };

        mockDb.prepare.mockImplementation(function (sql: string) {
          if (sql.includes('SELECT')) {
            return mockGetStatement;
          }
          if (sql.includes('UPDATE')) {
            return mockUpdateStatement;
          }
          return { get: vi.fn(), run: vi.fn(), all: vi.fn() };
        });

        const result = appRepository.update(mockAppId, updatedData);

        expect(result?.name).toBe('Updated App Name');
        expect(mockUpdateStatement.run).toHaveBeenCalled();
      });

      it('should return null when app does not exist', () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue(null),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.update('nonexistent', { name: 'New Name' });

        expect(result).toBeNull();
      });

      it('should return existing app when no changes provided', () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue({
            id: mockApp.id,
            name: mockApp.name,
            path: mockApp.path,
            port: mockApp.port,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: mockApp.initialPrompt,
            template_version: mockApp.templateVersion,
            subscription_id: null,
            customer_id: null,
            status: mockApp.status,
            initial_build_complete: 0,
            created_at: mockApp.createdAt.toISOString(),
            updated_at: mockApp.updatedAt.toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.update(mockAppId, {});

        expect(result).not.toBeNull();
        expect(result!.id).toBe(mockAppId);
        expect(result!.name).toBe(mockApp.name);
      });
    });

    describe('updateStatus', () => {
      it('should update app status successfully', () => {
        const mockGetStatement = {
          get: vi.fn()
            .mockReturnValueOnce({
              id: mockApp.id,
              name: mockApp.name,
              path: mockApp.path,
              port: mockApp.port,
              socket_path: null,
              publish_supervisor_path: null,
              preview_url: null,
              initial_prompt: mockApp.initialPrompt,
              template_version: null,
              subscription_id: null,
              customer_id: null,
              status: 'creating',
              initial_build_complete: 0,
              created_at: mockApp.createdAt.toISOString(),
              updated_at: mockApp.updatedAt.toISOString(),
            })
            .mockReturnValueOnce({
              id: mockApp.id,
              name: mockApp.name,
              path: mockApp.path,
              port: mockApp.port,
              socket_path: null,
              publish_supervisor_path: null,
              preview_url: null,
              initial_prompt: mockApp.initialPrompt,
              template_version: null,
              subscription_id: null,
              customer_id: null,
              status: 'created',
              initial_build_complete: 0,
              created_at: mockApp.createdAt.toISOString(),
              updated_at: new Date().toISOString(),
            }),
        };

        const mockUpdateStatement = {
          run: vi.fn(),
        };

        mockDb.prepare.mockImplementation(function (sql: string) {
          if (sql.includes('SELECT')) {
            return mockGetStatement;
          }
          if (sql.includes('UPDATE')) {
            return mockUpdateStatement;
          }
          return { get: vi.fn(), run: vi.fn(), all: vi.fn() };
        });

        const result = appRepository.updateStatus(mockAppId, 'created');

        expect(result?.status).toBe('created');
        expect(mockUpdateStatement.run).toHaveBeenCalled();
      });
    });

    describe('count', () => {
      it('should return correct app count', () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue({ count: 42 }),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.count();

        expect(result).toBe(42);
        expect(mockDb.prepare).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM apps');
      });
    });
  });

  describe('App Registration Workflow', () => {
    it('should register a new app successfully', async () => {
      // First call to findById returns null (app doesn't exist yet)
      // Second call returns the newly created app
      const mockGetStatement = {
        get: vi.fn()
          .mockReturnValueOnce(null) // findById during registerOrUpdateApp - not found
          .mockReturnValueOnce({ // findById after INSERT
            id: 'my-site',
            name: 'App my-site',
            path: '/tmp/airo-app-builder/my-site/preview',
            port: 3000,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: null,
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
      };

      const mockInsertStatement = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
      };

      mockDb.prepare.mockImplementation(function (sql: string) {
        if (sql.includes('INSERT')) {
          return mockInsertStatement;
        }
        return mockGetStatement;
      });

      const result = await appRepository.registerOrUpdateApp({
        siteId: 'my-site',
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.app.id).toBe('my-site');
      expect(mockInsertStatement.run).toHaveBeenCalled();
    });

    it('should update an existing app', async () => {
      const existingRow = {
        id: 'my-site',
        name: 'Old Name',
        path: '/tmp/apps/my-site',
        port: 3000,
        socket_path: null,
        publish_supervisor_path: null,
        preview_url: null,
        initial_prompt: null,
        template_version: null,
        subscription_id: null,
        customer_id: null,
        status: 'created',
        initial_build_complete: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const updatedRow = {
        ...existingRow,
        name: 'New Name',
      };

      const mockGetStatement = {
        get: vi.fn()
          .mockReturnValueOnce(existingRow) // findById - exists
          .mockReturnValueOnce(updatedRow), // findById after UPDATE
      };

      const mockUpdateStatement = {
        run: vi.fn(),
      };

      mockDb.prepare.mockImplementation(function (sql: string) {
        if (sql.includes('UPDATE')) {
          return mockUpdateStatement;
        }
        return mockGetStatement;
      });

      const result = await appRepository.registerOrUpdateApp({
        siteId: 'my-site',
        name: 'New Name',
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(result.app.name).toBe('New Name');
    });

    it('should return existing app when no updates needed', async () => {
      const existingRow = {
        id: 'my-site',
        name: 'Existing App',
        path: '/tmp/apps/my-site',
        port: 3000,
        socket_path: null,
        publish_supervisor_path: null,
        preview_url: null,
        initial_prompt: null,
        template_version: null,
        subscription_id: null,
        customer_id: null,
        status: 'created',
        initial_build_complete: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockGetStatement = {
        get: vi.fn().mockReturnValue(existingRow),
      };

      mockDb.prepare.mockReturnValue(mockGetStatement);

      const result = await appRepository.registerOrUpdateApp({
        siteId: 'my-site',
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(result.message).toBe('App already registered');
    });

    it('should throw on site ID mismatch when SITE_ID env is set', async () => {
      process.env.SITE_ID = 'locked-site';

      await expect(appRepository.registerOrUpdateApp({
        siteId: 'different-site',
      })).rejects.toThrow('Site ID mismatch');
    });

    it('should throw on app path mismatch when CUSTOMER_APP_DIR env is set', async () => {
      process.env.CUSTOMER_APP_DIR = '/locked/path';

      // findById returns null so it tries to create
      const mockGetStatement = {
        get: vi.fn().mockReturnValue(null),
      };
      mockDb.prepare.mockReturnValue(mockGetStatement);

      await expect(appRepository.registerOrUpdateApp({
        siteId: 'my-site',
        appPath: '/different/path',
      })).rejects.toThrow('App path mismatch');
    });

    it('should use CUSTOMER_APP_DIR when set', async () => {
      process.env.CUSTOMER_APP_DIR = '/production/app/dir';

      const mockGetStatement = {
        get: vi.fn()
          .mockReturnValueOnce(null) // not found
          .mockReturnValueOnce({ // after insert
            id: 'my-site',
            name: 'App my-site',
            path: '/production/app/dir',
            port: 3000,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: null,
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
      };

      const mockInsertStatement = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
      };

      mockDb.prepare.mockImplementation(function (sql: string) {
        if (sql.includes('INSERT')) {
          return mockInsertStatement;
        }
        return mockGetStatement;
      });

      const result = await appRepository.registerOrUpdateApp({
        siteId: 'my-site',
      });

      expect(result.success).toBe(true);
      expect(result.app.path).toBe('/production/app/dir');
      expect(mockInsertStatement.run).toHaveBeenCalled();
      // Verify the path argument (3rd positional) is the CUSTOMER_APP_DIR
      const callArgs = mockInsertStatement.run.mock.calls[0];
      expect(callArgs[0]).toBe('my-site');
      expect(callArgs[2]).toBe('/production/app/dir');
    });

    it('should not overwrite immutable subscription_id', async () => {
      const existingRow = {
        id: 'my-site',
        name: 'Existing App',
        path: '/tmp/apps/my-site',
        port: 3000,
        socket_path: null,
        publish_supervisor_path: null,
        preview_url: null,
        initial_prompt: null,
        template_version: null,
        subscription_id: 'existing-sub',
        customer_id: null,
        status: 'created',
        initial_build_complete: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockGetStatement = {
        get: vi.fn().mockReturnValue(existingRow),
      };

      mockDb.prepare.mockReturnValue(mockGetStatement);

      await appRepository.registerOrUpdateApp({
        siteId: 'my-site',
        subscriptionId: 'new-sub',
      });

      // Should log a warning about rejecting the change
      expect(mockLogger.warn).toHaveBeenCalledWith('app.register.subscription_id_change_rejected', expect.any(Object));
    });
  });

  describe('Git Repository Initialization', () => {
    it('should initialize git repo via initGitRepo', async () => {
      const mockGetStatement = {
        get: vi.fn().mockReturnValue({
          id: mockAppId,
          name: 'Test App',
          path: '/tmp/apps/test-app-123',
          port: 3000,
          socket_path: null,
          publish_supervisor_path: null,
          preview_url: null,
          initial_prompt: 'Test',
          template_version: null,
          subscription_id: null,
          customer_id: null,
          status: 'created',
          initial_build_complete: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      };
      mockDb.prepare.mockReturnValue(mockGetStatement);

      await appRepository.initGitRepo(mockAppId);

      expect(mockGitUtils.initRepository).toHaveBeenCalledWith('/tmp/apps/test-app-123');
      expect(mockGitUtils.configureUser).toHaveBeenCalled();
      expect(mockGitUtils.createInitialCommit).toHaveBeenCalled();
    });

    it('should handle app not found for initGitRepo', async () => {
      const mockGetStatement = {
        get: vi.fn().mockReturnValue(null),
      };
      mockDb.prepare.mockReturnValue(mockGetStatement);

      await appRepository.initGitRepo('nonexistent');

      expect(mockGitUtils.initRepository).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('app.git.init.failed', expect.objectContaining({
        appId: 'nonexistent',
      }));
    });

    it('should handle git init failure gracefully', async () => {
      const mockGetStatement = {
        get: vi.fn().mockReturnValue({
          id: mockAppId,
          name: 'Test App',
          path: '/tmp/apps/test-app-123',
          port: 3000,
          socket_path: null,
          publish_supervisor_path: null,
          preview_url: null,
          initial_prompt: 'Test',
          template_version: null,
          subscription_id: null,
          customer_id: null,
          status: 'created',
          initial_build_complete: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      };
      mockDb.prepare.mockReturnValue(mockGetStatement);

      mockGitUtils.initRepository.mockResolvedValue({ success: false, stderr: 'git not found' });

      // Should not throw
      await appRepository.initGitRepo(mockAppId);

      expect(mockLogger.warn).toHaveBeenCalledWith('app.git.init.failed', expect.any(Object));
    });
  });

  describe('Development Server Management', () => {
    describe('restartServer', () => {
      it('should return false when app does not exist', async () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue(null),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = await appRepository.restartServer('nonexistent-app');

        expect(result).toBe(false);
      });

      it('should return false when no workspace available in local mode', async () => {
        const mockGetStatement = {
          get: vi.fn().mockReturnValue({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            port: 3000,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: 'Test',
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockGetStatement);

        const { createForWorkspace } = await import('../../../workspace/index.js');
        vi.mocked(createForWorkspace).mockReturnValue(null);

        const result = await appRepository.restartServer(mockAppId);

        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith('app.server.restart.no_workspace', expect.any(Object));
      });

      it('should use workspace tasks when available', async () => {
        const mockGetStatement = {
          get: vi.fn().mockReturnValue({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            port: 3000,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: 'Test',
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockGetStatement);

        const mockRunCommandSync = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false, taskId: 'mock', executionTimeMs: 0 });

        const { createForWorkspace } = await import('../../../workspace/index.js');
        vi.mocked(createForWorkspace).mockReturnValue({ tasks: { runCommandSync: mockRunCommandSync } } as any);

        const result = await appRepository.restartServer(mockAppId);

        expect(result).toBe(true);
        expect(mockRunCommandSync).toHaveBeenCalledWith(expect.objectContaining({
          command: 'npm run dev',
          workingDir: '/app',
          timeoutSeconds: 30,
        }));
      });

      it('should return false when runCommandSync returns non-zero exit code', async () => {
        const mockGetStatement = {
          get: vi.fn().mockReturnValue({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            site_id: null,
            template_id: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockGetStatement);

        const mockRunCommandSync = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'Error: port in use', timedOut: false, taskId: 'mock', executionTimeMs: 500 });

        const { createForWorkspace } = await import('../../../workspace/index.js');
        vi.mocked(createForWorkspace).mockReturnValue({ tasks: { runCommandSync: mockRunCommandSync } } as any);

        const result = await appRepository.restartServer(mockAppId);

        expect(result).toBe(false);
      });

      it('should return false and log error when runCommandSync throws', async () => {
        const mockGetStatement = {
          get: vi.fn().mockReturnValue({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            site_id: null,
            template_id: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockGetStatement);

        const mockRunCommandSync = vi.fn().mockRejectedValue(new Error('Connection refused'));

        const { createForWorkspace } = await import('../../../workspace/index.js');
        vi.mocked(createForWorkspace).mockReturnValue({ tasks: { runCommandSync: mockRunCommandSync } } as any);

        const result = await appRepository.restartServer(mockAppId);

        expect(result).toBe(false);
        expect(mockLogger.error).toHaveBeenCalledWith('app.server.restart.workspace.failed', expect.objectContaining({
          appId: mockAppId,
        }));
      });
    });
  });

  describe('Delete Operations', () => {
    it('should delete app and cleanup resources', async () => {
      const mockGetStatement = {
        get: vi.fn().mockReturnValue({
          id: mockAppId,
          name: 'Test App',
          path: '/tmp/apps/test-app-123',
          port: 3000,
          socket_path: null,
          publish_supervisor_path: null,
          preview_url: null,
          initial_prompt: 'Test',
          template_version: null,
          subscription_id: null,
          customer_id: null,
          status: 'created',
          initial_build_complete: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      };

      const mockDeleteStatement = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
      };

      mockDb.prepare.mockImplementation(function (sql: string) {
        if (sql.includes('DELETE')) {
          return mockDeleteStatement;
        }
        return mockGetStatement;
      });

      const result = await appRepository.delete(mockAppId);

      expect(result).toBe(true);
      expect(mockDeleteStatement.run).toHaveBeenCalledWith(mockAppId);
    });

    it('should return false when app does not exist', async () => {
      const mockStatement = {
        get: vi.fn().mockReturnValue(null),
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const result = await appRepository.delete('nonexistent-app');

      expect(result).toBe(false);
    });
  });

  describe('Adapter Integration', () => {
    it('should provide adapter information in local mode', () => {
      const info = appRepository.getAdapterInfo();

      expect(info).toEqual({
        type: 'Local',
        isInitialized: true,
        capabilities: null,
        environmentVariable: 'unset (defaults to Local)',
      });
    });

    it('should report Docker mode when DOC_APPS is set', () => {
      process.env.DOC_APPS = 'true';

      // Need a new instance to pick up the env var in methods
      const dockerRepo = new AppRepository();
      const info = dockerRepo.getAdapterInfo();

      expect(info.type).toBe('Docker');
      expect(info.environmentVariable).toBe('true');
    });

    it('should report Docker mode correctly via isDockerModePublic', () => {
      expect(appRepository.isDockerModePublic()).toBe(false);

      process.env.DOC_APPS = 'true';
      expect(appRepository.isDockerModePublic()).toBe(true);
    });

    describe('Adapter Methods', () => {
      it('should get app status in local mode (no adapter)', async () => {
        const result = await appRepository.getAppStatus(mockAppId);

        expect(result.status).toBe('created');
        expect(result.message).toBe('App exists in database');
      });

      it('should throw when getting logs in local mode (no adapter)', async () => {
        await expect(appRepository.getAppLogs(mockAppId)).rejects.toThrow(
          'Log retrieval not supported in current deployment mode'
        );
      });

      it('should throw when rebuilding container in local mode (no adapter)', async () => {
        await expect(appRepository.rebuildAppContainer(mockAppId)).rejects.toThrow(
          'Container rebuilding not supported in current deployment mode'
        );
      });
    });
  });

  describe('markInitialBuildComplete', () => {
    it('should mark initial build as complete', () => {
      const mockGetStatement = {
        get: vi.fn()
          .mockReturnValueOnce({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            port: 3000,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: 'Test',
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .mockReturnValueOnce({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            port: 3000,
            socket_path: null,
            publish_supervisor_path: null,
            preview_url: null,
            initial_prompt: 'Test',
            template_version: null,
            subscription_id: null,
            customer_id: null,
            status: 'created',
            initial_build_complete: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
      };

      const mockUpdateStatement = {
        run: vi.fn(),
      };

      mockDb.prepare.mockImplementation(function (sql: string) {
        if (sql.includes('UPDATE')) {
          return mockUpdateStatement;
        }
        return mockGetStatement;
      });

      const result = appRepository.markInitialBuildComplete(mockAppId);

      expect(result).not.toBeNull();
      expect(result!.initialBuildComplete).toBe(true);
      expect(mockUpdateStatement.run).toHaveBeenCalled();
    });

    it('should return existing app if already marked complete', () => {
      const mockGetStatement = {
        get: vi.fn().mockReturnValue({
          id: mockAppId,
          name: 'Test App',
          path: '/tmp/apps/test-app-123',
          port: 3000,
          socket_path: null,
          publish_supervisor_path: null,
          preview_url: null,
          initial_prompt: 'Test',
          template_version: null,
          subscription_id: null,
          customer_id: null,
          status: 'created',
          initial_build_complete: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      };
      mockDb.prepare.mockReturnValue(mockGetStatement);

      const result = appRepository.markInitialBuildComplete(mockAppId);

      expect(result).not.toBeNull();
      expect(result!.initialBuildComplete).toBe(true);
    });

    it('should return null when app not found', () => {
      const mockGetStatement = {
        get: vi.fn().mockReturnValue(null),
      };
      mockDb.prepare.mockReturnValue(mockGetStatement);

      const result = appRepository.markInitialBuildComplete('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const { getDatabase } = await import('../../connection.js');
      vi.mocked(getDatabase).mockImplementation(function () {
        throw new Error('Database connection failed');
      });

      expect(() => new AppRepository()).toThrow('Database connection failed');
    });
  });
});
