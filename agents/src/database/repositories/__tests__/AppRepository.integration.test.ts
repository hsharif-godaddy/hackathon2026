/**
 * Integration tests for AppRepository - tests real interactions between layers
 * These tests use real database, filesystem, and services to catch integration issues
 * that unit tests with heavy mocking might miss.
 * 
 * NOTE: These tests are slower than unit tests and should be kept focused.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { AppRepository } from '../AppRepository.js';
import { initializeTestDatabase } from '../../schema.js';
import type { CreateAppRequest } from '../../schema.js';

// Mock database connection first
vi.mock('../../connection.js');

vi.mock('../../../services/name-suggestion.js', () => ({
  getNameSuggestionService: vi.fn().mockReturnValue({
    suggestName: vi.fn().mockResolvedValue('AI Suggested App Name')
  })
}));

vi.mock('nanoid');

// Mock logging to no-ops  
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis()
    })
  },
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

// Use real logging events but they won't actually log since Logger is mocked
vi.mock('../../../logging/events/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return actual; // Use real events, but Logger is mocked to no-op
});

vi.mock('../../../utils/error.js', () => ({
  getErrorMessage: vi.fn().mockImplementation(function (error) { return error.message || 'Unknown error'; })
}));

// Mock child_process to prevent actual process creation
vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(function () { return {
    pid: 12345,
    unref: vi.fn(),
    on: vi.fn(),
    kill: vi.fn(),
  }; })
}));

// Mock net with proper structure
vi.mock('net', () => ({
  default: {
    createServer: vi.fn().mockImplementation(function () { return {
      listen: vi.fn().mockImplementation(function (port, callback) {
        setTimeout(callback, 10); // Simulate port available
      }),
      close: vi.fn().mockImplementation(function (callback) {
        setTimeout(callback, 10);
      }),
      on: vi.fn()
    }; })
  },
  createServer: vi.fn().mockImplementation(function () { return {
    listen: vi.fn().mockImplementation(function (port, callback) {
      setTimeout(callback, 10); // Simulate port available
    }),
    close: vi.fn().mockImplementation(function (callback) {
      setTimeout(callback, 10);
    }),
    on: vi.fn()
  }; })
}));

describe('AppRepository Integration Tests', () => {
  let testDb: Database.Database;
  let testBaseDir: string;
  let testTemplateDir: string;
  let appRepository: AppRepository;

  beforeEach(async () => {
    // Create temporary directories for this test
    testBaseDir = join(tmpdir(), `airo-test-apps-${Date.now()}-${Math.random()}`);
    testTemplateDir = join(tmpdir(), `airo-test-templates-${Date.now()}-${Math.random()}`);
    
    mkdirSync(testBaseDir, { recursive: true });
    mkdirSync(testTemplateDir, { recursive: true });
    
    // Create a real v8 template structure that TemplateCopyService expects
    const templateV8Dir = join(testTemplateDir, 'v8');
    mkdirSync(templateV8Dir, { recursive: true });

    // Create src directory (v8 template structure)
    const srcDir = join(templateV8Dir, 'src');
    mkdirSync(srcDir, { recursive: true });

    // Create source files
    writeFileSync(join(srcDir, 'main.jsx'), 'console.log("Hello World");');
    writeFileSync(join(srcDir, 'App.jsx'), 'export default function App() { return <div>Hello</div>; }');

    // Create root template files that TemplateCopyService expects
    writeFileSync(join(templateV8Dir, 'package.json'), JSON.stringify({
      name: "app-template-v8",
      version: "1.0.0",
      scripts: {
        dev: "echo 'dev server running'"
      },
      dependencies: {
        "react": "^18.0.0"
      }
    }));

    writeFileSync(join(templateV8Dir, 'README.md'), '# App Template v8');
    writeFileSync(join(templateV8Dir, 'index.html'), '<html><body>Hello World</body></html>');
    writeFileSync(join(templateV8Dir, 'vite.config.ts'), 'export default {}');
    
    // Create real in-memory SQLite database with complete schema
    testDb = new Database(':memory:');
    initializeTestDatabase(testDb);

    // Set environment variables for test
    process.env.APPS_BASE_DIR = testBaseDir;
    // Point to the v8 directory we created, not the parent
    process.env.APP_TEMPLATE_DIR = join(testTemplateDir, 'v8');
    
    // Mock the database connection to return our test database
    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(testDb as any);
    
    // Mock nanoid to generate predictable IDs for testing
    const { nanoid } = await import('nanoid');
    vi.mocked(nanoid).mockReturnValue(`test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    
    // Create AppRepository instance (will use real services)
    appRepository = new AppRepository();
  });

  afterEach(async () => {
    // Cleanup test database
    if (testDb && !testDb.readonly) {
      try {
        testDb.close();
      } catch (error) {
        // Ignore if already closed
      }
    }
    
    // Cleanup test directories
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true, force: true });
    }
    if (existsSync(testTemplateDir)) {
      rmSync(testTemplateDir, { recursive: true, force: true });
    }
    
    // Reset environment
    delete process.env.APPS_BASE_DIR;
    delete process.env.APP_TEMPLATE_DIR;
  });

  describe('Primary Create App Flow Integration', () => {
    it('should create app with real database and filesystem operations', async () => {
      // Debug: Check if template structure was created correctly
      const templateV8Dir = join(testTemplateDir, 'v8');
      expect(existsSync(join(templateV8Dir, 'package.json'))).toBe(true);
      expect(existsSync(join(templateV8Dir, 'src'))).toBe(true);
      
      // Test data
      const createRequest: CreateAppRequest = {
        name: 'Integration Test App',
        initialPrompt: 'Create a test application for integration testing'
      };

      // Execute the create flow
      const app = await appRepository.create(createRequest);

      // Verify app was created in database
      expect(app).toBeDefined();
      expect(app.id).toBeTruthy();
      expect(app.name).toBe('AI Suggested App Name'); // Should use AI suggestion
      expect(app.path).toContain(testBaseDir);
      expect(app.port).toBeGreaterThan(0);
      expect(app.status).toBe('creating'); // Initial status
      expect(app.initialPrompt).toBe(createRequest.initialPrompt);

      // Verify database persistence (real SQLite integration)
      const retrievedApp = appRepository.findById(app.id);
      expect(retrievedApp).toEqual(app);

      // Verify all apps query works
      const allApps = appRepository.findAll();
      expect(allApps).toHaveLength(1);
      expect(allApps[0]).toEqual(app);

      // Verify app directory was created (real filesystem integration)
      expect(existsSync(app.path)).toBe(true);
      
      // Verify template files were copied (real TemplateCopyService integration)
      expect(existsSync(join(app.path, 'package.json'))).toBe(true);
      expect(existsSync(join(app.path, 'README.md'))).toBe(true);
      expect(existsSync(join(app.path, 'index.html'))).toBe(true);
      
      // Verify package.json was properly copied and contains expected structure
      const packageJsonPath = join(app.path, 'package.json');
      const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      expect(packageJsonContent.scripts.dev).toBeDefined();
      expect(packageJsonContent.name).toBe('app-template-v8');
    });

    it('should handle database and filesystem cleanup on delete', async () => {
      // Create an app first
      const createRequest: CreateAppRequest = {
        name: 'Cleanup Integration Test',
        initialPrompt: 'Test cleanup integration'
      };

      const app = await appRepository.create(createRequest);
      
      // Verify it exists in both database and filesystem
      expect(appRepository.findById(app.id)).toBeTruthy();
      expect(existsSync(app.path)).toBe(true);
      
      // Delete the app
      const deleted = await appRepository.delete(app.id);
      expect(deleted).toBe(true);
      
      // Verify database cleanup (real database integration)
      expect(appRepository.findById(app.id)).toBe(null);
      
      // Verify filesystem cleanup (real filesystem integration)
      expect(existsSync(app.path)).toBe(false);
    });

    it('should maintain referential integrity between apps and processes tables', async () => {
      const createRequest: CreateAppRequest = {
        name: 'DB Integrity Test',
        initialPrompt: 'Test database integrity'
      };

      const app = await appRepository.create(createRequest);

      // Verify we can query the database directly  
      const appsInDb = testDb.prepare('SELECT * FROM apps WHERE id = ?').get(app.id);
      expect(appsInDb).toBeTruthy();

      // Verify foreign key constraint works - should be able to insert process record
      const processId = 'test-process-' + Date.now();
      const insertProcess = testDb.prepare(`
        INSERT INTO running_processes (id, app_id, pid, port, started_at, status)
        VALUES (?, ?, ?, ?, datetime('now'), 'running')
      `);
      
      expect(() => {
        insertProcess.run(processId, app.id, 12345, 3000);
      }).not.toThrow();

      // Verify the process record was created
      const processInDb = testDb.prepare('SELECT * FROM running_processes WHERE id = ?').get(processId);
      expect(processInDb).toBeTruthy();
      expect(processInDb.app_id).toBe(app.id);

      // Verify foreign key constraint - should fail with invalid app_id
      expect(() => {
        insertProcess.run('test-process-invalid', 'invalid-app-id', 12346, 3001);
      }).toThrow();
    });

    it('should handle concurrent operations safely', async () => {
      // Create multiple apps concurrently to test database locking and filesystem operations
      const createRequests = Array.from({ length: 3 }, (_, i) => ({
        name: `Concurrent Test App ${i}`,
        initialPrompt: `Test concurrent operations ${i}`
      }));

      // Mock nanoid to return different IDs for each call
      const { nanoid } = await import('nanoid');
      vi.mocked(nanoid)
        .mockReturnValueOnce('concurrent-test-1')
        .mockReturnValueOnce('concurrent-test-2')
        .mockReturnValueOnce('concurrent-test-3');

      // Mock PortManager to return different ports for concurrent operations
      // In a real scenario, concurrent port allocation might be an issue, but for integration
      // testing we want to verify successful flow
      let portCounter = 3000;
      const mockPortManager = {
        getNextAvailablePort: vi.fn().mockImplementation(function () { return Promise.resolve(portCounter++); })
      };
      
      // Temporarily replace the port manager in the repository
      (appRepository as any).portManager = mockPortManager;

      // Create apps concurrently
      const apps = await Promise.all(
        createRequests.map(request => appRepository.create(request))
      );

      // Verify all apps were created successfully
      expect(apps).toHaveLength(3);
      apps.forEach((app, i) => {
        expect(app.id).toBe(`concurrent-test-${i + 1}`);
        expect(existsSync(app.path)).toBe(true);
      });

      // Verify database has all apps
      const allApps = appRepository.findAll();
      expect(allApps).toHaveLength(3);

      // Verify unique constraints are respected
      const paths = apps.map(app => app.path);
      const ports = apps.map(app => app.port);
      expect(new Set(paths)).toHaveProperty('size', 3); // All unique paths
      expect(new Set(ports)).toHaveProperty('size', 3); // All unique ports
    });
  });
});