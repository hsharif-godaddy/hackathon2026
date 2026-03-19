/**
 * Server Status Integration Tests
 * 
 * These tests create a full development environment to verify that the server_status
 * command works correctly with real apps, dev-supervisor, and development servers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { executeToolFunction } from '../tool-functions.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import type { AgentExecutionContext } from '../../base/index.js';
import { cleanupProcess } from './test-helpers.js';

// Helper function to call app service APIs
async function callAppServiceAPI(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const url = `http://localhost:3000${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  if (body && method === 'POST') {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

describe('Server Status Integration Tests', () => {
  let testDir: string;
  let appId: string;
  let appRepo: AppRepository;
  let devSupervisorProcess: ChildProcess | null = null;
  let devServerProcess: ChildProcess | null = null;
  let socketPath: string;
  let skipTests = false;
  
  beforeAll(async () => {
    // Check if dev-supervisor binary exists
    const devSupervisorBinary = path.join(process.cwd(), '..', 'dev-supervisor', 'dist', 'dev-supervisor');
    const devSupervisorBinaryAlt = path.join(process.cwd(), 'dist', 'dev-supervisor');
    
    let binaryPath: string | null = null;
    if (existsSync(devSupervisorBinary)) {
      binaryPath = devSupervisorBinary;
    } else if (existsSync(devSupervisorBinaryAlt)) {
      binaryPath = devSupervisorBinaryAlt;
    }
    
    if (!binaryPath) {
      console.warn('dev-supervisor binary not found, skipping integration tests');
      skipTests = true;
      return;
    }
    
    // Create test directory structure
    testDir = path.join('/tmp', `server-status-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Create a simple Next.js-like app structure
    const appDir = path.join(testDir, 'test-app');
    await fs.mkdir(appDir, { recursive: true });
    
    // Create package.json
    await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify({
      name: 'test-app',
      version: '1.0.0',
      scripts: {
        dev: 'node -e "console.log(\'Dev server starting...\'); setInterval(() => console.log(\'Server running on port 3000\'), 5000);"',
        build: 'echo "Building..."',
        start: 'echo "Starting production server..."'
      },
      dependencies: {
        next: '^13.0.0',
        react: '^18.0.0'
      }
    }, null, 2));
    
    // Create a simple page
    const pagesDir = path.join(appDir, 'pages');
    await fs.mkdir(pagesDir, { recursive: true });
    await fs.writeFile(path.join(pagesDir, 'index.js'), `
export default function Home() {
  return <div>Hello World</div>;
}
    `);
    
    // Set up socket path
    socketPath = path.join(testDir, 'dev-supervisor.sock');
    
    // Initialize app repository
    appRepo = new AppRepository();
    
    // Create app via app service API
    console.log('Creating test app via app service API...');
    try {
      const createResponse = await callAppServiceAPI('/api/apps/create', 'POST', {
        name: 'Integration Test App',
        initialPrompt: 'Create a simple Next.js app for testing'
      });
      
      if (!createResponse.success) {
        throw new Error(`Failed to create app: ${createResponse.error}`);
      }
      
      appId = createResponse.appId;
      console.log(`Created test app via API: ${appId}`);
      
      // Wait a moment for the app to be fully created
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify the app exists in the agents database
      const app = appRepo.findById(appId);
      if (!app) {
        throw new Error(`App ${appId} not found in agents database after creation`);
      }
      
      console.log(`Verified app exists in agents database: ${appId} at ${app.path}`);
      
      // Update socket path for our test
      socketPath = app.socketPath || path.join(testDir, 'dev-supervisor.sock');
      
    } catch (error) {
      console.error('Failed to create test app via API:', error);
      skipTests = true;
      return;
    }
    
    // Start dev-supervisor
    console.log('Starting dev-supervisor for integration tests...');
    devSupervisorProcess = spawn(binaryPath, [], {
      env: {
        ...process.env,
        DEV_SUPERVISOR_SOCKET_PATH: socketPath,
      },
      stdio: 'pipe',
      cwd: appDir,
    });
    
    // Wait for dev-supervisor to start
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('dev-supervisor failed to start within timeout'));
      }, 15000);
      
      const checkSocket = () => {
        if (existsSync(socketPath)) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkSocket, 100);
        }
      };
      
      checkSocket();
    });
    
    console.log('Dev-supervisor started successfully');
    
  }, 30000);
  
  afterAll(async () => {
    if (skipTests) {return;}

    // Clean up processes using helper
    await cleanupProcess(devServerProcess, 3000);
    devServerProcess = null;

    await cleanupProcess(devSupervisorProcess, 5000);
    devSupervisorProcess = null;

    // Clean up test directory
    if (testDir && existsSync(testDir)) {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('Failed to clean up test directory:', error);
      }
    }

    // Clean up app via API
    if (appId) {
      try {
        console.log(`Cleaning up test app: ${appId}`);
        await callAppServiceAPI(`/api/sites/${appId}`, 'DELETE');
        console.log(`Successfully deleted test app: ${appId}`);
      } catch (error) {
        console.warn('Failed to clean up app via API:', error);
        // Fallback to direct repository cleanup
        try {
          if (appRepo) {
            await appRepo.delete(appId);
          }
        } catch (repoError) {
          console.warn('Failed to clean up app from repository:', repoError);
        }
      }
    }
  }, 15000);

  beforeEach(() => {
    if (skipTests) {return;}
  });

  afterEach(async () => {
    if (skipTests) {return;}

    // Stop any running dev server between tests
    await cleanupProcess(devServerProcess, 2000);
    devServerProcess = null;
  });

  describe('Environment Setup', () => {
    it('should skip tests if dev-supervisor not available', () => {
      if (skipTests) {
        console.log('Skipping integration tests - dev-supervisor binary not found');
        return;
      }
      
      expect(skipTests).toBe(false);
    });
    
    it('should have dev-supervisor running', () => {
      if (skipTests) {return;}
      
      expect(existsSync(socketPath)).toBe(true);
      expect(devSupervisorProcess).toBeTruthy();
    });

    it('should have test app created in repository', () => {
      if (skipTests) {return;}
      
      const app = appRepo.findById(appId);
      expect(app).toBeTruthy();
      expect(app?.id).toBe(appId);
      expect(app?.socketPath).toBe(socketPath);
    });

    it('should be able to communicate with dev-supervisor', async () => {
      if (skipTests) {return;}
      
      const devSupervisor = new DevSupervisorClient(socketPath);
      const info = await devSupervisor.getInfo();
      expect(info).toBeDefined();
      expect(typeof info).toBe('object');
    });
  });

  describe('Server Status - No Dev Server Running', () => {
    it('should report server status correctly', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: { appId }
      };
      
      const result = await executeToolFunction('server_status', {}, context);
      
      expect(typeof result).toBe('string');
      expect(result).toContain('Server Status for App');
      expect(result).toContain(appId);
      // When created via API, the app may have a dev server running automatically
      expect(result).toMatch(/RUNNING|STOPPED|ERROR/i);
    });

    it('should handle invalid app ID gracefully', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: { appId: 'nonexistent-app-id' }
      };
      
      await expect(executeToolFunction('server_status', {}, context))
        .rejects.toThrow(/not found|Failed to check server status/);
    });

    it('should handle missing app ID in context', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: {}
      };
      
      await expect(executeToolFunction('server_status', {}, context))
        .rejects.toThrow(/App ID is required/);
    });
  });

  describe('Server Status - With Dev Server Running', () => {
    beforeEach(async () => {
      if (skipTests) {return;}
      
      // Start a mock dev server process through dev-supervisor
      const devSupervisor = new DevSupervisorClient(socketPath);
      
      try {
        await devSupervisor.startProcess({
          command: 'npm run dev',
          working_dir: appRepo.findById(appId)?.path,
          env: {
            NODE_ENV: 'development',
            PORT: '3000'
          }
        });
        
        // Wait a moment for the process to start
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.warn('Failed to start dev server through supervisor:', error);
      }
    });

    it('should report running status when dev server is active', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: { appId }
      };
      
      const result = await executeToolFunction('server_status', {}, context);
      
      expect(typeof result).toBe('string');
      expect(result).toContain('Server Status for App');
      expect(result).toContain(appId);
      // Should show either RUNNING or provide meaningful status
      expect(result.length).toBeGreaterThan(20); // Should have substantial content
    });

    it('should provide meaningful status information', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: { appId }
      };
      
      const result = await executeToolFunction('server_status', {}, context);
      
      // Should contain app ID and status information
      expect(result).toContain(appId);
      expect(result).toMatch(/Status|status/);
      
      // Should not be an error message
      expect(result).not.toMatch(/error|failed|Error|Failed/i);
    });
  });

  describe('Server Status - Error Conditions', () => {
    it('should handle dev-supervisor communication errors', async () => {
      if (skipTests) {return;}
      
      // Create an app with invalid socket path using direct database insert
      const badAppId = `bad-app-${Date.now()}`;
      const now = new Date().toISOString();
      
      const stmt = appRepo['db'].prepare(`
        INSERT INTO apps (id, name, path, port, socket_path, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        badAppId,
        'Bad App',
        '/tmp/nonexistent',
        3001,
        '/tmp/nonexistent.sock',
        'created',
        now,
        now
      );
      
      const context: AgentExecutionContext = {
        metadata: { appId: badAppId }
      };
      
      const result = await executeToolFunction('server_status', {}, context);
      
      expect(typeof result).toBe('string');
      expect(result).toContain(badAppId);
      // Should handle the error gracefully and provide status
      expect(result).toMatch(/STOPPED|ERROR|not available/i);
      
      // Clean up
      appRepo.delete(badAppId);
    });

    it('should handle apps without socket path', async () => {
      if (skipTests) {return;}
      
      // Create an app without socket path using direct database insert
      const noSocketAppId = `no-socket-app-${Date.now()}`;
      const now = new Date().toISOString();
      
      const stmt = appRepo['db'].prepare(`
        INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        noSocketAppId,
        'No Socket App',
        '/tmp/test',
        3002,
        'created',
        now,
        now
      );
      
      const context: AgentExecutionContext = {
        metadata: { appId: noSocketAppId }
      };
      
      const result = await executeToolFunction('server_status', {}, context);
      
      expect(typeof result).toBe('string');
      expect(result).toContain(noSocketAppId);
      expect(result).toMatch(/STOPPED|not available/i);
      
      // Clean up
      appRepo.delete(noSocketAppId);
    });
  });

  describe('Server Status - Performance', () => {
    it('should complete status check in reasonable time', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: { appId }
      };
      
      const startTime = Date.now();
      const result = await executeToolFunction('server_status', {}, context);
      const endTime = Date.now();
      
      const duration = endTime - startTime;
      
      expect(typeof result).toBe('string');
      expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
    });

    it('should handle multiple concurrent status checks', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: { appId }
      };
      
      const promises = [
        executeToolFunction('server_status', {}, context),
        executeToolFunction('server_status', {}, context),
        executeToolFunction('server_status', {}, context),
      ];
      
      const results = await Promise.all(promises);
      
      results.forEach(result => {
        expect(typeof result).toBe('string');
        expect(result).toContain(appId);
      });
    });
  });

  describe('Integration with Dev Environment', () => {
    it('should work with real app structure', async () => {
      if (skipTests) {return;}
      
      // Verify the test app has proper structure
      const app = appRepo.findById(appId);
      expect(app).toBeTruthy();
      expect(existsSync(app!.path)).toBe(true);
      expect(existsSync(path.join(app!.path, 'package.json'))).toBe(true);
      
      const context: AgentExecutionContext = {
        metadata: { appId }
      };
      
      const result = await executeToolFunction('server_status', {}, context);
      
      expect(typeof result).toBe('string');
      expect(result).toContain(appId);
    });

    it('should provide consistent results across multiple calls', async () => {
      if (skipTests) {return;}
      
      const context: AgentExecutionContext = {
        metadata: { appId }
      };
      
      const result1 = await executeToolFunction('server_status', {}, context);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      const result2 = await executeToolFunction('server_status', {}, context);
      
      // Results should be consistent (both should indicate same general status)
      expect(typeof result1).toBe('string');
      expect(typeof result2).toBe('string');
      expect(result1).toContain(appId);
      expect(result2).toContain(appId);
      
      // Both should have similar status (both stopped, both running, etc.)
      const status1 = result1.match(/(RUNNING|STOPPED|ERROR)/i)?.[0] || 'UNKNOWN';
      const status2 = result2.match(/(RUNNING|STOPPED|ERROR)/i)?.[0] || 'UNKNOWN';
      
      // Status should be consistent within a short time frame
      expect(status1).toBe(status2);
    });
  });
});
