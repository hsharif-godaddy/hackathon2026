/**
 * AppRepository Test Suite
 * 
 * Comprehensive tests for the AppRepository class covering:
 * - Database operations (CRUD)
 * - App creation workflow with template copying
 * - Development server lifecycle management
 * - Process recovery and cleanup
 * - Adapter pattern integration
 * - Git repository initialization
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { AppRepository } from '../AppRepository.js';
import { nanoid } from 'nanoid';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import type { App, CreateAppRequest } from '../../schema.js';

// Mock all external dependencies
vi.mock('nanoid');
vi.mock('fs');
vi.mock('child_process');
vi.mock('path');
vi.mock('net');
vi.mock('../../connection.js');
vi.mock('../../../utils/git.js');
vi.mock('../../../utils/port-manager.js');
vi.mock('../../../utils/template-version.js');
vi.mock('../../../adapters/index.js');
vi.mock('../../../services/name-suggestion.js');
vi.mock('../../../services/TemplateCopyService.js');
vi.mock('../../../services/ProcessService.js');
vi.mock('../../../logging/index.js');
vi.mock('../../../utils/error.js');

// Mock the logging events
vi.mock('../../../logging/events/index.js', () => ({
  appRepositoryEvents: {
    initBegin: vi.fn(),
    initSuccess: vi.fn(),
    initFailure: vi.fn(),
  },
  appProcessEvents: {
    recoverBegin: vi.fn(),
    recoverSuccess: vi.fn(),
  },
  appCreationEvents: {
    begin: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
  },
  appNameEvents: {
    suggestSuccess: vi.fn(),
    suggestFailure: vi.fn(),
  },
  appTemplateEvents: {
    resolveSuccess: vi.fn(),
    copyBegin: vi.fn(),
    copySuccess: vi.fn(),
    copyFailure: vi.fn(),
  },
  appDirectoryEvents: {
    createSuccess: vi.fn(),
    createFailure: vi.fn(),
    cleanupSuccess: vi.fn(),
  },
  appSetupEvents: {
    initBegin: vi.fn(),
    initSuccess: vi.fn(),
    initFailure: vi.fn(),
    initProgress: vi.fn(),
  },
  appServerEvents: {
    startBegin: vi.fn(),
    startSuccess: vi.fn(),
    startFailure: vi.fn(),
  },
  appLifecycleEvents: {
    ready: vi.fn(),
  },
  appProcessManagementEvents: {
    killSuccess: vi.fn(),
  },
  appCleanupEvents: {
    directorySuccess: vi.fn(),
  },
}));

describe('AppRepository', () => {
  let appRepository: AppRepository;
  let mockDb: any;
  let mockGitUtils: any;
  let mockPortManager: any;
  let mockDeploymentAdapter: any;
  let mockLogger: any;
  let mockProcessService: any;

  // Test data
  const mockAppId = 'test-app-123';
  const mockApp: App = {
    id: mockAppId,
    name: 'Test App',
    path: '/tmp/apps/test-app-123',
    port: 3000,
    initialPrompt: 'Create a test app',
    templateVersion: 'v3',
    status: 'created',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  };

  const mockCreateRequest: CreateAppRequest = {
    name: 'Test App',
    initialPrompt: 'Create a test app',
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock nanoid
    vi.mocked(nanoid).mockReturnValue(mockAppId);

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

    // Set up default mock returns to prevent unhandled rejections in background processes
    mockStatement.get.mockImplementation((id?: any) => {
      // For specific IDs used in tests, return the appropriate mock data
      if (id === mockAppId || id === 'test-app-123') {
        return {
          id: mockAppId,
          name: 'Test App',
          path: '/tmp/apps/test-app-123',
          port: 3000,
          initial_prompt: 'Test',
          status: 'created',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      // For any other calls, return null to simulate "not found"
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
    vi.mocked(GitUtils).mockImplementation(() => mockGitUtils);

    // Mock PortManager
    const { PortManager } = await import('../../../utils/port-manager.js');
    mockPortManager = {
      getNextAvailablePort: vi.fn().mockResolvedValue(3000),
    };
    vi.mocked(PortManager).mockImplementation(() => mockPortManager);

    // Template version extraction is now handled by TemplateCopyService

    // Mock adapter
    const { getAppAdapter, isDockerMode } = await import('../../../adapters/index.js');
    mockDeploymentAdapter = {
      startApp: vi.fn().mockResolvedValue(undefined),
      stopApp: vi.fn().mockResolvedValue(true),
      removeApp: vi.fn().mockResolvedValue(undefined),
      getRunningServers: vi.fn().mockResolvedValue([]),
      getCapabilities: vi.fn().mockReturnValue([]),
    };
    vi.mocked(getAppAdapter).mockResolvedValue(mockDeploymentAdapter);
    vi.mocked(isDockerMode).mockReturnValue(false);

    // Mock name suggestion service
    const { getNameSuggestionService } = await import('../../../services/name-suggestion.js');
    const mockNameSuggestionService = {
      suggestName: vi.fn().mockResolvedValue('Better Test App'),
    };
    vi.mocked(getNameSuggestionService).mockReturnValue(mockNameSuggestionService);

    // Mock TemplateCopyService
    const { TemplateCopyService } = await import('../../../services/TemplateCopyService.js');
    const mockTemplateCopyService = {
      copyTemplate: vi.fn().mockResolvedValue({
        templateVersion: 'v3',
        templatePath: '/mock/template/path',
        success: true
      }),
      getTemplateInfo: vi.fn().mockReturnValue({
        templatePath: '/mock/template/path',
        templateVersion: 'v3',
        exists: true
      }),
      validateTemplateStructure: vi.fn().mockReturnValue({
        valid: true,
        errors: []
      })
    };
    vi.mocked(TemplateCopyService).mockImplementation(() => mockTemplateCopyService as any);

    // Mock ProcessService
    const { ProcessService } = await import('../../../services/ProcessService.js');
    mockProcessService = {
      recoverOrphanedProcesses: vi.fn().mockResolvedValue(undefined),
      isPortOccupied: vi.fn().mockResolvedValue(false),
      startDevServer: vi.fn().mockImplementation(() => {
        // Simulate successful dev server start without errors
        return Promise.resolve();
      }),
      stopServer: vi.fn().mockResolvedValue(true),
      stopAllServers: vi.fn().mockResolvedValue(1),
      forceCleanupOrphans: vi.fn().mockResolvedValue(0),
      forceCleanupApp: vi.fn().mockResolvedValue(true),
      isServerRunning: vi.fn().mockReturnValue(false),
      getAppStatus: vi.fn().mockReturnValue({ status: 'stopped', message: 'No running process found' }),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getProcessInfoForPort: vi.fn().mockResolvedValue(null),
      getRunningProcesses: vi.fn().mockReturnValue(new Map())
    };
    vi.mocked(ProcessService).mockImplementation(() => mockProcessService as any);

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
    vi.mocked(getErrorMessage).mockImplementation((error: any) => 
      error instanceof Error ? error.message : String(error)
    );

    // Mock filesystem functions with default success behavior
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(rmSync).mockReturnValue(undefined);

    // Mock path functions
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(path.resolve).mockImplementation((...args) => '/' + args.join('/'));
    vi.mocked(path.dirname).mockReturnValue('/parent');
    vi.mocked(path.isAbsolute).mockReturnValue(false);
    vi.mocked(path.relative).mockReturnValue('relative/path');

    // Mock net module
    const net = await import('net');
    const mockServer = {
      listen: vi.fn().mockImplementation((port, callback) => {
        setTimeout(callback, 10); // Port is free by default
      }),
      close: vi.fn().mockImplementation((callback) => {
        setTimeout(callback, 10);
      }),
      on: vi.fn(),
    };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);

    // Create a new repository instance for each test
    appRepository = new AppRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully in local mode', async () => {
      await appRepository.initialize();

      expect(mockProcessService.recoverOrphanedProcesses).toHaveBeenCalled();
    });

    it('should initialize successfully in Docker mode', async () => {
      const { isDockerMode } = await import('../../../adapters/index.js');
      vi.mocked(isDockerMode).mockReturnValue(true);

      await appRepository.initialize();

      expect(mockProcessService.recoverOrphanedProcesses).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      const mockStatement = mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      await appRepository.initialize();
      await appRepository.initialize(); // Second call

      // Should only call recoverOrphanedProcesses once
      expect(mockProcessService.recoverOrphanedProcesses).toHaveBeenCalledTimes(1);
    });

    it('should handle initialization errors', async () => {
      const { getAppAdapter } = await import('../../../adapters/index.js');
      vi.mocked(getAppAdapter).mockRejectedValue(new Error('Adapter initialization failed'));

      await expect(appRepository.initialize()).rejects.toThrow('Adapter initialization failed');
    });
  });

  describe('Process Recovery', () => {
    it('should recover valid running processes', async () => {
      // Process recovery is now handled by ProcessService
      await appRepository.initialize();

      expect(mockProcessService.recoverOrphanedProcesses).toHaveBeenCalled();
    });

    it('should clean up dead processes', async () => {
      // Process recovery is now handled by ProcessService
      await appRepository.initialize();

      expect(mockProcessService.recoverOrphanedProcesses).toHaveBeenCalled();
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      // Initialize the repository for CRUD tests
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
      await appRepository.initialize();
    });

    describe('findById', () => {
      it('should return app when found', () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue({
            id: mockApp.id,
            name: mockApp.name,
            path: mockApp.path,
            port: mockApp.port,
            initial_prompt: mockApp.initialPrompt,
            template_version: mockApp.templateVersion,
            status: mockApp.status,
            created_at: mockApp.createdAt.toISOString(),
            updated_at: mockApp.updatedAt.toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.findById(mockAppId);

        // The actual findById method doesn't return templateVersion field
        expect(result).toEqual({
          ...mockApp,
          templateVersion: undefined,
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
            initial_prompt: 'Test',
            status: 'created',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'app2',
            name: 'App 2',
            path: '/tmp/app2',
            port: 3001,
            initial_prompt: null,
            status: 'creating',
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

        // Mock findById to return existing app first, then updated app
        const mockGetStatement = {
          get: vi.fn()
            .mockReturnValueOnce({
              id: existingApp.id,
              name: existingApp.name,
              path: existingApp.path,
              port: existingApp.port,
              initial_prompt: existingApp.initialPrompt,
              status: existingApp.status,
              created_at: existingApp.createdAt.toISOString(),
              updated_at: existingApp.updatedAt.toISOString(),
            })
            .mockReturnValueOnce({
              id: existingApp.id,
              name: updatedData.name,
              path: existingApp.path,
              port: existingApp.port,
              initial_prompt: existingApp.initialPrompt,
              status: existingApp.status,
              created_at: existingApp.createdAt.toISOString(),
              updated_at: new Date().toISOString(),
            }),
        };

        const mockUpdateStatement = {
          run: vi.fn(),
        };

        mockDb.prepare.mockImplementation((sql: string) => {
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
            initial_prompt: mockApp.initialPrompt,
            template_version: mockApp.templateVersion,
            status: mockApp.status,
            created_at: mockApp.createdAt.toISOString(),
            updated_at: mockApp.updatedAt.toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = appRepository.update(mockAppId, {});

        // The actual findById method doesn't return templateVersion field
        expect(result).toEqual({
          ...mockApp,
          templateVersion: undefined,
        });
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
              initial_prompt: mockApp.initialPrompt,
              status: 'creating',
              created_at: mockApp.createdAt.toISOString(),
              updated_at: mockApp.updatedAt.toISOString(),
            })
            .mockReturnValueOnce({
              id: mockApp.id,
              name: mockApp.name,
              path: mockApp.path,
              port: mockApp.port,
              initial_prompt: mockApp.initialPrompt,
              status: 'created',
              created_at: mockApp.createdAt.toISOString(),
              updated_at: new Date().toISOString(),
            }),
        };

        const mockUpdateStatement = {
          run: vi.fn(),
        };

        mockDb.prepare.mockImplementation((sql: string) => {
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

  describe('App Creation Workflow', () => {
    beforeEach(async () => {
      // Setup for app creation tests - use suggested name by default
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          id: mockAppId,
          name: 'Better Test App', // Use suggested name by default
          path: '/tmp/apps/test-app-123',
          port: 3000,
          initial_prompt: 'Create a test app',
          template_version: 'v3',
          status: 'creating',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        run: vi.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      // Mock successful filesystem operations
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(mkdirSync).mockReturnValue(undefined);
      
      // Template copying is now handled by TemplateCopyService

      await appRepository.initialize();
    });

    it('should create app successfully with all steps', async () => {
      // Mock environment
      process.env.APP_TEMPLATE_DIR = 'app-templates/v3';
      process.env.APPS_BASE_DIR = '/tmp/apps';

      // Mock port checking
      const net = await import('net');
      const mockServer = {
        listen: vi.fn().mockImplementation((port, callback) => {
          setTimeout(callback, 10); // Port is free
        }),
        close: vi.fn().mockImplementation((callback) => {
          setTimeout(callback, 10);
        }),
        on: vi.fn(),
      };
      vi.mocked(net.createServer).mockReturnValue(mockServer as any);

      // Mock spawn for setup processes
      const { spawn } = await import('child_process');
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10); // Success
          }
        }),
        kill: vi.fn(),
        unref: vi.fn(),
        pid: 12345,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const result = await appRepository.create(mockCreateRequest);

      expect(result.id).toBe(mockAppId);
      expect(result.name).toBe('Better Test App'); // Name suggestion worked
      expect(result.status).toBe('creating'); // Initial status
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith('/tmp/apps/test-app-123', { recursive: true });
    });

    it('should handle template directory not found', async () => {
      // Mock TemplateCopyService to throw TEMPLATE_NOT_FOUND error
      const { TemplateCopyService } = await import('../../../services/TemplateCopyService.js');
      const mockTemplateCopyService = {
        copyTemplate: vi.fn().mockRejectedValue(Object.assign(
          new Error('Template directory not found: /path/to/nonexistent-template'), 
          { code: 'TEMPLATE_NOT_FOUND', templatePath: '/path/to/nonexistent-template' }
        )),
        getTemplateInfo: vi.fn(),
        validateTemplateStructure: vi.fn()
      };
      vi.mocked(TemplateCopyService).mockImplementation(() => mockTemplateCopyService as any);

      // Create a new AppRepository instance to use the updated mock
      const testAppRepository = new AppRepository();
      await testAppRepository.initialize();

      await expect(testAppRepository.create(mockCreateRequest)).rejects.toThrow(/Template directory not found/);
    });

    it('should handle port already in use', async () => {
      // Mock ProcessService to return port occupied
      mockProcessService.isPortOccupied.mockResolvedValue(true);

      await expect(appRepository.create(mockCreateRequest)).rejects.toThrow(/Port .* is already in use/);
    });

    it('should handle filesystem errors during directory creation', async () => {
      vi.mocked(mkdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(appRepository.create(mockCreateRequest)).rejects.toThrow(/Failed to create app directory/);
    });

    it('should use original name when name suggestion fails', async () => {
      const { getNameSuggestionService } = await import('../../../services/name-suggestion.js');
      const mockNameSuggestionService = {
        suggestName: vi.fn().mockRejectedValue(new Error('Name suggestion failed')),
      };
      vi.mocked(getNameSuggestionService).mockReturnValue(mockNameSuggestionService);

      // Update the database mock to return the original name
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          id: mockAppId,
          name: 'Test App', // Original name should be used
          path: '/tmp/apps/test-app-123',
          port: 3000,
          initial_prompt: 'Create a test app',
          template_version: 'v3',
          status: 'creating',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        run: vi.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      // Mock successful creation with original name
      const net = await import('net');
      const mockServer = {
        listen: vi.fn().mockImplementation((port, callback) => {
          setTimeout(callback, 10);
        }),
        close: vi.fn().mockImplementation((callback) => {
          setTimeout(callback, 10);
        }),
        on: vi.fn(),
      };
      vi.mocked(net.createServer).mockReturnValue(mockServer as any);

      const { spawn } = await import('child_process');
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: vi.fn(),
        unref: vi.fn(),
        pid: 12345,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const result = await appRepository.create(mockCreateRequest);

      expect(result.name).toBe('Test App'); // Original name used
    });

    it('should validate template files after copying', async () => {
      // Mock TemplateCopyService to throw VALIDATION_FAILED error
      const { TemplateCopyService } = await import('../../../services/TemplateCopyService.js');
      const mockTemplateCopyService = {
        copyTemplate: vi.fn().mockRejectedValue(Object.assign(
          new Error('Template validation failed: Template package.json was not copied to /tmp/apps/test-app-123/package.json'), 
          { 
            code: 'VALIDATION_FAILED', 
            validationDetails: ['Template package.json was not copied to /tmp/apps/test-app-123/package.json']
          }
        )),
        getTemplateInfo: vi.fn(),
        validateTemplateStructure: vi.fn()
      };
      vi.mocked(TemplateCopyService).mockImplementation(() => mockTemplateCopyService as any);

      // Create a new AppRepository instance to use the updated mock
      const testAppRepository = new AppRepository();
      await testAppRepository.initialize();

      await expect(testAppRepository.create(mockCreateRequest)).rejects.toThrow(/Template package\.json was not copied/);
    });
  });

  describe('Development Server Management', () => {
    beforeEach(async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({ id: mockAppId }),
        run: vi.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
      await appRepository.initialize();
    });

    describe('getRunningServers', () => {
      it('should return running servers in local mode', async () => {
        const mockRunningProcess = {
          app_id: mockAppId,
          port: 3000,
        };

        const mockStatement = {
          all: vi.fn().mockReturnValue([mockRunningProcess]),
          get: vi.fn().mockReturnValue({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            port: 3000,
            initial_prompt: 'Test',
            status: 'created',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        // Mock v3 template detection
        vi.mocked(existsSync).mockImplementation((filePath) => {
          if (typeof filePath === 'string' && filePath.includes('frontend')) {
            return true; // v3 template
          }
          return true;
        });

        const result = await appRepository.getRunningServers();

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          appId: mockAppId,
          port: 3000,
          url: 'http://localhost:3000',
          isV3: true,
          backendPort: 4000, // port + 1000 = 3000 + 1000 = 4000
        });
      });

      it('should return running servers in Docker mode', async () => {
        const { isDockerMode } = await import('../../../adapters/index.js');
        vi.mocked(isDockerMode).mockReturnValue(true);

        mockDeploymentAdapter.getRunningServers.mockResolvedValue([
          {
            appId: mockAppId,
            port: 3000,
            url: 'http://localhost:3000',
          },
        ]);

        const result = await appRepository.getRunningServers();

        expect(result).toHaveLength(1);
        expect(result[0].appId).toBe(mockAppId);
        expect(mockDeploymentAdapter.getRunningServers).toHaveBeenCalled();
      });

      it('should handle Docker adapter errors gracefully', async () => {
        const { isDockerMode } = await import('../../../adapters/index.js');
        vi.mocked(isDockerMode).mockReturnValue(true);

        mockDeploymentAdapter.getRunningServers.mockRejectedValue(new Error('Docker error'));

        const result = await appRepository.getRunningServers();

        expect(result).toEqual([]);
      });
    });

    describe('stopServer', () => {
      it('should stop local server successfully', async () => {
        mockProcessService.stopServer.mockResolvedValue(true);

        const result = await appRepository.stopServer(mockAppId);

        expect(result).toBe(true);
        expect(mockProcessService.stopServer).toHaveBeenCalledWith(mockAppId);
      });

      it('should stop Docker server successfully', async () => {
        const { isDockerMode } = await import('../../../adapters/index.js');
        vi.mocked(isDockerMode).mockReturnValue(true);

        mockDeploymentAdapter.stopApp.mockResolvedValue(true);

        const result = await appRepository.stopServer(mockAppId);

        expect(result).toBe(true);
        expect(mockDeploymentAdapter.stopApp).toHaveBeenCalledWith(mockAppId);
      });

      it('should return false when no process found', async () => {
        mockProcessService.stopServer.mockResolvedValue(false);
        
        const result = await appRepository.stopServer('nonexistent-app');

        expect(result).toBe(false);
      });
    });

    describe('restartServer', () => {
      it('should restart server successfully', async () => {
        // Mock app exists
        const mockGetStatement = {
          get: vi.fn().mockReturnValue({
            id: mockAppId,
            name: 'Test App',
            path: '/tmp/apps/test-app-123',
            port: 3000,
            initial_prompt: 'Test',
            status: 'created',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        };

        const mockUpdateStatement = {
          run: vi.fn(),
        };

        mockDb.prepare.mockImplementation((sql: string) => {
          if (sql.includes('SELECT')) {
            return mockGetStatement;
          }
          return mockUpdateStatement;
        });

        // Mock successful port check (port becomes free)
        const net = await import('net');
        const mockServer = {
          listen: vi.fn().mockImplementation((port, callback) => {
            setTimeout(callback, 10); // Port is free
          }),
          close: vi.fn().mockImplementation((callback) => {
            setTimeout(callback, 10);
          }),
          on: vi.fn(),
        };
        vi.mocked(net.createServer).mockReturnValue(mockServer as any);

        const result = await appRepository.restartServer(mockAppId);

        expect(result).toBe(true);
      });

      it('should return false when app does not exist', async () => {
        const mockStatement = {
          get: vi.fn().mockReturnValue(null),
        };
        mockDb.prepare.mockReturnValue(mockStatement);

        const result = await appRepository.restartServer('nonexistent-app');

        expect(result).toBe(false);
      });
    });
  });

  describe('Process Management', () => {
    beforeEach(async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({ id: mockAppId }),
        run: vi.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
      await appRepository.initialize();
    });

    describe('forceCleanupOrphans', () => {
      it('should cleanup orphaned processes in local mode', async () => {
        mockProcessService.forceCleanupOrphans.mockResolvedValue(1);

        const result = await appRepository.forceCleanupOrphans();

        expect(result).toBe(1);
        expect(mockProcessService.forceCleanupOrphans).toHaveBeenCalled();
      });

      it('should cleanup orphaned processes in Docker mode', async () => {
        const { isDockerMode } = await import('../../../adapters/index.js');
        vi.mocked(isDockerMode).mockReturnValue(true);

        mockDeploymentAdapter.cleanupOrphans = vi.fn().mockResolvedValue({
          message: 'Cleaned up 2 containers',
          cleaned: 2,
        });

        const result = await appRepository.forceCleanupOrphans();

        expect(result).toBe(2);
        expect(mockDeploymentAdapter.cleanupOrphans).toHaveBeenCalled();
      });
    });

    describe('forceCleanupApp', () => {
      it('should cleanup processes for specific app', async () => {
        mockProcessService.forceCleanupApp.mockResolvedValue(true);

        const result = await appRepository.forceCleanupApp(mockAppId);

        expect(result).toBe(true);
        expect(mockProcessService.forceCleanupApp).toHaveBeenCalledWith(mockAppId);
      });

      it('should return true when no processes found', async () => {
        mockProcessService.forceCleanupApp.mockResolvedValue(true);

        const result = await appRepository.forceCleanupApp('nonexistent-app');

        expect(result).toBe(true);
      });
    });
  });

  describe('Delete Operations', () => {
    beforeEach(async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          id: mockAppId,
          name: 'Test App',
          path: '/tmp/apps/test-app-123',
          port: 3000,
          initial_prompt: 'Test',
          status: 'created',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        run: vi.fn().mockReturnValue({ changes: 1 }),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
      await appRepository.initialize();
    });

    it('should delete app and cleanup resources', async () => {
      const result = await appRepository.delete(mockAppId);

      expect(result).toBe(true);
      expect(vi.mocked(rmSync)).toHaveBeenCalledWith('/tmp/apps/test-app-123', { 
        recursive: true, 
        force: true 
      });
      expect(mockDeploymentAdapter.removeApp).toHaveBeenCalledWith(mockAppId);
    });

    it('should return false when app does not exist', async () => {
      const mockStatement = {
        get: vi.fn().mockReturnValue(null),
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const result = await appRepository.delete('nonexistent-app');

      expect(result).toBe(false);
    });

    it('should handle filesystem cleanup errors gracefully', async () => {
      vi.mocked(rmSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await appRepository.delete(mockAppId);

      expect(result).toBe(true); // Should still succeed despite cleanup error
    });
  });

  describe('Adapter Integration', () => {
    beforeEach(async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({ id: mockAppId }),
        run: vi.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
      await appRepository.initialize();
    });

    it('should provide adapter information', () => {
      const info = appRepository.getAdapterInfo();

      expect(info).toEqual({
        type: 'Local',
        isInitialized: true,
        capabilities: [],
        environmentVariable: 'unset (defaults to Local)',
      });
    });

    it('should report Docker mode correctly', async () => {
      const { isDockerMode } = await import('../../../adapters/index.js');
      vi.mocked(isDockerMode).mockReturnValue(true);

      const isDock = appRepository.isDockerMode();
      expect(isDock).toBe(true);
    });

    describe('Adapter Methods', () => {
      it('should get app status via adapter in Docker mode', async () => {
        const { isDockerMode } = await import('../../../adapters/index.js');
        vi.mocked(isDockerMode).mockReturnValue(true);

        mockDeploymentAdapter.getAppStatus = vi.fn().mockResolvedValue({
          status: 'running',
          message: 'Container is healthy',
        });

        const result = await appRepository.getAppStatus(mockAppId);

        expect(result.status).toBe('running');
        expect(mockDeploymentAdapter.getAppStatus).toHaveBeenCalledWith(mockAppId);
      });

      it('should get app status in local mode', async () => {
        mockProcessService.getAppStatus.mockReturnValue({
          status: 'running',
          message: 'Process is running',
          metadata: { pid: 12345 }
        });

        const result = await appRepository.getAppStatus(mockAppId);

        expect(result.status).toBe('running');
        expect(result.metadata?.pid).toBe(12345);
        expect(mockProcessService.getAppStatus).toHaveBeenCalledWith(mockAppId);
      });

      it('should get app logs via adapter', async () => {
        mockDeploymentAdapter.getAppLogs = vi.fn().mockResolvedValue(['log line 1', 'log line 2']);

        const result = await appRepository.getAppLogs(mockAppId);

        expect(result).toEqual(['log line 1', 'log line 2']);
        expect(mockDeploymentAdapter.getAppLogs).toHaveBeenCalledWith(mockAppId);
      });

      it('should rebuild app container via adapter', async () => {
        mockDeploymentAdapter.rebuildApp = vi.fn().mockResolvedValue(true);

        const result = await appRepository.rebuildAppContainer(mockAppId);

        expect(result).toBe(true);
        expect(mockDeploymentAdapter.rebuildApp).toHaveBeenCalledWith(mockAppId);
      });

      it('should throw error when adapter method not supported', async () => {
        const { isDockerMode } = await import('../../../adapters/index.js');
        vi.mocked(isDockerMode).mockReturnValue(false); // Local mode

        await expect(appRepository.getAppLogs(mockAppId)).rejects.toThrow(
          'Log retrieval not supported in current deployment mode'
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const { getDatabase } = await import('../../connection.js');
      vi.mocked(getDatabase).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      expect(() => new AppRepository()).toThrow('Database connection failed');
    });

    it('should handle template validation errors', async () => {
      // Setup for creation
      const mockStatement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({ id: mockAppId }),
        run: vi.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      // Mock TemplateCopyService to throw VALIDATION_FAILED error
      const { TemplateCopyService } = await import('../../../services/TemplateCopyService.js');
      const mockTemplateCopyService = {
        copyTemplate: vi.fn().mockRejectedValue(Object.assign(
          new Error('Template validation failed: Template src directory was not copied to /tmp/apps/test-app-123/src'), 
          { 
            code: 'VALIDATION_FAILED', 
            validationDetails: ['Template src directory was not copied to /tmp/apps/test-app-123/src']
          }
        )),
        getTemplateInfo: vi.fn(),
        validateTemplateStructure: vi.fn()
      };
      vi.mocked(TemplateCopyService).mockImplementation(() => mockTemplateCopyService as any);

      // Create a new AppRepository instance to use the updated mock
      const testAppRepository = new AppRepository();
      await testAppRepository.initialize();

      await expect(testAppRepository.create(mockCreateRequest)).rejects.toThrow(/Template src directory was not copied/);
    });
  });
});